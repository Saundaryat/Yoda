import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import {
  AGENT_ACTS,
  EXTRA_ISSUES,
  LEAD_INTENTS,
  LEAD_MOODS,
  OUTCOMES,
  type Issue,
  type JudgeReport,
  type JudgeVerdict,
  type RunEvent,
  type TaskDefinition,
  type TurnJudgment,
} from '@evals/shared';
import { z } from 'zod';
import { claudeFailure, estimateCost, type ClaudeClient } from '../runner/anthropic.js';
import { InfraError } from '../runner/hermes-cli.js';

/**
 * The LLM judge: one call per finished run. It grades every agent reply on three criteria fixed
 * rules can't see, labels every turn from fixed lists (so problems can be counted across runs),
 * and answers the task's own `llm_judge` questions. A separate model from the agent and the lead,
 * so nothing grades its own output. A problem must be backed by a verbatim quote; we check the
 * quote and ignore problems we can't verify.
 */

export const JUDGE_RUBRIC = {
  audience:
    'Written directly to the lead, as the clinic. FAIL if it addresses someone else ("Reply to Maria:", "Here is my reply"), talks about the lead in the third person ("Rosa has been opted out"), or includes internal notes, status updates or tool talk the lead should not see.',
  format:
    'Reads like a natural SMS: plain text, no markdown (**bold**, headings, bullet lists, "---" separators), no more than a few short sentences. Emoji are fine.',
  grounded:
    'Every factual claim (that something was booked, cancelled or noted, times, dates, prices, availability) is backed by the tool results earlier in the transcript. FAIL if it claims something the tools do not show, e.g. "you\'re booked" when no booking succeeded, or a price or slot that was never returned. After a successful escalate_to_human, saying staff or a clinician will follow up is backed; promising a specific time ("right away", "within the hour") is not.',
} as const;

const LABEL_GUIDE = [
  'Labels (use only these words):',
  `- For every LEAD message, intent: ${LEAD_INTENTS.join(', ')}; mood: ${LEAD_MOODS.join(', ')}.`,
  `- For every AGENT REPLY, act (its main purpose): ${AGENT_ACTS.join(', ')}.`,
  '- For every AGENT REPLY, extra problems (zero or more), each with the exact words it is about:',
  '  reasked_known_info: asks for something the lead already said or the agent could see in its tools.',
  "  ignored_question: does not answer a question the lead just asked (quote the lead's question).",
  '  booked_without_clear_yes: a booking was made before the lead clearly agreed to that time.',
  `- For the whole conversation, outcome: ${OUTCOMES.join(', ')}.`,
  '- leadConsistent: did the LEAD behave like one real person with one consistent situation (no contradictions, no talking like an AI or a tester)?',
].join('\n');

const verdictSchema = z.object({
  pass: z.boolean(),
  quote: z
    .string()
    .describe('For a FAIL: the exact words from the reply that fail. Empty for a pass.'),
  reason: z.string().describe('One short sentence.'),
});

const reportSchema = z.object({
  turns: z.array(
    z.object({
      seq: z.number().int().describe('The # number of the AGENT REPLY being judged.'),
      audience: verdictSchema,
      format: verdictSchema,
      grounded: verdictSchema,
      act: z.enum(AGENT_ACTS),
      issues: z.array(
        z.object({ label: z.enum(EXTRA_ISSUES), quote: z.string(), reason: z.string() }),
      ),
    }),
  ),
  leadTurns: z.array(
    z.object({ seq: z.number().int(), intent: z.enum(LEAD_INTENTS), mood: z.enum(LEAD_MOODS) }),
  ),
  questions: z.array(
    z.object({
      id: z.string(),
      answer: z.enum(['yes', 'no']),
      quote: z.string().describe('Words from the transcript that support the answer, if any.'),
      reason: z.string(),
    }),
  ),
  outcome: z.object({ label: z.enum(OUTCOMES), reason: z.string() }),
  leadConsistent: z.object({ ok: z.boolean(), reason: z.string() }),
});

const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

/** The transcript as the judge reads it. Mid-turn agent notes are left out: the lead never sees them. */
export function renderTranscript(events: RunEvent[]): string {
  const lines: string[] = [];
  let session = 0;
  for (const event of events) {
    if (event.session !== session) {
      session = event.session;
      if (session > 1)
        lines.push(`--- Session ${session}: a new conversation with the same lead ---`);
    }
    if (event.kind === 'lead') lines.push(`#${event.seq} LEAD: ${event.text}`);
    if (event.kind === 'agent')
      lines.push(`#${event.seq} AGENT REPLY (sent to the lead): ${event.text || '(empty)'}`);
    if (event.kind === 'tool') {
      const result = typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
      lines.push(
        `#${event.seq} TOOL ${event.tool}(${JSON.stringify(event.args)}) → ${event.ok ? 'ok' : 'REJECTED'}: ${truncate(result, 800)}`,
      );
    }
  }
  return lines.join('\n');
}

export function judgeSystemPrompt(): string {
  return [
    "You evaluate an AI SMS assistant for Bright Smile Dental, a dental clinic. Leads text the clinic; the assistant replies and uses CRM tools. Only lines marked AGENT REPLY are sent to the lead; TOOL lines are the assistant's CRM calls and their results.",
    '',
    'Judge every AGENT REPLY on three criteria, each pass or fail:',
    `- audience: ${JUDGE_RUBRIC.audience}`,
    `- format: ${JUDGE_RUBRIC.format}`,
    `- grounded: ${JUDGE_RUBRIC.grounded}`,
    '',
    LABEL_GUIDE,
    '',
    'Then answer each task question yes or no, from the transcript alone.',
    '',
    'Rules: judge what is written, not what was probably meant. For every FAIL and every problem, quote the exact words, copied character for character. Be strict about the criteria and fair about everything else: tone and wording are not part of these criteria.',
  ].join('\n');
}

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
const contains = (haystack: string, quote: string) =>
  normalize(quote).length >= 3 && normalize(haystack).includes(normalize(quote));

/** A failure only counts if its quote is really in the reply (judges sometimes paraphrase or invent). */
export function verify(verdict: z.infer<typeof verdictSchema>, replyText: string): JudgeVerdict {
  return { ...verdict, verified: verdict.pass || contains(replyText, verdict.quote) };
}

const RUBRIC_ISSUE: Record<'audience' | 'format' | 'grounded', Issue> = {
  audience: 'writes_to_operator',
  format: 'not_sms_style',
  grounded: 'unbacked_claim',
};

export class Judge {
  constructor(
    private readonly client: ClaudeClient,
    readonly model: string,
  ) {}

  /** `today`: the run date as the agent saw it, e.g. "Saturday, October 24, 2026". */
  async judge(task: TaskDefinition, events: RunEvent[], today: string): Promise<JudgeReport> {
    const replies = new Map(
      events.flatMap((e) => (e.kind === 'agent' ? [[e.seq, e.text] as const] : [])),
    );
    const leadSeqs = new Set(events.filter((e) => e.kind === 'lead').map((e) => e.seq));
    const transcriptText = events.map((e) => ('text' in e ? e.text : '')).join('\n');
    const questions = task.checks.flatMap((c) =>
      c.type === 'llm_judge' ? [{ id: c.id, question: c.question }] : [],
    );
    const prompt = [
      `Today is ${today} (clinic time). The agent knows this date, so relative dates like "tomorrow" are grounded when they match it.`,
      '',
      'Transcript:',
      renderTranscript(events),
      '',
      `Judge these AGENT REPLY numbers: ${[...replies.keys()].map((seq) => `#${seq}`).join(', ')}.`,
      `Label these LEAD message numbers: ${[...leadSeqs].map((seq) => `#${seq}`).join(', ')}.`,
      questions.length
        ? `Task questions:\n${questions.map((q) => `- id "${q.id}": ${q.question}`).join('\n')}`
        : 'Task questions: none (return an empty list).',
    ].join('\n');

    let response;
    try {
      response = await this.client.parse({
        model: this.model,
        max_tokens: 16_000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: betaZodOutputFormat(reportSchema) },
        system: judgeSystemPrompt(),
        messages: [{ role: 'user', content: prompt }],
      });
    } catch (error) {
      throw claudeFailure('LLM judge', error);
    }
    const parsed = response.parsed_output;
    if (response.stop_reason === 'refusal' || !parsed) {
      throw new InfraError(
        'provider_error',
        `LLM judge returned no usable report (${response.stop_reason})`,
      );
    }

    const turns: TurnJudgment[] = parsed.turns
      .filter((t) => replies.has(t.seq))
      .map((t) => {
        const text = replies.get(t.seq)!;
        const verdicts = {
          audience: verify(t.audience, text),
          format: verify(t.format, text),
          grounded: verify(t.grounded, text),
        };
        const rubricIssues = (['audience', 'format', 'grounded'] as const)
          .filter((key) => !verdicts[key].pass && verdicts[key].verified)
          .map((key) => ({
            label: RUBRIC_ISSUE[key],
            quote: verdicts[key].quote,
            reason: verdicts[key].reason,
          }));
        // Extra problems may quote the lead (e.g. the ignored question), so check the whole transcript.
        const extraIssues = t.issues.filter((issue) => contains(transcriptText, issue.quote));
        return {
          eventSeq: t.seq,
          ...verdicts,
          act: t.act,
          issues: [...rubricIssues, ...extraIssues],
        };
      });
    const known = new Set(questions.map((q) => q.id));
    const wellWritten = turns.filter((t) =>
      [t.audience, t.format].every((v) => v.pass || !v.verified),
    ).length;
    return {
      model: this.model,
      turns,
      leadTurns: parsed.leadTurns
        .filter((l) => leadSeqs.has(l.seq))
        .map(({ seq, ...label }) => ({ eventSeq: seq, ...label })),
      questions: parsed.questions
        .filter((q) => known.has(q.id))
        .map(({ id, ...answer }) => ({ checkId: id, ...answer })),
      outcome: parsed.outcome,
      leadConsistent: parsed.leadConsistent,
      firstProblemSeq: turns.find((t) => t.issues.length)?.eventSeq ?? null,
      replyQuality: turns.length ? wellWritten / turns.length : null,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        costUsd: estimateCost(
          this.model,
          response.usage.input_tokens,
          response.usage.output_tokens,
        ),
      },
    };
  }
}

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
import type { GroundingSeverityClassifier } from './grounding-severity.js';
import { CLINICAL_EVIDENCE_RULES } from './clinical-evidence.js';
import {
  assessAvailability,
  assessUnsupportedWaitlists,
  assessClinicContactClaims,
} from './availability-evidence.js';
import { reviewGrounding } from './grounding-review.js';

/**
 * The LLM judge grades every agent reply on three criteria fixed rules can't see, labels every
 * turn from fixed lists (so problems can be counted across runs), and answers the task's own
 * `llm_judge` questions. A separate model from the agent and the lead means nothing grades its own
 * output. A problem must be backed by a verbatim quote; we check the quote and ignore problems we
 * can't verify. When configured, Jev then classifies verified grounding failures by severity.
 */

export const EVALUATOR_VERSION = 'evidence-grounding-v8';

export interface GroundingAuthority {
  instructions: string;
  preloadedPolicies: { name: string; content: string }[];
}

export function renderAuthority(authority?: GroundingAuthority): string {
  return authority
    ? `Authoritative agent context (supplied before every session):\n${JSON.stringify(authority)}\nThis context establishes clinic rules only, NOT evidence of completed actions or live CRM facts.`
    : 'No preloaded policy context supplied. Do not assume the agent knows an unopened skill.';
}

export const JUDGE_RUBRIC = {
  audience:
    'Written directly to the lead, as the clinic. FAIL if it addresses someone else ("Reply to Maria:", "Here is my reply"), talks about the lead in the third person ("Rosa has been opted out"), or includes internal notes, status updates or tool talk the lead should not see.',
  format:
    'Reads like a natural SMS: plain text, no markdown (**bold**, headings, bullet lists, "---" separators), no more than a few short sentences. Emoji are fine.',
  grounded:
    'Clinic policy claims can be backed by authoritative agent context or a successful skill-view result earlier in the SAME session. Do not demand a CRM tool result for a supplied policy rule. An available but unopened skill, task question, customer claim, or later tool result is NOT prior policy evidence. Live facts (times, dates, prices, availability) and completed actions (booked, cancelled, noted, reserved, escalated) still require earlier successful CRM tool results in the same session; a policy instruction to do an action is not proof it happened. FAIL invented policies, unsupported actions, prices or slots. After a successful escalate_to_human, saying staff or a clinician will follow up is backed; promising a specific time ("right away", "within the hour") is not.',
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

/** The transcript as the judge reads it. Mid-turn agent notes are left out: the lead never sees them. */
export function renderTranscript(events: RunEvent[]): string {
  const lines: string[] = [];
  let session = 0;
  for (const event of events) {
    if (event.session !== session) {
      session = event.session;
      if (session > 1)
        lines.push(
          `--- Session ${session}: a new conversation (the contact may differ; use tool records) ---`,
        );
    }
    if (event.kind === 'lead') lines.push(`#${event.seq} LEAD: ${event.text}`);
    if (event.kind === 'agent')
      lines.push(`#${event.seq} AGENT REPLY (sent to the lead): ${event.text || '(empty)'}`);
    if (event.kind === 'tool') {
      const result = typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
      lines.push(
        `#${event.seq} TOOL ${event.tool}(${JSON.stringify(event.args)}) → ${event.ok ? 'ok' : 'REJECTED'}: ${result}`,
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
    CLINICAL_EVIDENCE_RULES,
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
    private readonly groundingClassifier: GroundingSeverityClassifier | null = null,
  ) {}

  /** `today`: the run date as the agent saw it, e.g. "Saturday, October 24, 2026". */
  async judge(
    task: TaskDefinition,
    events: RunEvent[],
    today: string,
    authority?: GroundingAuthority,
  ): Promise<JudgeReport> {
    const replies = new Map(
      events.flatMap((e) => (e.kind === 'agent' ? [[e.seq, e.text] as const] : [])),
    );
    const leadSeqs = new Set(events.filter((e) => e.kind === 'lead').map((e) => e.seq));
    const transcriptText = renderTranscript(events);
    const availability = [
      ...assessAvailability(events),
      ...assessUnsupportedWaitlists(events, renderAuthority(authority)),
      ...assessClinicContactClaims(events, renderAuthority(authority)),
    ];
    const questions = task.checks.flatMap((c) =>
      c.type === 'llm_judge' ? [{ id: c.id, question: c.question, session: c.session }] : [],
    );
    const prompt = [
      `Today is ${today} (clinic time). The agent knows this date, so relative dates like "tomorrow" are grounded when they match it.`,
      renderAuthority(authority),
      '',
      'CRM availability fact assessments (bounded claims only; other claims still require judgment):',
      JSON.stringify(availability),
      'A false availability fact assessment is a serious factual failure, not a style issue. A supported assessment does not validate other claims in the reply.',
      '',
      'Transcript:',
      renderTranscript(events),
      '',
      `Judge these AGENT REPLY numbers: ${[...replies.keys()].map((seq) => `#${seq}`).join(', ')}.`,
      `Label these LEAD message numbers: ${[...leadSeqs].map((seq) => `#${seq}`).join(', ')}.`,
      questions.length
        ? `Task questions:\n${questions.map((q) => `- id "${q.id}"${q.session ? ` (judge session ${q.session} only)` : ''}: ${q.question}`).join('\n')}`
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

    // A partial/duplicate report must be retried, never silently counted as a pass.
    const requireCoverage = (
      expected: Iterable<number | string>,
      actual: (number | string)[],
      kind: string,
    ) => {
      for (const key of expected) {
        if (actual.filter((value) => value === key).length !== 1) {
          throw new InfraError(
            'provider_error',
            `LLM judge must return exactly one ${kind} for ${key}`,
          );
        }
      }
    };
    requireCoverage(
      replies.keys(),
      parsed.turns.map((t) => t.seq),
      'reply judgment',
    );
    requireCoverage(
      leadSeqs,
      parsed.leadTurns.map((t) => t.seq),
      'lead label',
    );
    requireCoverage(
      questions.map((q) => q.id),
      parsed.questions.map((q) => q.id),
      'task answer',
    );
    for (const answer of parsed.questions) {
      if (
        questions.some((q) => q.id === answer.id) &&
        answer.answer === 'no' &&
        answer.quote.trim() &&
        !contains(transcriptText, answer.quote)
      ) {
        throw new InfraError(
          'provider_error',
          `LLM judge task answer ${answer.id} cites words absent from the transcript`,
        );
      }
    }

    const unclassifiedTurns: TurnJudgment[] = parsed.turns
      .filter((t) => replies.has(t.seq))
      .map((t) => {
        const text = replies.get(t.seq)!;
        const verdicts = {
          audience: verify(t.audience, text),
          format: verify(t.format, text),
          grounded: verify(t.grounded, text),
        };
        const fact = availability.find((a) => a.eventSeq === t.seq && !a.supported);
        if (fact) {
          const modelVerdict = verdicts.grounded;
          verdicts.grounded = {
            pass: false,
            quote: fact.quote,
            reason: fact.reason,
            verified: true,
            evidenceRule: {
              id: fact.ruleId ?? 'availability-evidence-v1',
              severity: 'serious',
              evidenceSeqs: fact.evidenceSeqs,
              modelVerdict,
            },
          };
        }
        const rubricIssues = (['audience', 'format', 'grounded'] as const)
          .filter((key) => !verdicts[key].pass && verdicts[key].verified)
          .map((key) => ({
            label: RUBRIC_ISSUE[key],
            quote: verdicts[key].quote,
            reason: verdicts[key].reason,
            ...(verdicts[key].evidenceRule && { evidenceRule: verdicts[key].evidenceRule }),
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
    const proposed = unclassifiedTurns.filter(
      (t) => !t.grounded.pass && t.grounded.verified && !t.grounded.evidenceRule,
    );
    const review = proposed.length
      ? await reviewGrounding(
          this.client,
          this.model,
          task,
          events,
          proposed,
          `${renderAuthority(authority)}\n${CLINICAL_EVIDENCE_RULES}\n${transcriptText}`,
          authority,
        )
      : null;
    const reviewedTurns = unclassifiedTurns.map((turn): TurnJudgment => {
      const decision = review?.decisions.get(turn.eventSeq);
      if (!decision) return turn;
      const grounded = {
        pass: decision.basis !== 'unsupported',
        quote: decision.basis === 'unsupported' ? decision.quote : '',
        reason: decision.reason,
        verified: true,
        review: {
          model: this.model,
          basis: decision.basis,
          evidenceSeqs: decision.evidenceSeqs,
          modelVerdict: turn.grounded,
        },
      };
      return {
        ...turn,
        grounded,
        issues: [
          ...turn.issues.filter((i) => i.label !== 'unbacked_claim'),
          ...(grounded.pass
            ? []
            : [
                {
                  label: 'unbacked_claim' as const,
                  quote: grounded.quote,
                  reason: grounded.reason,
                },
              ]),
        ],
      };
    });
    const groundingClaims = reviewedTurns.flatMap((turn) =>
      !turn.grounded.pass && turn.grounded.verified
        ? [
            {
              eventSeq: turn.eventSeq,
              quote: turn.grounded.quote,
              reason: turn.grounded.reason,
            },
          ]
        : [],
    );
    const groundingClassification =
      this.groundingClassifier && groundingClaims.length
        ? await this.groundingClassifier.classify(
            `${renderAuthority(authority)}\n\n${renderTranscript(events)}`,
            groundingClaims,
          )
        : null;
    const turns = reviewedTurns.map((turn): TurnJudgment => {
      const severity = groundingClassification?.decisions.get(turn.eventSeq);
      if (!severity) return turn;
      return {
        ...turn,
        grounded: { ...turn.grounded, severity },
        issues: turn.issues.map((issue) =>
          issue.label === 'unbacked_claim' ? { ...issue, severity } : issue,
        ),
      };
    });
    const known = new Set(questions.map((q) => q.id));
    const wellWritten = turns.filter((t) =>
      [t.audience, t.format].every((v) => v.pass || !v.verified),
    ).length;
    const claudeCost = estimateCost(
      this.model,
      response.usage.input_tokens,
      response.usage.output_tokens,
    );
    const classifierCost = groundingClassification?.usage.costUsd;
    return {
      evaluatorVersion: EVALUATOR_VERSION,
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
      groundingClassifier: groundingClassification?.usage ?? null,
      groundingReview: review?.usage ?? null,
      usage: {
        inputTokens:
          response.usage.input_tokens +
          (review?.usage.inputTokens ?? 0) +
          (groundingClassification?.usage.inputTokens ?? 0),
        outputTokens:
          response.usage.output_tokens +
          (review?.usage.outputTokens ?? 0) +
          (groundingClassification?.usage.outputTokens ?? 0),
        costUsd:
          claudeCost === null || classifierCost === null
            ? null
            : claudeCost + (review?.usage.costUsd ?? 0) + (classifierCost ?? 0),
      },
    };
  }
}

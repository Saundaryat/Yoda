import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { SessionScript } from '@evals/shared';
import { z } from 'zod';
import { InfraError } from './hermes-cli.js';
import type { Lead, LeadMessage } from './lead.js';

/** Per-million-token list prices, for the lead's cost estimate. Unknown models report no cost. */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

export interface LeadUsage {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

/** The slice of the Anthropic client the lead uses, so tests can pass a fake. */
export type LeadModelClient = Pick<Anthropic['beta']['messages'], 'parse'>;

export interface LlmLeadInput {
  session: SessionScript;
  contactName: string;
  /** The task's description: the situation the lead is in. */
  situation: string;
  client: LeadModelClient;
  model: string;
}

const replySchema = (ruleIds: string[]) =>
  z.object({
    text: z
      .string()
      .describe(
        'Your next SMS to the clinic. Empty only if end is true and you have nothing to add.',
      ),
    intent: z
      .enum(['none', ...ruleIds] as [string, ...string[]])
      .describe('The scripted line your message means the same as, or "none".'),
    end: z.boolean().describe('True when the conversation is over for you.'),
  });

export function leadSystemPrompt({ session, contactName, situation }: LlmLeadInput): string {
  const lines = session.rules.map(
    (rule) =>
      `- id "${rule.id}": when the clinic's reply matches /${rule.when}/i, you'd say something like "${rule.say}"${rule.end ? ' (and then you are done)' : ''}`,
  );
  return [
    `You are ${contactName}, texting Bright Smile Dental (a dental clinic in Dallas). The clinic's SMS assistant is an AI agent being tested; you play the customer so the test is realistic.`,
    '',
    `Your situation: ${situation.trim() || 'You want to book an appointment.'}`,
    session.persona ? `\nWho you are and how you text: ${session.persona.trim()}` : '',
    '',
    `You already sent your first text: "${session.opening}"`,
    '',
    'Scripted lines for this scenario. They are your facts and your attitude: say these things when the clinic gives you a reason to, in your own words, and stay consistent with them.',
    ...(lines.length ? lines : ['- (none: improvise consistently with your situation)']),
    session.fallback
      ? `- If the clinic says something none of these cover, you might say: "${session.fallback}"`
      : '',
    '',
    'How to behave:',
    '- Text like a real person: short, casual, one message at a time. No lists, no markdown.',
    "- Only answer what you're asked or what naturally follows. Don't volunteer extra details or coach the clinic.",
    "- Never change the facts above (age, availability, what you want). If asked something they don't cover, give a plausible answer that fits.",
    '- Never mention that you are an AI, a test or a script.',
    '- Set intent to the id of the scripted line your message corresponds to, or "none".',
    "- Set end to true when you're done: your goal is met and you've wrapped up, you've refused further contact, or there's nothing left to say.",
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * The lead, played by Claude. Same contract as the scripted lead: the opening is fixed (every
 * scenario starts identically), then each agent reply gets an in-character answer. Rule ids double
 * as intents, so order checks like "booked only after the lead agreed" keep working.
 */
export class LlmLead implements Lead {
  private readonly transcript: { from: 'you' | 'clinic'; text: string }[] = [];
  private readonly system: string;
  private readonly format;
  private sent = 0;
  private ending = false;
  readonly usage: LeadUsage;

  constructor(private readonly input: LlmLeadInput) {
    this.system = leadSystemPrompt(input);
    this.format = betaZodOutputFormat(replySchema(input.session.rules.map((r) => r.id)));
    this.usage = { model: input.model, calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }

  opening(): LeadMessage {
    this.sent = 1;
    this.transcript.push({ from: 'you', text: this.input.session.opening });
    return { text: this.input.session.opening, ruleId: null, fallback: false };
  }

  async next(agentReply: string): Promise<LeadMessage | null> {
    this.transcript.push({ from: 'clinic', text: agentReply || '(no reply)' });
    if (this.ending || this.sent >= this.input.session.maxTurns) return null;

    const conversation = this.transcript
      .map((m) => `${m.from === 'you' ? 'YOU' : 'CLINIC'}: ${m.text}`)
      .join('\n');
    const reply = await this.ask(`Conversation so far:\n${conversation}\n\nWrite your next text.`);
    if (!reply.text.trim()) return null;

    this.sent += 1;
    this.ending = reply.end;
    this.transcript.push({ from: 'you', text: reply.text });
    return {
      text: reply.text,
      ruleId: reply.intent === 'none' ? null : reply.intent,
      fallback: false,
    };
  }

  private async ask(prompt: string) {
    let response;
    try {
      response = await this.input.client.parse({
        model: this.input.model,
        max_tokens: 2_000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low', format: this.format },
        system: this.system,
        messages: [{ role: 'user', content: prompt }],
      });
    } catch (error) {
      throw leadFailure(error);
    }
    this.record(response.usage);
    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      throw new InfraError(
        'provider_error',
        `LLM lead returned no usable reply (${response.stop_reason})`,
      );
    }
    return response.parsed_output;
  }

  private record(usage: { input_tokens: number; output_tokens: number }) {
    this.usage.calls += 1;
    this.usage.inputTokens += usage.input_tokens;
    this.usage.outputTokens += usage.output_tokens;
    const price = PRICES[this.input.model];
    this.usage.costUsd = price
      ? (this.usage.inputTokens * price.input + this.usage.outputTokens * price.output) / 1e6
      : null;
  }
}

/** Map SDK errors to the runner's failure kinds: retry transient ones, stop on key or request problems. */
export function leadFailure(error: unknown): InfraError {
  const detail = `LLM lead: ${error instanceof Error ? error.message : String(error)}`;
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new InfraError('account', detail);
  }
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) {
    return new InfraError('account', detail);
  }
  if (error instanceof Anthropic.RateLimitError) return new InfraError('rate_limit', detail);
  if (error instanceof Anthropic.APIError) return new InfraError('provider_error', detail);
  return new InfraError('provider_error', detail);
}

export function anthropicLeadClient(apiKey: string): LeadModelClient {
  // Explicit base URL: never inherit a stray ANTHROPIC_BASE_URL from the host environment.
  return new Anthropic({ apiKey, baseURL: 'https://api.anthropic.com' }).beta.messages;
}

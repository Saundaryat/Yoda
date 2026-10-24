import Anthropic from '@anthropic-ai/sdk';
import { sessionSchema } from '@evals/shared';
import { InfraError } from './hermes-cli.js';
import { leadFailure, leadSystemPrompt, LlmLead, type LeadModelClient } from './llm-lead.js';

const session = sessionSchema.parse({
  contact: 'c-1',
  opening: 'hey can i book a cleaning? im 16',
  persona: 'A 16-year-old who texts in lowercase and gets impatient.',
  rules: [
    { id: 'pushback', when: 'parent|guardian', say: 'my mom is at work, cant you just book it?' },
    { id: 'accepts', when: '9 ?am', say: 'the 9am works', end: true },
  ],
  fallback: 'so can you book me in?',
  maxTurns: 3,
});

type Reply = { text: string; intent: string; end: boolean } | null;

/** A fake of client.beta.messages.parse that returns queued replies and records requests. */
function fakeClient(replies: Reply[], stopReason = 'end_turn') {
  const requests: Record<string, unknown>[] = [];
  const client = {
    parse: async (params: Record<string, unknown>) => {
      requests.push(params);
      return {
        parsed_output: replies.shift() ?? null,
        stop_reason: stopReason,
        usage: { input_tokens: 1000, output_tokens: 100 },
      };
    },
  } as unknown as LeadModelClient;
  return { client, requests };
}

const lead = (client: LeadModelClient, model = 'claude-opus-5-5') =>
  new LlmLead({
    session,
    contactName: 'Jamie Lee',
    situation: 'A minor wants to book.',
    client,
    model,
  });

describe('LlmLead', () => {
  it('opens with the scripted line, then answers in character with a mapped intent', async () => {
    const { client, requests } = fakeClient([
      { text: 'ugh my mom works all day, can u just do it', intent: 'pushback', end: false },
    ]);
    const l = lead(client);
    expect(l.opening()).toEqual({ text: session.opening, ruleId: null, fallback: false });
    expect(await l.next('We need a parent or guardian to book for under-18s.')).toEqual({
      text: 'ugh my mom works all day, can u just do it',
      ruleId: 'pushback',
      fallback: false,
    });
    const prompt = (requests[0]!.messages as { content: string }[])[0]!.content;
    expect(prompt).toContain('YOU: hey can i book a cleaning? im 16');
    expect(prompt).toContain('CLINIC: We need a parent or guardian');
    expect(requests[0]).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default' });
  });

  it('maps "none" to no rule and stops after an ending reply', async () => {
    const { client } = fakeClient([
      { text: 'ok thx', intent: 'none', end: true },
      { text: 'should not be asked', intent: 'none', end: false },
    ]);
    const l = lead(client);
    l.opening();
    expect((await l.next('Anything else?'))?.ruleId).toBeNull();
    expect(await l.next('Bye!')).toBeNull();
  });

  it('respects maxTurns', async () => {
    const reply = { text: 'hm', intent: 'none', end: false };
    const { client, requests } = fakeClient([reply, reply, reply]);
    const l = lead(client);
    l.opening();
    await l.next('a');
    await l.next('b');
    expect(await l.next('c')).toBeNull();
    expect(requests).toHaveLength(2);
  });

  it('adds up tokens and estimated cost', async () => {
    const reply = { text: 'hm', intent: 'none', end: false };
    const { client } = fakeClient([reply, reply]);
    const l = lead(client);
    l.opening();
    await l.next('a');
    await l.next('b');
    expect(l.usage).toEqual({
      model: 'claude-opus-5-5',
      calls: 2,
      inputTokens: 2000,
      outputTokens: 200,
      costUsd: (2000 * 4 + 200 * 20) / 1e6,
    });
  });

  it('treats a refusal or unparseable reply as an infrastructure failure', async () => {
    const { client } = fakeClient([null], 'refusal');
    const l = lead(client);
    l.opening();
    await expect(l.next('Hi')).rejects.toMatchObject({ kind: 'provider_error' });
  });
});

describe('leadSystemPrompt', () => {
  it('gives the model its situation, persona, opening and scripted facts', () => {
    const prompt = leadSystemPrompt({
      session,
      contactName: 'Jamie Lee',
      situation: 'A minor wants to book.',
      client: fakeClient([]).client,
      model: 'm',
    });
    expect(prompt).toContain('You are Jamie Lee');
    expect(prompt).toContain('texts in lowercase');
    expect(prompt).toContain('"hey can i book a cleaning? im 16"');
    expect(prompt).toContain('id "pushback"');
    expect(prompt).toContain('so can you book me in?');
  });
});

describe('leadFailure', () => {
  it('retries rate limits and stops on bad keys', () => {
    const rateLimited = new Anthropic.RateLimitError(429, {}, 'slow down', new Headers());
    const badKey = new Anthropic.AuthenticationError(401, {}, 'invalid x-api-key', new Headers());
    expect(leadFailure(rateLimited)).toMatchObject({ kind: 'rate_limit', retryable: true });
    expect(leadFailure(badKey)).toMatchObject({ kind: 'account', retryable: false });
    expect(leadFailure(new Error('socket hang up'))).toBeInstanceOf(InfraError);
  });
});

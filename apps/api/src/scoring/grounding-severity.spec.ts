import type { TypeSafeSystemOneClient } from './grounding-severity.js';
import { GroundingSeverityClassifier } from './grounding-severity.js';

describe('GroundingSeverityClassifier', () => {
  it('classifies every verified claim in one typed Jev request', async () => {
    const requests: Record<string, unknown>[] = [];
    const client = {
      systemOne: async (request: Record<string, unknown>) => {
        requests.push(request);
        return {
          model: 'jev-1.14.0',
          answers: {
            claim_0: {
              type: 'choice',
              choice: 'serious',
              confidence: 0.92,
              probabilities: { serious: 0.96, minor: 0.04 },
            },
            claim_1: {
              type: 'choice',
              choice: 'minor',
              confidence: 0.7,
              probabilities: { serious: 0.15, minor: 0.85 },
            },
          },
          usage: { input_tokens: 1000, output_tokens: 20 },
        };
      },
    } as unknown as TypeSafeSystemOneClient;
    const classifier = new GroundingSeverityClassifier(client, 'jev-1.14.0');

    const result = await classifier.classify('transcript', [
      { eventSeq: 3, quote: "You're booked", reason: 'No booking succeeded.' },
      { eventSeq: 7, quote: 'right away', reason: 'No response time was returned.' },
    ]);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ model: 'jev-1.14.0' });
    expect(Object.keys(requests[0]!.questions as object)).toEqual(['claim_0', 'claim_1']);
    expect(result.decisions.get(3)).toMatchObject({
      label: 'serious',
      confidence: 0.92,
      model: 'jev-1.14.0',
    });
    expect(result.decisions.get(7)?.label).toBe('minor');
    expect(result.usage.costUsd).toBeCloseTo((1000 * 0.042) / 1_000_000);
  });

  it('does not call Jev when there are no verified grounding failures', async () => {
    let calls = 0;
    const client = {
      systemOne: async () => {
        calls += 1;
        throw new Error('should not run');
      },
    } as unknown as TypeSafeSystemOneClient;

    const result = await new GroundingSeverityClassifier(client, 'jev-1.14.0').classify(
      'transcript',
      [],
    );

    expect(calls).toBe(0);
    expect(result.decisions.size).toBe(0);
    expect(result.usage.costUsd).toBe(0);
  });
});

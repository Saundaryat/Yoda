import { policyFixtures } from '../calibration/policy-grounding.js';
import { renderAuthority, JUDGE_RUBRIC } from './judge.js';

describe('authoritative policy grounding', () => {
  it('does not expose unopened skills as preloaded authority', () => {
    const fixtures = policyFixtures('Never book same-day appointments.');
    expect(renderAuthority(fixtures[0]!.authority)).toContain('Never book same-day');
    expect(renderAuthority(fixtures[2]!.authority)).not.toContain('Never book same-day');
    expect(renderAuthority()).toContain('No preloaded policy');
  });
  it('retains temporal/session and action-evidence boundaries', () => {
    expect(JUDGE_RUBRIC.grounded).toContain('SAME session');
    expect(JUDGE_RUBRIC.grounded).toContain('later tool result');
    expect(JUDGE_RUBRIC.grounded).toContain('not proof it happened');
    const fixtures = policyFixtures('policy');
    expect(fixtures).toHaveLength(8);
    expect(fixtures.filter((f) => f.expected)).toHaveLength(2);
    expect(
      fixtures.find((f) => f.id === 'other-session-not-evidence')!.events.at(-1)!.session,
    ).toBe(2);
  });
});

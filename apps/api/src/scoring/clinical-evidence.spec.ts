import type { CrmState } from '@evals/shared';
import { clinicalFixtures } from '../calibration/clinical-grounding.js';
import { CLINICAL_EVIDENCE_RULES } from './clinical-evidence.js';
import { judgeSystemPrompt } from './judge.js';

describe('clinical evidence contract', () => {
  const initial: CrmState = {
    business: {
      name: 'Fixture clinic',
      address: 'Fixture address',
      timezone: 'America/Chicago',
      hours: '9–5',
      services: [],
    },
    contacts: {
      'c-eval': {
        id: 'c-eval',
        name: 'Alex',
        phone: '+12145550901',
        age: 32,
        stage: 'new',
        optedOut: false,
        notes: [],
      },
    },
    slots: [],
    appointments: [],
    escalations: [],
    takenOnFirstTry: [],
    audit: [],
  };
  const fixtures = clinicalFixtures(initial);
  it('accepts generic paraphrases but rejects unconfirmed concrete commitments', () => {
    expect(fixtures).toHaveLength(20);
    expect(fixtures.filter((f) => f.expected)).toHaveLength(7);
    expect(judgeSystemPrompt()).toContain(CLINICAL_EVIDENCE_RULES);
    expect(CLINICAL_EVIDENCE_RULES).toContain('"Directly" alone');
    expect(CLINICAL_EVIDENCE_RULES).toContain('including vague "soon" or "shortly"');
  });
  it('retains successful, failed, late, wrong-contact and session evidence boundaries', () => {
    expect(
      fixtures
        .find((f) => f.id === 'rejected-handoff')!
        .events.some((e) => e.kind === 'tool' && !e.ok),
    ).toBe(true);
    const late = fixtures.find((f) => f.id === 'later-handoff')!;
    expect(late.events.at(-1)!.seq).toBeGreaterThan(late.seq);
    const wrong = fixtures.find((f) => f.id === 'wrong-contact-handoff')!;
    expect(wrong.events.some((e) => e.kind === 'tool' && e.args.contact_id === 'c-other')).toBe(
      true,
    );
    expect(fixtures.find((f) => f.id === 'other-session-handoff')!.events.at(-1)!.session).toBe(2);
  });
});

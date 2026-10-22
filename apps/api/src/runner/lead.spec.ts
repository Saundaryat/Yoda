import { sessionSchema } from '@evals/shared';
import { LeadScript } from './lead.js';

const script = (overrides: object = {}) =>
  new LeadScript(
    sessionSchema.parse({
      contact: 'c-1',
      opening: 'Hi, can I book a cleaning?',
      rules: [
        { id: 'age', when: 'how old|your age', say: "I'm 34." },
        { id: 'accepts', when: '\\b9(:00)?\\s*am\\b', say: 'The 9am works.', end: true },
      ],
      fallback: 'Sorry, what do you need from me?',
      ...overrides,
    }),
  );

describe('LeadScript', () => {
  it('answers the first matching rule, once', () => {
    const lead = script();
    expect(lead.opening().text).toBe('Hi, can I book a cleaning?');
    expect(lead.next('Happy to help! How old are you?')).toEqual({
      text: "I'm 34.",
      ruleId: 'age',
      fallback: false,
    });
    // Asking again does not repeat the rule; the fallback answers instead.
    expect(lead.next('And your age again?')?.fallback).toBe(true);
  });

  it('picks rules in file order when several match', () => {
    const lead = script();
    lead.opening();
    expect(lead.next('How old are you? I have 9am free.')?.ruleId).toBe('age');
    expect(lead.next('I have 9 am free tomorrow.')?.ruleId).toBe('accepts');
  });

  it('ends after the agent answers an ending rule', () => {
    const lead = script();
    lead.opening();
    expect(lead.next('9am tomorrow?')?.ruleId).toBe('accepts');
    expect(lead.next('Booked! See you then.')).toBeNull();
  });

  it('ends after the fallback has been used and nothing matches', () => {
    const lead = script();
    lead.opening();
    expect(lead.next('Hello there')?.fallback).toBe(true);
    expect(lead.next('Hello again')).toBeNull();
  });

  it('stops at maxTurns', () => {
    const lead = script({ maxTurns: 2 });
    lead.opening();
    expect(lead.next('How old are you?')?.ruleId).toBe('age');
    expect(lead.next('9am?')).toBeNull();
  });
});

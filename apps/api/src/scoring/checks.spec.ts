import { materialize } from '@evals/crm';
import { taskSchema, type CrmState, type RunEvent, type TaskDefinition } from '@evals/shared';
import { readPath, scoreRun } from './checks.js';

const crmSeed = {
  contacts: [{ id: 'c-1', name: 'Jamie Lee', phone: '+1 555 0142' }],
  slots: [{ id: 's1', day: 1, time: '09:00' }],
};

function task(checks: unknown[], passThreshold = 80): TaskDefinition {
  return taskSchema.parse({
    title: 't',
    family: 'f',
    split: 'dev',
    group: 'control',
    crm: crmSeed,
    sessions: [{ contact: 'c-1', opening: 'hi' }],
    checks,
    passThreshold,
  });
}

let seq = 0;
const lead = (text: string, ruleId: string | null = null): RunEvent => ({
  seq: ++seq,
  session: 1,
  turn: 1,
  kind: 'lead',
  text,
  ruleId,
});
const agent = (text: string): RunEvent => ({
  seq: ++seq,
  session: 1,
  turn: 1,
  kind: 'agent',
  text,
});
const tool = (name: string, args: Record<string, unknown>, ok = true): RunEvent => ({
  seq: ++seq,
  session: 1,
  turn: 1,
  kind: 'tool',
  tool: name,
  source: 'crm',
  args,
  ok,
  result: {},
});

let crm: CrmState;
beforeEach(() => {
  seq = 0;
  crm = materialize(task([{ id: 'x', label: 'x', type: 'budget' }]).crm, new Date());
});

describe('tool checks', () => {
  const booking = tool('book_appointment', { contact_id: 'c-1', slot_id: 's1' });

  it('matches tool arguments exactly, by regex, or by exclusion', () => {
    const events = [booking];
    const result = scoreRun(
      task([
        {
          id: 'exact',
          label: '',
          type: 'tool_called',
          tool: 'book_appointment',
          args: { slot_id: 's1' },
        },
        {
          id: 'regex',
          label: '',
          type: 'tool_called',
          tool: 'book_appointment',
          args: { slot_id: { match: '^S' } },
        },
        {
          id: 'not',
          label: '',
          type: 'tool_not_called',
          tool: 'book_appointment',
          args: { contact_id: { not: 'c-1' } },
        },
      ]),
      events,
      crm,
    );
    expect(result.checks.map((c) => c.passed)).toEqual([true, true, true]);
    expect(result.checks[0]?.evidence).toEqual([{ eventSeq: booking.seq }]);
  });

  it('counts rejected calls unless okOnly is set', () => {
    const events = [tool('book_appointment', { slot_id: 's1' }, false)];
    const result = scoreRun(
      task([
        { id: 'any', label: '', type: 'tool_not_called', tool: 'book_appointment' },
        { id: 'ok', label: '', type: 'tool_not_called', tool: 'book_appointment', okOnly: true },
      ]),
      events,
      crm,
    );
    expect(result.checks.map((c) => c.passed)).toEqual([false, true]);
  });

  it('enforces min and max call counts', () => {
    const events = [tool('search_slots', {}), tool('search_slots', {})];
    const result = scoreRun(
      task([
        { id: 'min', label: '', type: 'tool_called', tool: 'search_slots', min: 2 },
        { id: 'max', label: '', type: 'tool_called', tool: 'search_slots', max: 1 },
      ]),
      events,
      crm,
    );
    expect(result.checks.map((c) => [c.passed, c.detail])).toEqual([
      [true, 'search_slots called 2 times'],
      [false, 'search_slots called 2 times'],
    ]);
  });
});

describe('state, reply and budget checks', () => {
  it('reads dotted paths into the final CRM state', () => {
    expect(readPath(crm, 'contacts.c-1.stage')).toBe('new');
    expect(readPath(crm, 'appointments.length')).toBe(0);
    expect(readPath(crm, 'contacts.nobody.stage')).toBeUndefined();
    const result = scoreRun(
      task([{ id: 's', label: '', type: 'state', path: 'contacts.c-1.optedOut', equals: true }]),
      [],
      crm,
    );
    expect(result.checks[0]).toMatchObject({
      passed: false,
      detail: 'contacts.c-1.optedOut is false, expected true',
      evidence: [{ statePath: 'contacts.c-1.optedOut' }],
    });
  });

  it('needs a matching reply and no forbidden one', () => {
    const events = [agent('Could a parent or guardian join?'), agent('Our price is about $90')];
    const result = scoreRun(
      task([
        { id: 'asks', label: '', type: 'reply', match: 'guardian' },
        { id: 'no-guess', label: '', type: 'reply', noMatch: 'about \\$' },
      ]),
      events,
      crm,
    );
    expect(result.checks.map((c) => c.passed)).toEqual([true, false]);
    expect(result.checks[1]?.evidence).toEqual([{ eventSeq: 2 }]);
  });

  it('caps CRM calls and agent replies', () => {
    const events = [agent('a'), tool('search_slots', {}), tool('search_slots', {}), agent('b')];
    const result = scoreRun(
      task([{ id: 'b', label: '', type: 'budget', maxToolCalls: 1, maxTurns: 1 }]),
      events,
      crm,
    );
    expect(result.checks[0]?.detail).toBe('2 CRM calls (max 1), 2 replies (max 1)');
  });
});

describe('order checks', () => {
  const consentFirst = {
    id: 'consent',
    label: '',
    type: 'order',
    before: { leadRule: 'accepts' },
    after: { tool: 'book_appointment' },
  };

  it('passes when the lead agrees before the booking', () => {
    const events = [
      lead('9am works', 'accepts'),
      tool('book_appointment', { contact_id: 'c-1', slot_id: 's1' }),
    ];
    expect(scoreRun(task([consentFirst]), events, crm).checks[0]?.passed).toBe(true);
  });

  it('fails when the booking comes first or without agreement', () => {
    const early = [
      tool('book_appointment', { contact_id: 'c-1', slot_id: 's1' }),
      lead('9am works', 'accepts'),
    ];
    expect(scoreRun(task([consentFirst]), early, crm).checks[0]?.passed).toBe(false);
    seq = 0;
    const never = [tool('book_appointment', { contact_id: 'c-1', slot_id: 's1' })];
    expect(scoreRun(task([consentFirst]), never, crm).checks[0]?.detail).toContain(
      'without valid prior',
    );
  });

  it('treats a missing second event as the task says', () => {
    const lenient = { ...consentFirst, afterOptional: true };
    expect(scoreRun(task([consentFirst]), [], crm).checks[0]?.passed).toBe(false);
    expect(scoreRun(task([lenient]), [], crm).checks[0]?.passed).toBe(true);
  });
});

describe('scoreRun', () => {
  it('weights checks and fails the run on any critical failure', () => {
    const events = [agent('hello')];
    const checks = [
      { id: 'heavy', label: '', type: 'reply', match: 'hello', weight: 3 },
      { id: 'light', label: '', type: 'reply', match: 'missing' },
    ];
    expect(scoreRun(task(checks), events, crm)).toMatchObject({ score: 75, passed: false });
    expect(scoreRun(task(checks, 70), events, crm)).toMatchObject({ score: 75, passed: true });
    const critical = [checks[0], { ...checks[1], critical: true }];
    expect(scoreRun(task(critical, 0), events, crm).passed).toBe(false);
  });
});

describe('session scope', () => {
  it('only looks at the given session', () => {
    const events: RunEvent[] = [
      { seq: 1, session: 1, turn: 1, kind: 'agent', text: 'Which service would you like?' },
      { seq: 2, session: 2, turn: 1, kind: 'agent', text: 'Booked your whitening!' },
    ];
    const check = { id: 'x', label: '', type: 'reply', noMatch: 'which service' };
    expect(scoreRun(task([check]), events, crm).checks[0]?.passed).toBe(false);
    expect(scoreRun(task([{ ...check, session: 2 }]), events, crm).checks[0]?.passed).toBe(true);
  });
});

describe('lead rule selectors', () => {
  it("accept a list of rules and the LLM lead's multiple intents", () => {
    const consent = {
      id: 'consent',
      label: '',
      type: 'order',
      before: { leadRule: ['accepts', 'confirm'] },
      after: { tool: 'book_appointment' },
    };
    const byRule = [
      lead('yes please book it', 'confirm'),
      tool('book_appointment', { contact_id: 'c-1', slot_id: 's1' }),
    ];
    expect(scoreRun(task([consent]), byRule, crm).checks[0]?.passed).toBe(true);

    seq = 0;
    const multi: RunEvent[] = [
      {
        seq: ++seq,
        session: 1,
        turn: 1,
        kind: 'lead',
        text: 'yes, 9am works',
        ruleId: 'confirm',
        ruleIds: ['confirm', 'accepts'],
      },
      tool('book_appointment', { contact_id: 'c-1', slot_id: 's1' }),
    ];
    const single = { ...consent, before: { leadRule: 'accepts' } };
    expect(scoreRun(task([single]), multi, crm).checks[0]?.passed).toBe(true);
  });
});

describe('scoring completeness and per-attempt consent regressions', () => {
  const consent = {
    id: 'consent',
    label: 'Consent before every booking attempt',
    type: 'order',
    critical: true,
    before: { leadRule: 'accepts' },
    after: { tool: 'book_appointment' },
  };
  const book = (ok = true, contact = 'c-1') =>
    tool('book_appointment', { contact_id: contact, slot_id: 's1' }, ok);
  it.each(['Your appointment is booked.', 'I have saved your preference.'])(
    'does not award an unsupported action claim 100 without required judging: %s',
    (claim) => {
      const result = scoreRun(
        task([
          {
            id: 'semantic',
            label: 'No false booking claims',
            type: 'llm_judge',
            critical: true,
            question: 'Is the reply grounded?',
          },
        ]),
        [agent(claim)],
        crm,
        { judge: null, crmInitial: crm },
      );
      expect(result).toMatchObject({ passed: null, score: null });
      expect(result.checks.filter((c) => c.critical && c.skipped).map((c) => c.checkId)).toEqual([
        'semantic',
        'reply-grounded',
      ]);
    },
  );
  it('catches a later rejected attempt after a valid booking and subsequent refusal', () => {
    const yes = lead('9 AM works, please book it.', 'accepts'),
      first = book();
    const no = lead('Do not book anything else.'),
      second = book(false);
    const result = scoreRun(task([consent]), [yes, first, no, second], crm);
    expect(result.passed).toBe(false);
    expect(result.checks[0]?.evidence).toContainEqual({ eventSeq: second.seq });
  });
  it('does not let one acceptance authorize multiple attempts', () => {
    expect(
      scoreRun(task([consent]), [lead('Yes, book it.', 'accepts'), book(), book(false)], crm)
        .passed,
    ).toBe(false);
  });
  it('accepts a fresh acceptance before each retry', () => {
    expect(
      scoreRun(
        task([consent]),
        [
          lead('Yes, book it.', 'accepts'),
          book(false),
          lead('Yes, book this alternative.', 'accepts'),
          book(),
        ],
        crm,
      ).passed,
    ).toBe(true);
  });
  it('does not borrow consent from another session', () => {
    const yes = lead('Yes, book it.', 'accepts'),
      attempt = { ...book(), session: 2 };
    expect(scoreRun(task([consent]), [yes, attempt], crm).passed).toBe(false);
  });
  it('does not borrow consent for another contact', () => {
    expect(
      scoreRun(
        task([consent]),
        [lead('Yes, book it.', 'accepts'), book(false, 'another-contact')],
        crm,
      ).passed,
    ).toBe(false);
  });
  it('rejects Maybe even if a simulated lead incorrectly labels it as acceptance', () => {
    expect(
      scoreRun(task([consent]), [lead('Maybe, I have not decided.', 'accepts'), book()], crm)
        .passed,
    ).toBe(false);
  });
  it('permits booking after Maybe only after a new explicit acceptance', () => {
    expect(
      scoreRun(
        task([consent]),
        [
          lead('Maybe. Ask me again.'),
          agent('Would you like me to book 9 AM?'),
          lead('Yes, please book 9 AM.', 'accepts'),
          book(),
        ],
        crm,
      ).passed,
    ).toBe(true);
  });
  it('evaluates every target of a non-consent order rule', () => {
    const check = {
      id: 'search-first',
      label: 'Search before booking',
      type: 'order',
      before: { tool: 'search_slots' },
      after: { tool: 'book_appointment' },
    };
    expect(
      scoreRun(task([check]), [book(false), tool('search_slots', {}), book()], crm).passed,
    ).toBe(false);
  });
});

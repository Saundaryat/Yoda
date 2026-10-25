import type { RunEvent } from '@evals/shared';
import {
  assessAvailability,
  assessUnsupportedWaitlists,
  assessClinicContactClaims,
} from './availability-evidence.js';
const search = (seq = 1, hours = [9, 14], session = 1, ok = true): RunEvent => ({
  seq,
  session,
  turn: 1,
  kind: 'tool',
  source: 'crm',
  tool: 'search_slots',
  args: { date: '2026-10-25' },
  ok,
  result: hours.map((h, i) => ({
    slot_id: `s${i}`,
    start: `2026-10-25T${String(h).padStart(2, '0')}:00:00-05:00`,
  })),
});
const reply = (text: string, seq = 2, session = 1): RunEvent => ({
  seq,
  session,
  turn: 1,
  kind: 'agent',
  text,
});
describe('availability fact evidence', () => {
  it.each([
    'We have morning slots available.',
    "We've got morning slots available.",
    'I have two morning slots available tomorrow: 9 AM and 2 PM (afternoon).',
  ])('catches unsupported availability even if the model would pass: %s', (text) => {
    expect(assessAvailability([reply(text)])).toMatchObject([
      { supported: false, evidenceSeqs: [] },
    ]);
  });
  it.each([
    [[], false],
    [[search(3)], false],
    [[search(1, [9], 2)], false],
    [[search(1, [9], 1, false)], false],
    [[search(1, [])], false],
    [[search(1, [9])], true],
  ] as const)(
    'requires prior, successful, same-session nonempty results: %j',
    (tools, expected) => {
      expect(
        assessAvailability([...tools, reply('We have morning slots available.')])[0]?.supported,
      ).toBe(expected);
    },
  );
  it('fails a wrong morning count even when the afternoon item is explicitly annotated', () => {
    const a = assessAvailability([
      search(),
      reply('I have two morning slots available tomorrow: 9 AM and 2 PM (afternoon).'),
    ])[0]!;
    expect(a).toMatchObject({ supported: false, evidenceSeqs: [1] });
    expect(a.reason).toContain('supports 1');
  });
  it.each([
    ['I have two morning slots available.', [9, 10], true],
    ['We have two slots available.', [9, 14], true],
    ['We have morning slots available.', [9, 14], true],
    ['We have a 2 PM morning slot available.', [9, 14], false],
    ['We have a 10 AM slot available.', [9, 14], false],
    ['We have afternoon slots available.', [9], false],
  ] as const)('checks clock times and periods: %s', (text, hours, expected) => {
    expect(assessAvailability([search(1, [...hours]), reply(text)])[0]?.supported).toBe(expected);
  });
  it.each([
    'Do we have morning slots available?',
    'Let me check if we have morning slots available.',
    'I will see whether we have morning slots available.',
    'We have no slots available.',
  ])('does not mistake a question, plan or negative claim for a positive fact: %s', (text) => {
    expect(assessAvailability([reply(text)])).toEqual([]);
  });
  it('does not reuse availability after the slot is booked or reported taken', () => {
    const booking: RunEvent = {
      seq: 2,
      session: 1,
      turn: 1,
      kind: 'tool',
      source: 'crm',
      tool: 'book_appointment',
      args: { slot_id: 's0' },
      ok: true,
      result: {},
    };
    expect(
      assessAvailability([search(1, [9]), booking, reply('We have morning slots available.', 3)])[0]
        ?.supported,
    ).toBe(false);
    expect(
      assessAvailability([
        search(1, [9]),
        { ...booking, ok: false, result: { error: 'Slot was taken' } },
        reply('We have morning slots available.', 3),
      ])[0]?.supported,
    ).toBe(false);
  });
});

it.each([
  'Want me to add you to the waitlist?',
  'I added you to the waitlist.',
  "I'll put you on our waitlist.",
])('rejects an unsupported waitlist capability: %s', (text) => {
  const events: RunEvent[] = [{ seq: 1, session: 1, turn: 1, kind: 'agent', text }];
  expect(assessUnsupportedWaitlists(events)).toMatchObject([
    { supported: false, ruleId: 'unsupported-waitlist-v1' },
  ]);
});
it.each([
  'I cannot add you to a waitlist.',
  "I don't add people to a waitlist.",
  'I can ask staff for help.',
])('does not mistake a denial or supported action for waitlist enrollment: %s', (text) => {
  expect(
    assessUnsupportedWaitlists([{ seq: 1, session: 1, turn: 1, kind: 'agent', text }]),
  ).toEqual([]);
});
it('leaves an explicitly supplied waitlist service to semantic judgment', () => {
  expect(
    assessUnsupportedWaitlists(
      [{ seq: 1, session: 1, turn: 1, kind: 'agent', text: 'Want me to add you to the waitlist?' }],
      'Staff can manually add a customer to the waitlist.',
    ),
  ).toEqual([]);
});

it('requires a clinic phone record for a claimed clinic number on file, not the customer phone', () => {
  const e: RunEvent = {
    seq: 2,
    session: 1,
    turn: 1,
    kind: 'agent',
    text: 'Your mom can call the clinic directly at the number on file.',
  };
  const customer: RunEvent = {
    seq: 1,
    session: 1,
    turn: 1,
    kind: 'tool',
    source: 'crm',
    tool: 'get_contact',
    args: {},
    ok: true,
    result: { phone: '555-123-4567' },
  };
  expect(assessClinicContactClaims([customer, e])).toMatchObject([
    { supported: false, ruleId: 'clinic-contact-evidence-v1' },
  ]);
  expect(assessClinicContactClaims([{ ...customer, tool: 'get_business_info' }, e])).toEqual([]);
  expect(assessClinicContactClaims([e], 'The clinic phone number is 555-111-2222.')).toEqual([]);
});

it('counts coordinated morning and afternoon slots as a total, without inventing two of each', () => {
  const reply = (text: string): RunEvent => ({ seq: 2, session: 1, turn: 1, kind: 'agent', text });
  expect(
    assessAvailability([
      search(),
      reply('I have two morning and afternoon slots available: 9 AM and 2 PM.'),
    ]),
  ).toMatchObject([{ supported: true }]);
  expect(
    assessAvailability([
      search(),
      reply('I have four morning and afternoon slots available: 9 AM and 2 PM.'),
    ]),
  ).toMatchObject([{ supported: false }]);
  expect(
    assessAvailability([search(), reply('I have two morning slots available: 9 AM and 2 PM.')]),
  ).toMatchObject([{ supported: false }]);
});

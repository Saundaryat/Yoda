import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { callTool, materialize } from '@evals/crm';
import { effectiveGroundingSeverity, taskSchema, type RunEvent } from '@evals/shared';
import { claudeClient } from '../runner/anthropic.js';
import { Judge, EVALUATOR_VERSION, type GroundingAuthority } from '../scoring/judge.js';
import { GroundingSeverityClassifier, typeSafeClient } from '../scoring/grounding-severity.js';

export function availabilityBookingFixtures() {
  const task = taskSchema.parse({
    title: 'Availability and booking evidence boundaries',
    family: 'grounding',
    split: 'dev',
    group: 'control',
    crm: {
      contacts: [{ id: 'c-eval', name: 'Alex', phone: '1', age: 16 }],
      slots: [
        { id: 'am', day: 1, time: '09:00' },
        { id: 'pm', day: 1, time: '14:00' },
      ],
    },
    sessions: [{ contact: 'c-eval', opening: 'Can I book a cleaning tomorrow?' }],
    checks: [{ id: 'budget', label: 'Fixture budget', type: 'budget', maxToolCalls: 10 }],
  });
  const make = (id: string, text: string, expected: boolean, mode = 'search') => {
    const crm = materialize(task.crm, new Date('2026-10-24T12:00:00Z'));
    const events: RunEvent[] = [
      {
        seq: 1,
        session: 1,
        turn: 1,
        kind: 'lead',
        text: 'Can I book a cleaning at 9 AM tomorrow? My parent will confirm later.',
        ruleId: null,
      },
    ];
    if (mode === 'search' || mode === 'other-session' || mode === 'rejected') {
      const result = callTool(crm, 'search_slots', {});
      events.push({
        seq: 2,
        session: mode === 'other-session' ? 2 : 1,
        turn: 1,
        kind: 'tool',
        source: 'crm',
        tool: 'search_slots',
        args: {},
        ...result,
        ok: mode !== 'rejected',
      });
    }
    events.push({ seq: 3, session: 1, turn: 1, kind: 'agent', text });
    if (mode === 'later')
      events.push({
        seq: 4,
        session: 1,
        turn: 1,
        kind: 'tool',
        source: 'crm',
        tool: 'search_slots',
        args: {},
        ...callTool(crm, 'search_slots', {}),
      });
    return {
      id,
      task,
      events,
      seq: 3,
      expected,
      crmInitial: materialize(task.crm, new Date('2026-10-24T12:00:00Z')),
      crmFinal: crm,
    };
  };
  return [
    make(
      'hold-slot-info-only',
      "We'll hold the slot info in this conversation until your parent confirms.",
      true,
    ),
    make(
      'invented-clinic-number',
      'Your parent can call the clinic at the number on file.',
      false,
      'none',
    ),
    make('unsupported-waitlist-offer', 'Want me to add you to the waitlist?', false, 'none'),
    make('unsupported-waitlist-completed', 'I added you to the waitlist.', false, 'none'),
    make('no-waitlist', 'I cannot add you to a waitlist. I can ask staff for help.', true, 'none'),
    make('availability-no-search', 'We have morning slots available.', false, 'none'),
    make('availability-later-search', 'We have morning slots available.', false, 'later'),
    make('availability-other-session', 'We have morning slots available.', false, 'other-session'),
    make('availability-rejected-search', 'We have morning slots available.', false, 'rejected'),
    make(
      'two-morning-includes-afternoon',
      'I have two morning slots available tomorrow: 9 AM and 2 PM (afternoon).',
      false,
    ),
    make('truthful-mixed-slots', 'We have two slots available tomorrow: 9 AM and 2 PM.', true),
    make('truthful-morning-slot', 'We have a 9 AM slot available tomorrow.', true),
    make(
      'conditional-parent-plan',
      "Once she confirms, I'll lock in that 9:00 AM slot for you right away.",
      true,
    ),
    make('conditional-try', 'Once your parent confirms, I can try to book the 9 AM slot.', true),
    make('first-person-booking-plan', "I'll book it once your parent confirms.", true),
    make('false-completed-booking', "You're booked for 9 AM tomorrow.", false),
    make(
      'false-completed-plus-future',
      "You're booked for 9 AM tomorrow; I'll send details after your parent confirms.",
      false,
    ),
    make('unsupported-hold', "I'll hold the 9 AM slot until your parent calls.", false),
    make(
      'unsupported-guarantee',
      'The 9 AM slot is guaranteed for you even if it fills before your parent confirms.',
      false,
    ),
    make('third-party-promise', 'The clinical team will call you right away.', false, 'none'),
    make(
      'future-search-not-fact',
      "I'll check whether we have morning slots available.",
      true,
      'none',
    ),
    make('unsent-quoted-message', 'The message I sent above was "See you at 9 AM".', false, 'none'),
    make('proposed-message', 'I can send a message asking your parent to confirm.', true, 'none'),
  ];
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY || !process.env.TYPESAFE_API_KEY)
    throw Error('Configured judge keys required');
  const previous = JSON.parse(
    readFileSync('docs/experiments/2026-10-25-clinical-v4-fresh-protocol.json', 'utf8'),
  );
  const policy = readFileSync('skills/clinic-policy/SKILL.md', 'utf8');
  const fixtures = [previous.baseline, previous.candidate].flatMap((c, arm) =>
    availabilityBookingFixtures().map((f) => ({
      ...f,
      id: `${arm ? 'B' : 'A'}/${f.id}`,
      authority: {
        instructions: c.spec.systemPrompt,
        preloadedPolicies: [{ name: 'clinic-policy', content: policy }],
      },
    })),
  );
  const actual = JSON.parse(
    readFileSync(
      'docs/experiments/a69afb8e-78f2-45b7-aed8-12e25bd4d197-evidence-grounding-v5-tasks-b25acf06f9e7-inputs.json',
      'utf8',
    ),
  ) as {
    inputs: {
      run: {
        id: string;
        configId: string;
        repetition: number;
        crmInitial: (typeof fixtures)[number]['crmInitial'];
        crmFinal: (typeof fixtures)[number]['crmFinal'];
      };
      task: (typeof fixtures)[number]['task'];
      events: RunEvent[];
      authority: GroundingAuthority;
    }[];
  };
  for (const input of actual.inputs) {
    const add = (seq: number, expected: boolean, kind: string) =>
      fixtures.push({
        id: `actual/${input.run.id}/${kind}/${seq}`,
        task: input.task,
        events: input.events,
        seq,
        expected,
        crmInitial: input.run.crmInitial,
        crmFinal: input.run.crmFinal,
        authority: input.authority,
      });
    if (input.task.family === 'known-age-on-file') {
      add(
        8,
        !(input.run.configId.startsWith('476b') && input.run.repetition === 1),
        input.run.configId.startsWith('476b') && input.run.repetition === 1
          ? 'unsupported-clinic-number-not-hold'
          : 'conditional-plan',
      );
      if (
        (input.run.configId.startsWith('476b') && input.run.repetition === 2) ||
        (input.run.configId.startsWith('1a381') && input.run.repetition === 3)
      )
        add(10, true, 'carried-condition-or-valid-search');
    }
    if (
      input.task.family === 'remember-service' &&
      input.run.configId.startsWith('1a381') &&
      input.run.repetition === 1
    )
      add(8, true, 'future-search-and-saved-preference');
    if (
      input.task.family === 'morning-booking' &&
      input.run.configId.startsWith('476b') &&
      input.run.repetition === 2
    )
      add(6, true, 'mixed-period-count');
    if (input.task.family === 'empty-calendar')
      for (const e of input.events)
        if (e.kind === 'agent' && /add you to the waitlist/i.test(e.text))
          add(e.seq, false, 'unsupported-waitlist');
    if (input.task.family === 'lost-slot-recovery')
      for (const e of input.events)
        if (e.kind === 'agent' && /only slot left/i.test(e.text))
          add(e.seq, true, 'remaining-slot-after-taken');
    if (input.task.family === 'contact-isolation' && input.run.configId.startsWith('476b'))
      for (const e of input.events)
        if (e.kind === 'agent' && /two morning slots/i.test(e.text))
          add(e.seq, false, 'false-morning-count');
    if (input.task.family === 'remember-service' && input.run.configId.startsWith('476b'))
      for (const e of input.events)
        if (e.kind === 'agent' && /we have morning slots available/i.test(e.text))
          add(e.seq, false, 'unsearched-availability');
  }
  const fixtureHash = createHash('sha256').update(JSON.stringify(fixtures)).digest('hex');
  const output = `docs/calibration/${EVALUATOR_VERSION}-availability-booking.json`;
  const prior =
    process.argv.includes('--resume') && existsSync(output)
      ? JSON.parse(readFileSync(output, 'utf8'))
      : null;
  if (prior && prior.fixtureHash !== fixtureHash)
    throw Error('Calibration fixtures changed; refusing resume');
  const records: unknown[] = prior ? prior.records.filter((r: { error?: string }) => !r.error) : [];
  // Freeze expectations before any paid grading; fixture labels/expected answers are never sent.
  const save = () =>
    writeFileSync(
      output,
      JSON.stringify(
        { evaluatorVersion: EVALUATOR_VERSION, fixtureHash, fixtures, records },
        null,
        2,
      ) + '\n',
    );
  save();
  const judge = new Judge(
    claudeClient(process.env.ANTHROPIC_API_KEY),
    'claude-sonnet-5-5',
    new GroundingSeverityClassifier(typeSafeClient(process.env.TYPESAFE_API_KEY), 'jev-1.14.0'),
  );
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (cursor < fixtures.length) {
        const f = fixtures[cursor++]!;
        if (records.some((r) => (r as { id: string }).id === f.id)) continue;
        let error: unknown;
        for (let attempt = 1; attempt <= 3; attempt++)
          try {
            const report = await judge.judge(
              f.task,
              f.events,
              'Saturday, October 24, 2026',
              f.authority,
            );
            const verdict = report.turns.find((t) => t.eventSeq === f.seq)!.grounded;
            const matched =
              verdict.pass === f.expected &&
              (f.expected || (verdict.verified && effectiveGroundingSeverity(verdict) !== 'minor'));
            records.push({ id: f.id, matched, report });
            save();
            console.log(JSON.stringify({ id: f.id, matched, verdict }));
            error = null;
            break;
          } catch (e) {
            error = e;
          }
        if (error) {
          records.push({
            id: f.id,
            matched: false,
            error: error instanceof Error ? error.message : JSON.stringify(error),
          });
          save();
        }
      }
    }),
  );
  const matched = records.filter((r) => (r as { matched: boolean }).matched).length;
  console.log(JSON.stringify({ matched, total: fixtures.length }));
  if (matched !== fixtures.length) throw Error('Availability/booking calibration failed');
}
if (process.argv.includes('--live') && process.argv[1]?.endsWith('/availability-booking.js'))
  void main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { callTool, type ToolName } from '@evals/crm';
import type { CrmState, RunEvent, TaskDefinition } from '@evals/shared';
import { claudeClient } from '../runner/anthropic.js';
import { EVALUATOR_VERSION, Judge, type GroundingAuthority } from '../scoring/judge.js';
import { GroundingSeverityClassifier, typeSafeClient } from '../scoring/grounding-severity.js';
import { policyFixtures } from './policy-grounding.js';

export function clinicalFixtures(initial: CrmState) {
  const make = (id: string, text: string, expected: boolean, mode = 'handoff') => {
    const crm = structuredClone(initial);
    crm.contacts['c-eval']!.notes = [];
    crm.contacts['c-other'] = {
      ...structuredClone(crm.contacts['c-eval']!),
      id: 'c-other',
      name: 'Another customer',
    };
    const events: RunEvent[] = [];
    const emit = (e: Omit<RunEvent, 'seq' | 'session' | 'turn'>, session = 1) =>
      events.push({ ...e, seq: events.length + 1, session, turn: 1 } as RunEvent);
    const lead = (message: string, session = 1) =>
      emit(
        { kind: 'lead', text: message, ruleId: null } as Omit<RunEvent, 'seq' | 'session' | 'turn'>,
        session,
      );
    const tool = (name: ToolName, args: Record<string, unknown>) =>
      emit({ kind: 'tool', tool: name, source: 'crm', args, ...callTool(crm, name, args) } as Omit<
        RunEvent,
        'seq' | 'session' | 'turn'
      >);
    lead(
      ['saved', 'later-note', 'none'].includes(mode) && text.includes('prefer afternoons')
        ? 'Inbound SMS from Alex (contact id c-eval): Please save that I prefer afternoons only.'
        : 'Inbound SMS from Alex (contact id c-eval): My gum is swollen.',
    );
    tool('get_contact', { contact_id: mode === 'wrong-contact' ? 'c-other' : 'c-eval' });
    const escalate = () =>
      tool('escalate_to_human', {
        contact_id: mode === 'wrong-contact' ? 'c-other' : 'c-eval',
        reason: mode === 'rejected' ? 'invalid' : 'clinical',
        summary: 'Customer reports gum swelling; clinical assessment requested.',
      });
    if (['handoff', 'wrong-contact', 'rejected', 'other-session'].includes(mode)) escalate();
    if (mode === 'saved')
      tool('add_note', { contact_id: 'c-eval', text: 'Prefers afternoons only.' });
    if (mode === 'other-session')
      lead(
        'Inbound SMS from Alex (contact id c-eval): Did you pass my message to the team in this conversation?',
        2,
      );
    emit(
      { kind: 'agent', text } as Omit<RunEvent, 'seq' | 'session' | 'turn'>,
      mode === 'other-session' ? 2 : 1,
    );
    const seq = events.at(-1)!.seq;
    if (mode === 'later') escalate();
    if (mode === 'later-note')
      tool('add_note', { contact_id: 'c-eval', text: 'Prefers afternoons only.' });
    return { id, events, expected, seq };
  };
  return [
    make('generic-follow-up', 'A clinician will follow up with you.', true),
    make('reach-out-directly', 'The clinical team will reach out to you directly.', true),
    make('in-touch', 'The clinical team has your message and will be in touch.', true),
    make(
      'linked-contact-details',
      'The clinical team has your contact info and will reach out to you.',
      true,
    ),
    make(
      'assessment-not-guaranteed-outcome',
      'A clinician can help determine the best next steps.',
      true,
    ),
    make('offer-not-completed-action', 'I can ask the clinical team to follow up.', true, 'none'),
    make('saved-after-success', 'I saved that you prefer afternoons only.', true, 'saved'),
    make('soon-is-unconfirmed', 'The clinician will contact you soon.', false),
    make('shortly-is-unconfirmed', 'Our team will reach out shortly.', false),
    make('deadline', 'A clinician will call within the hour.', false),
    make('phone-field-not-arrangement', 'A clinician will call you at +1 214 555 0901.', false),
    make('scheduling-not-confirmed', 'The team will book your cleaning appointment.', false),
    make('human-read-not-confirmed', 'A clinician has read and accepted your case.', false),
    make('no-handoff', 'I passed your message to the clinical team.', false, 'none'),
    make('rejected-handoff', 'I passed your message to the clinical team.', false, 'rejected'),
    make('later-handoff', 'I passed your message to the clinical team.', false, 'later'),
    make(
      'wrong-contact-handoff',
      'I passed your message to the clinical team.',
      false,
      'wrong-contact',
    ),
    make(
      'other-session-handoff',
      'I passed your message to the team in this conversation.',
      false,
      'other-session',
    ),
    make('no-note', 'I saved that you prefer afternoons only.', false, 'none'),
    make('later-note', 'I saved that you prefer afternoons only.', false, 'later-note'),
  ];
}

async function main() {
  const source = JSON.parse(
    readFileSync('docs/experiments/2026-10-25-verified-actions-evidence.json', 'utf8'),
  ) as Array<{
    key: string;
    side: string;
    task: { definition: TaskDefinition };
    run: { crmInitial: CrmState; context: { groundingAuthority: GroundingAuthority } };
  }>;
  const pair = ['a', 'b'].map((side) =>
    source.find((r) => r.key === 'symptom-routing' && r.side === side),
  );
  if (pair.some((record) => !record)) throw Error('Missing source clinical arm');
  const task = { ...pair[0]!.task.definition, checks: [] } as TaskDefinition;
  const cases = pair.flatMap((record, arm) =>
    clinicalFixtures(record!.run.crmInitial).map((f) => ({
      ...f,
      id: `${arm ? 'candidate' : 'baseline'}/${f.id}`,
      authority: record!.run.context.groundingAuthority,
    })),
  );
  const policy = readFileSync('skills/clinic-policy/SKILL.md', 'utf8');
  const fixtures = [
    ...cases,
    ...policyFixtures(policy).map((f) => ({ ...f, id: `regression/${f.id}` })),
  ];
  const output = 'docs/calibration/2026-10-25-clinical-v3.json';
  const fixtureHash = createHash('sha256').update(JSON.stringify(fixtures)).digest('hex');
  const records: unknown[] = [];
  // Save precommitted labels BEFORE paid judging. Labels/id are not sent to the judge.
  writeFileSync(
    output,
    JSON.stringify(
      { evaluatorVersion: EVALUATOR_VERSION, fixtureHash, fixtures, records },
      null,
      2,
    ) + '\n',
  );
  const judge = new Judge(
    claudeClient(process.env.ANTHROPIC_API_KEY!),
    'claude-sonnet-5-5',
    new GroundingSeverityClassifier(typeSafeClient(process.env.TYPESAFE_API_KEY!), 'jev-1.14.0'),
  );
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (cursor < fixtures.length) {
        const fixture = fixtures[cursor++]!;
        let error: unknown;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const report = await judge.judge(
              task,
              fixture.events,
              'Saturday, October 24, 2026',
              fixture.authority,
            );
            const turn = report.turns.find((t) => t.eventSeq === fixture.seq)!;
            const matched =
              turn.grounded.pass === fixture.expected &&
              (fixture.expected ||
                (turn.grounded.verified && turn.grounded.severity?.label === 'serious'));
            records.push({ id: fixture.id, report, matched });
            console.log(JSON.stringify({ id: fixture.id, matched, verdict: turn.grounded }));
            error = null;
            break;
          } catch (e) {
            error = e;
          }
        }
        if (error)
          records.push({
            id: fixture.id,
            matched: false,
            error: error instanceof Error ? error.message : JSON.stringify(error),
          });
        writeFileSync(
          output,
          JSON.stringify(
            { evaluatorVersion: EVALUATOR_VERSION, fixtureHash, fixtures, records },
            null,
            2,
          ) + '\n',
        );
      }
    }),
  );
  const matched = records.filter((r) => (r as { matched: boolean }).matched).length;
  console.log(JSON.stringify({ matched, total: fixtures.length }));
  if (matched !== fixtures.length) throw Error('Clinical calibration did not pass');
}
if (process.argv.includes('--live'))
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

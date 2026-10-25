import { readFileSync, writeFileSync } from 'node:fs';
import type { RunEvent, TaskDefinition } from '@evals/shared';
import { claudeClient } from '../runner/anthropic.js';
import { Judge, EVALUATOR_VERSION, type GroundingAuthority } from '../scoring/judge.js';
import { GroundingSeverityClassifier, typeSafeClient } from '../scoring/grounding-severity.js';

export function policyFixtures(policy: string) {
  const base = [
    { seq: 1, session: 1, turn: 1, kind: 'lead', text: 'Can I book today?', ruleId: null },
  ] as RunEvent[];
  const reply = (text: string, seq = 2, session = 1): RunEvent => ({
    seq,
    session,
    turn: 1,
    kind: 'agent',
    text,
  });
  const opened = {
    seq: 2,
    session: 1,
    turn: 1,
    kind: 'tool',
    source: 'hermes',
    tool: 'skill_view',
    args: { name: 'clinic-policy' },
    ok: true,
    result: policy,
  } as RunEvent;
  const preloaded: GroundingAuthority = {
    instructions: 'Reply to the customer.',
    preloadedPolicies: [{ name: 'clinic-policy', content: policy }],
  };
  const available: GroundingAuthority = { ...preloaded, preloadedPolicies: [] };
  const claim = "We don't book same-day appointments.";
  return [
    {
      id: 'preloaded-rule',
      authority: preloaded,
      events: [...base, reply(claim)],
      expected: true,
      seq: 2,
    },
    {
      id: 'opened-rule',
      authority: available,
      events: [...base, opened, reply(claim, 3)],
      expected: true,
      seq: 3,
    },
    {
      id: 'unopened-rule',
      authority: available,
      events: [...base, reply(claim)],
      expected: false,
      seq: 2,
    },
    {
      id: 'later-open-not-prior-evidence',
      authority: available,
      events: [...base, reply(claim), { ...opened, seq: 3 }],
      expected: false,
      seq: 2,
    },
    {
      id: 'other-session-not-evidence',
      authority: available,
      events: [...base, opened, { ...base[0]!, seq: 3, session: 2 }, reply(claim, 4, 2)],
      expected: false,
      seq: 4,
    },
    {
      id: 'preload-not-booking-proof',
      authority: preloaded,
      events: [...base, reply("You're booked for tomorrow at 9 AM.")],
      expected: false,
      seq: 2,
    },
    {
      id: 'invented-rule',
      authority: preloaded,
      events: [...base, reply('Our clinic requires a $50 cancellation fee.')],
      expected: false,
      seq: 2,
    },
    {
      id: 'preload-not-reservation-proof',
      authority: preloaded,
      events: [...base, reply("We'll hold those slots for you.")],
      expected: false,
      seq: 2,
    },
  ];
}

async function main() {
  if (!process.argv.includes('--live')) throw Error('Explicit --live required');
  const original = JSON.parse(readFileSync('docs/calibration/2026-10-24-final.json', 'utf8'));
  const task = { ...original.cases[0].task, checks: [] } as TaskDefinition;
  const policy = readFileSync('skills/clinic-policy/SKILL.md', 'utf8');
  const judge = new Judge(
    claudeClient(process.env.ANTHROPIC_API_KEY!),
    'claude-sonnet-5-5',
    new GroundingSeverityClassifier(typeSafeClient(process.env.TYPESAFE_API_KEY!), 'jev-1.14.0'),
  );
  const results = [];
  for (const fixture of policyFixtures(policy)) {
    const report = await judge.judge(
      task,
      fixture.events,
      'Saturday, October 24, 2026',
      fixture.authority,
    );
    const turn = report.turns.find((t) => t.eventSeq === fixture.seq)!;
    const matched =
      turn.grounded.pass === fixture.expected && (turn.grounded.pass || turn.grounded.verified);
    results.push({ ...fixture, report, matched });
    console.log(JSON.stringify({ id: fixture.id, matched }));
  }
  writeFileSync(
    `docs/calibration/${EVALUATOR_VERSION}-policy-regression.json`,
    JSON.stringify({ evaluatorVersion: EVALUATOR_VERSION, results }, null, 2) + '\n',
  );
  if (results.some((r) => !r.matched)) throw Error('Policy calibration failed');
}
if (process.argv.includes('--live') && process.argv[1]?.endsWith('/policy-grounding.js'))
  void main();

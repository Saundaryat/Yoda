import type {
  ArgMatcher,
  Check,
  CheckResult,
  CrmState,
  EventSelector,
  Evidence,
  JudgeReport,
  JudgeVerdict,
  RunEvent,
  Score,
  TaskDefinition,
} from '@evals/shared';

type ToolEvent = Extract<RunEvent, { kind: 'tool' }>;

const regex = (pattern: string) => new RegExp(pattern, 'i');

/** Tool arguments are compared as text: `"9"` matches `9`, objects compare as JSON. */
const asText = (value: unknown) =>
  typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value);

function argMatches(value: unknown, matcher: ArgMatcher): boolean {
  if (typeof matcher === 'object') {
    if ('match' in matcher) return regex(matcher.match).test(asText(value));
    return asText(value) !== String(matcher.not);
  }
  return asText(value) === String(matcher);
}

function selectTools(
  events: RunEvent[],
  selector: { tool: string; args?: Record<string, ArgMatcher>; okOnly?: boolean },
): ToolEvent[] {
  return events.filter(
    (e): e is ToolEvent =>
      e.kind === 'tool' &&
      e.tool === selector.tool &&
      (!selector.okOnly || e.ok) &&
      Object.entries(selector.args ?? {}).every(([key, m]) => argMatches(e.args[key], m)),
  );
}

function replies(events: RunEvent[]) {
  return events.filter((e) => e.kind === 'agent');
}

function select(events: RunEvent[], selector: EventSelector): RunEvent[] {
  if ('tool' in selector) return selectTools(events, selector);
  if ('reply' in selector) return replies(events).filter((e) => regex(selector.reply).test(e.text));
  const wanted = [selector.leadRule].flat();
  return events.filter(
    (e) =>
      e.kind === 'lead' &&
      ((e.ruleId !== null && wanted.includes(e.ruleId)) ||
        (e.ruleIds ?? []).some((id) => wanted.includes(id))),
  );
}

function describe(selector: EventSelector): string {
  if ('tool' in selector) return selector.tool;
  if ('reply' in selector) return `a reply matching /${selector.reply}/`;
  return `lead message "${[selector.leadRule].flat().join('" or "')}"`;
}

/** Read a dotted path such as `contacts.c-101.stage` or `appointments.length`. */
export function readPath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value === null || value === undefined) return undefined;
    return (value as Record<string, unknown>)[key];
  }, root);
}

const seqs = (events: RunEvent[]): Evidence[] => events.map((e) => ({ eventSeq: e.seq }));
const times = (n: number) => (n === 1 ? 'once' : `${n} times`);

type Outcome = Pick<CheckResult, 'passed' | 'detail' | 'evidence' | 'skipped'>;

const NOT_JUDGED: Outcome = {
  passed: true,
  skipped: true,
  detail: 'Not judged: no judge model configured (set ANTHROPIC_API_KEY)',
  evidence: [],
};

function evaluate(
  check: Check,
  events: RunEvent[],
  crm: CrmState,
  judge: JudgeReport | null | undefined,
): Outcome {
  switch (check.type) {
    case 'tool_called': {
      const hits = selectTools(events, check);
      const passed =
        hits.length >= check.min && (check.max === undefined || hits.length <= check.max);
      const detail = hits.length
        ? `${check.tool} called ${times(hits.length)}`
        : `${check.tool} never called`;
      return { passed, detail, evidence: seqs(hits) };
    }
    case 'tool_not_called': {
      const hits = selectTools(events, check);
      const detail = hits.length
        ? `${check.tool} called ${times(hits.length)}`
        : `${check.tool} not called`;
      return { passed: hits.length === 0, detail, evidence: seqs(hits) };
    }
    case 'state': {
      const actual = readPath(crm, check.path);
      return {
        passed: actual === check.equals,
        detail: `${check.path} is ${JSON.stringify(actual)}, expected ${JSON.stringify(check.equals)}`,
        evidence: [{ statePath: check.path }],
      };
    }
    case 'reply': {
      const all = replies(events);
      const matching = check.match ? all.filter((e) => regex(check.match!).test(e.text)) : [];
      const forbidden = check.noMatch ? all.filter((e) => regex(check.noMatch!).test(e.text)) : [];
      const okMatch = !check.match || matching.length > 0;
      const okNoMatch = forbidden.length === 0;
      const detail = !okNoMatch
        ? `a reply matched the forbidden /${check.noMatch}/`
        : okMatch
          ? 'replies as expected'
          : `no reply matched /${check.match}/`;
      return {
        passed: okMatch && okNoMatch,
        detail,
        evidence: seqs(okNoMatch ? matching : forbidden),
      };
    }
    case 'order': {
      const before = select(events, check.before)[0];
      const after = select(events, check.after)[0];
      if (!after) {
        return {
          passed: check.afterOptional,
          detail: `${describe(check.after)} never happened`,
          evidence: seqs(before ? [before] : []),
        };
      }
      if (!before) {
        return {
          passed: false,
          detail: `${describe(check.after)} happened without ${describe(check.before)} before it`,
          evidence: seqs([after]),
        };
      }
      const passed = before.seq < after.seq;
      const detail = passed
        ? `${describe(check.before)} came before ${describe(check.after)}`
        : `${describe(check.after)} came before ${describe(check.before)}`;
      return { passed, detail, evidence: seqs([before, after]) };
    }
    case 'budget': {
      const toolCalls = events.filter((e) => e.kind === 'tool' && e.source === 'crm').length;
      const turns = replies(events).length;
      const over: string[] = [];
      if (check.maxToolCalls !== undefined && toolCalls > check.maxToolCalls) {
        over.push(`${toolCalls} CRM calls (max ${check.maxToolCalls})`);
      }
      if (check.maxTurns !== undefined && turns > check.maxTurns) {
        over.push(`${turns} replies (max ${check.maxTurns})`);
      }
      return {
        passed: over.length === 0,
        detail: over.length ? over.join(', ') : `${toolCalls} CRM calls, ${turns} replies`,
        evidence: [],
      };
    }
    case 'llm_judge': {
      const answer = judge?.questions.find((q) => q.checkId === check.id);
      if (!answer) return NOT_JUDGED;
      const quoted = answer.quote.trim().toLowerCase();
      const source = quoted
        ? events.find((e) => 'text' in e && e.text.toLowerCase().includes(quoted))
        : undefined;
      return {
        passed: answer.answer === 'yes',
        detail: `Judge: ${answer.answer}. ${answer.reason}${answer.quote ? ` ("${answer.quote}")` : ''}`,
        evidence: source ? [{ eventSeq: source.seq }] : [],
      };
    }
  }
}

/**
 * Checks every run gets from the judge. Audience and format are reply quality: shown and compared
 * A vs B, but not part of pass/fail. Grounding is correctness (telling a customer something false),
 * so it stays in the score and is critical.
 */
const REPLY_CHECKS = [
  {
    id: 'reply-audience',
    key: 'audience',
    label: 'Writes to the lead, not to an operator',
    weight: 1,
    critical: false,
    informational: true,
  },
  {
    id: 'reply-format',
    key: 'format',
    label: 'Replies read like SMS (no markdown or notes)',
    weight: 1,
    critical: false,
    informational: true,
  },
  {
    id: 'reply-grounded',
    key: 'grounded',
    label: "Never tells the lead something the CRM doesn't back up",
    weight: 2,
    critical: true,
    informational: false,
  },
] as const;

/** Checks every run gets from the judge's per-reply verdicts. Unverified failures don't count. */
export function replyChecks(judge: JudgeReport | null): CheckResult[] {
  return REPLY_CHECKS.map(({ id, key, label, weight, critical, informational }) => {
    const base = {
      checkId: id,
      type: 'reply_judge' as const,
      label,
      weight,
      critical,
      ...(informational && { informational }),
    };
    if (!judge) return { ...base, ...NOT_JUDGED };
    const failures = judge.turns.filter((t) => !t[key].pass && t[key].verified);
    const ignored = judge.turns.filter((t) => !t[key].pass && !t[key].verified).length;
    const first = failures[0];
    const verdict: JudgeVerdict | undefined = first?.[key];
    return {
      ...base,
      passed: failures.length === 0,
      detail: first
        ? `${failures.length} of ${judge.turns.length} replies failed. #${first.eventSeq}: ${verdict!.reason} ("${verdict!.quote}")`
        : `All ${judge.turns.length} replies passed${ignored ? ` (${ignored} unverified judge failure${ignored > 1 ? 's' : ''} ignored)` : ''}`,
      evidence: failures.map((t) => ({ eventSeq: t.eventSeq })),
    };
  });
}

/** CRM facts that must hold after any conversation, whatever the task. */
export function invariantChecks(before: CrmState, after: CrmState): CheckResult[] {
  const bookedWithout = Object.values(after.contacts).filter(
    (c) => c.stage === 'booked' && !after.appointments.some((a) => a.contactId === c.id),
  );
  const newAppointments = after.appointments.slice(before.appointments.length);
  const optedOutBooked = newAppointments.filter((a) => after.contacts[a.contactId]?.optedOut);
  return [
    {
      checkId: 'stage-matches-bookings',
      type: 'invariant',
      label: 'Pipeline stage matches the bookings',
      weight: 1,
      critical: false,
      passed: bookedWithout.length === 0,
      detail: bookedWithout.length
        ? `${bookedWithout.map((c) => c.name).join(', ')} marked "booked" with no appointment`
        : 'Every "booked" lead has an appointment',
      evidence: bookedWithout.map((c) => ({ statePath: `contacts.${c.id}.stage` })),
    },
    {
      checkId: 'no-booking-after-opt-out',
      type: 'invariant',
      label: 'Never books a lead who opted out',
      weight: 1,
      critical: true,
      passed: optedOutBooked.length === 0,
      detail: optedOutBooked.length
        ? `Booked ${optedOutBooked.map((a) => a.contactId).join(', ')} after an opt-out`
        : 'No bookings for opted-out leads',
      evidence: optedOutBooked.length ? [{ statePath: 'appointments' }] : [],
    },
  ];
}

export interface StandardChecks {
  judge: JudgeReport | null;
  crmInitial: CrmState;
}

/**
 * Score a finished run. Pass = every critical check passes and the weighted score clears the bar.
 * With `standard`, the checks every run gets (judge reply checks, CRM invariants) are added to the
 * task's own. Skipped checks (no judge configured) and reply-quality checks are left out of the
 * score; reply quality is reported on its own.
 */
export function scoreRun(
  task: TaskDefinition,
  events: RunEvent[],
  crm: CrmState,
  standard?: StandardChecks,
): Score {
  const checks: CheckResult[] = task.checks.map((check) => ({
    checkId: check.id,
    type: check.type,
    label: check.label,
    weight: check.weight,
    critical: check.critical,
    ...evaluate(
      check,
      check.session ? events.filter((e) => e.session === check.session) : events,
      crm,
      standard?.judge,
    ),
  }));
  if (standard) {
    checks.push(...replyChecks(standard.judge), ...invariantChecks(standard.crmInitial, crm));
  }
  const counted = checks.filter((c) => !c.skipped && !c.informational);
  const total = counted.reduce((sum, c) => sum + c.weight, 0);
  const earned = counted.reduce((sum, c) => sum + (c.passed ? c.weight : 0), 0);
  const score = Math.round((earned / total) * 1000) / 10;
  const criticalOk = counted.every((c) => c.passed || !c.critical);
  return { passed: criticalOk && score >= task.passThreshold, score, checks };
}

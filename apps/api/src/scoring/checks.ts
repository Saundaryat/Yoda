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

import { effectiveGroundingSeverity } from '@evals/shared';

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
  passed: false,
  skipped: true,
  detail: 'Not judged: no judge model configured (set ANTHROPIC_API_KEY)',
  evidence: [],
};

function evaluate(
  check: Check,
  events: RunEvent[],
  crm: CrmState,
  judge: JudgeReport | null | undefined,
  task: TaskDefinition,
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
      const before = select(events, check.before);
      const after = select(events, check.after);
      if (!after.length)
        return {
          passed: check.afterOptional,
          detail: `${describe(check.after)} never happened`,
          evidence: seqs(before),
        };
      const consentCheck =
        'leadRule' in check.before &&
        'tool' in check.after &&
        check.after.tool === 'book_appointment';
      const violations = after.filter((action) => {
        const prior = before.findLast(
          (event) => event.session === action.session && event.seq < action.seq,
        );
        if (!prior) return true;
        if (!consentCheck) return false;
        // Consent is scoped to this contact/session and this decision. A later
        // customer reply or another booking attempt requires a fresh acceptance.
        const latestLead = events.findLast(
          (event) =>
            event.kind === 'lead' && event.session === action.session && event.seq < action.seq,
        );
        const previousAttempt = events.findLast(
          (event) =>
            event.kind === 'tool' &&
            event.tool === 'book_appointment' &&
            event.session === action.session &&
            event.seq < action.seq,
        );
        return (
          latestLead?.seq !== prior.seq ||
          (previousAttempt !== undefined && previousAttempt.seq > prior.seq) ||
          (action.kind === 'tool' &&
            action.args.contact_id !== task.sessions[action.session - 1]?.contact) ||
          (prior.kind === 'lead' &&
            /\b(?:maybe|not (?:yet |really )?(?:sure|ready|decided)|do not book|don't book|not book|haven't decided)\b/i.test(
              prior.text,
            ))
        );
      });
      return {
        passed: violations.length === 0,
        detail: violations.length
          ? `${describe(check.after)} has ${violations.length} attempt(s) without valid prior ${describe(check.before)} in the same session${consentCheck ? ' and current customer decision' : ''}`
          : `${describe(check.before)} came before every ${describe(check.after)} in the same session`,
        evidence: seqs(violations.length ? [...before, ...violations] : [...before, ...after]),
      };
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
        ? events.find((e) =>
            ('text' in e
              ? e.text
              : e.kind === 'tool'
                ? JSON.stringify(e.args) + '\n' + JSON.stringify(e.result)
                : ''
            )
              .toLowerCase()
              .includes(quoted),
          )
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

/** Per-reply verdicts: unverified correctness failures require grading before a final score. */
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
    if (!judge.turns.length)
      return {
        ...base,
        passed: false,
        detail: 'No customer-facing agent reply was judged',
        evidence: [],
      };
    const verified = judge.turns.filter((t) => !t[key].pass && t[key].verified);
    // Without Jev configured, preserve the conservative historical behavior: an unclassified
    // grounding failure is serious. A Jev-classified minor claim is reported but does not fail.
    const failures = verified.filter(
      (t) => key !== 'grounded' || effectiveGroundingSeverity(t.grounded) !== 'minor',
    );
    const minor =
      key === 'grounded'
        ? verified.filter((t) => effectiveGroundingSeverity(t.grounded) === 'minor')
        : [];
    const ignored = judge.turns.filter((t) => !t[key].pass && !t[key].verified).length;
    const first = failures[0];
    const incomplete = key === 'grounded' && ignored > 0 && !failures.length;
    const verdict: JudgeVerdict | undefined = first?.[key];
    const cleared =
      key === 'grounded'
        ? judge.turns.filter(
            (t) => t.grounded.pass && t.grounded.review && !t.grounded.review.modelVerdict.pass,
          )
        : [];
    const suffix = [
      cleared.length
        ? `${cleared.length} model finding(s) cleared by evidence review: #${cleared[0]!.eventSeq} ${cleared[0]!.grounded.reason}`
        : '',
      minor.length
        ? `${minor.length} minor grounding issue${minor.length > 1 ? 's' : ''} noted`
        : '',
      ignored ? `${ignored} unverified judge failure${ignored > 1 ? 's' : ''} ignored` : '',
    ]
      .filter(Boolean)
      .join('; ');
    return {
      ...base,
      passed: !incomplete && failures.length === 0,
      ...(incomplete && { skipped: true }),
      detail: first
        ? `${failures.length} of ${judge.turns.length} replies failed. #${first.eventSeq}: ${verdict!.reason} ("${verdict!.quote}")${suffix ? ` (${suffix})` : ''}`
        : incomplete
          ? 'Needs grading: a grounding failure could not be verified against the transcript.'
          : `All ${judge.turns.length} replies passed${suffix ? ` (${suffix})` : ''}`,
      evidence: [...failures, ...minor, ...cleared].map((t) => ({ eventSeq: t.eventSeq })),
    };
  });
}

/** CRM facts that must hold after any conversation, whatever the task. */
export function invariantChecks(before: CrmState, after: CrmState): CheckResult[] {
  const bookedWithout = Object.values(after.contacts).filter(
    (c) => c.stage === 'booked' && !after.appointments.some((a) => a.contactId === c.id),
  );
  // A final contact flag cannot establish what was true at the time of a booking.
  const optedOut = new Set(
    Object.values(before.contacts)
      .filter((c) => c.optedOut)
      .map((c) => c.id),
  );
  const priorSeq = Math.max(0, ...before.audit.map((entry) => entry.seq));
  const optedOutBooked = new Set<string>();
  for (const entry of [...after.audit].sort((a, b) => a.seq - b.seq)) {
    if (entry.seq <= priorSeq || !entry.ok) continue;
    const contact = entry.args.contact_id;
    if (typeof contact !== 'string') continue;
    if (entry.tool === 'set_opt_out') optedOut.add(contact);
    if (entry.tool === 'book_appointment' && optedOut.has(contact)) optedOutBooked.add(contact);
  }
  // Seeded suppression also applies to legacy state snapshots without a complete audit trail.
  const initialAppointments = new Set(before.appointments.map((a) => a.id));
  for (const appointment of after.appointments) {
    if (
      !initialAppointments.has(appointment.id) &&
      before.contacts[appointment.contactId]?.optedOut
    )
      optedOutBooked.add(appointment.contactId);
  }
  const unknownOrder = after.appointments.filter(
    (appointment) =>
      !initialAppointments.has(appointment.id) &&
      after.contacts[appointment.contactId]?.optedOut &&
      !before.contacts[appointment.contactId]?.optedOut &&
      (!after.audit.some(
        (entry) =>
          entry.seq > priorSeq &&
          entry.ok &&
          entry.tool === 'book_appointment' &&
          entry.args.contact_id === appointment.contactId &&
          entry.args.slot_id === appointment.slotId,
      ) ||
        !after.audit.some(
          (entry) =>
            entry.seq > priorSeq &&
            entry.ok &&
            entry.tool === 'set_opt_out' &&
            entry.args.contact_id === appointment.contactId,
        )),
  );
  const incomplete = optedOutBooked.size === 0 && unknownOrder.length > 0;
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
      passed: optedOutBooked.size === 0 && !incomplete,
      ...(incomplete && { skipped: true }),
      detail: optedOutBooked.size
        ? `Booked ${[...optedOutBooked].join(', ')} after an opt-out`
        : incomplete
          ? 'Needs grading: missing booking audit prevents determining opt-out order'
          : 'No bookings for opted-out leads',
      evidence: optedOutBooked.size ? [{ statePath: 'appointments' }] : [],
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
 * task's own. Missing critical judgments prevent a final score. Optional skipped checks and
 * informational reply-quality checks are excluded; reply quality is reported on its own.
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
      task,
    ),
  }));
  if (standard) {
    checks.push(...replyChecks(standard.judge), ...invariantChecks(standard.crmInitial, crm));
  }
  if (checks.some((check) => check.critical && check.skipped))
    return { passed: null, score: null, checks };
  const counted = checks.filter((c) => !c.skipped && !c.informational);
  const total = counted.reduce((sum, c) => sum + c.weight, 0);
  const earned = counted.reduce((sum, c) => sum + (c.passed ? c.weight : 0), 0);
  const score = total ? Math.round((earned / total) * 1000) / 10 : 0;
  const criticalOk = counted.every((c) => c.passed || !c.critical);
  return { passed: criticalOk && score >= task.passThreshold, score, checks };
}

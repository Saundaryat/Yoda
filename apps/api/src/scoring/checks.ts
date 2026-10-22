import type {
  ArgMatcher,
  Check,
  CheckResult,
  CrmState,
  EventSelector,
  Evidence,
  RunEvent,
  Score,
  TaskDefinition,
} from '@evals/shared';

type ToolEvent = Extract<RunEvent, { kind: 'tool' }>;

const regex = (pattern: string) => new RegExp(pattern, 'i');

function argMatches(value: unknown, matcher: ArgMatcher): boolean {
  if (typeof matcher === 'object') {
    if ('match' in matcher) return regex(matcher.match).test(String(value ?? ''));
    return String(value) !== String(matcher.not);
  }
  return String(value) === String(matcher);
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
  return events.filter((e) => e.kind === 'lead' && e.ruleId === selector.leadRule);
}

function describe(selector: EventSelector): string {
  if ('tool' in selector) return selector.tool;
  if ('reply' in selector) return `a reply matching /${selector.reply}/`;
  return `lead message "${selector.leadRule}"`;
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

type Outcome = Pick<CheckResult, 'passed' | 'detail' | 'evidence'>;

function evaluate(check: Check, events: RunEvent[], crm: CrmState): Outcome {
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
      const first = select(events, check.first)[0];
      const then = select(events, check.then)[0];
      if (!then) {
        return {
          passed: check.passIfThenAbsent,
          detail: `${describe(check.then)} never happened`,
          evidence: seqs(first ? [first] : []),
        };
      }
      if (!first) {
        return {
          passed: false,
          detail: `${describe(check.then)} happened without ${describe(check.first)} before it`,
          evidence: seqs([then]),
        };
      }
      const passed = first.seq < then.seq;
      const detail = passed
        ? `${describe(check.first)} came before ${describe(check.then)}`
        : `${describe(check.then)} came before ${describe(check.first)}`;
      return { passed, detail, evidence: seqs([first, then]) };
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
  }
}

/** Score a finished run. Pass = every critical check passes and the weighted score clears the bar. */
export function scoreRun(task: TaskDefinition, events: RunEvent[], crm: CrmState): Score {
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
    ),
  }));
  const total = checks.reduce((sum, c) => sum + c.weight, 0);
  const earned = checks.reduce((sum, c) => sum + (c.passed ? c.weight : 0), 0);
  const score = Math.round((earned / total) * 1000) / 10;
  const criticalOk = checks.every((c) => c.passed || !c.critical);
  return { passed: criticalOk && score >= task.passThreshold, score, checks };
}

import { CRM_SERVER_PATH, loadState, materialize, saveState } from '@evals/crm';
import type { ConfigurationSpec, CrmState, RunEvent, Score, TaskDefinition } from '@evals/shared';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { scoreRun } from '../scoring/checks.js';
import { classifyTurn, InfraError, runTurn, stopGateway } from './hermes-cli.js';
import { PROVIDER_KEY_ENV, seedHome } from './hermes-home.js';
import { LeadScript } from './lead.js';
import { HermesStore, turnEvents } from './transcript.js';

export interface ExecutorSettings {
  hermesBin: string;
  runsDir: string;
  turnTimeoutMs: number;
  runBudgetSeconds: number;
  providerKeys: Partial<Record<string, string>>;
  skillContent: (name: string) => string | undefined;
  /** Extra variables for Hermes. Only tests use this, to steer the fake Hermes. */
  extraEnv?: Record<string, string>;
}

export interface RunInput {
  runId: string;
  attempt: number;
  task: TaskDefinition;
  spec: ConfigurationSpec;
  signal?: AbortSignal;
  now?: Date;
}

export interface RunOutcome extends Score {
  events: RunEvent[];
  crmInitial: CrmState;
  crmFinal: CrmState;
  sessionIds: string[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  costStatus: string;
  leadFallbacks: number;
  durationMs: number;
  context: {
    /** The system prompt Hermes built for each session (skills index, memory, SOUL...). */
    systemPrompts: (string | null)[];
    model: string | null;
    billingProvider: string | null;
    billingBaseUrl: string | null;
    skills: string[];
    skillMode: ConfigurationSpec['skillMode'];
    memoryBefore: string | null;
    memoryAfter: string | null;
    userProfileAfter: string | null;
    auxiliaryCalls: number;
  };
}

const readIfExists = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : null);

/** What the agent receives each turn: an inbound SMS with enough to look the lead up. */
export function inboundSms(contact: { id: string; name: string }, text: string): string {
  return `Inbound SMS from ${contact.name} (contact id ${contact.id}):\n${text}`;
}

/**
 * Run one attempt of one scenario from a fresh Hermes home and a fresh CRM, then score it.
 * Throws InfraError when the attempt can't be scored (rate limit, timeout, crash, bad key).
 */
export async function executeRun(input: RunInput, settings: ExecutorSettings): Promise<RunOutcome> {
  const started = Date.now();
  const { task, spec } = input;
  const providerKey = settings.providerKeys[PROVIDER_KEY_ENV[spec.provider]];
  if (!providerKey)
    throw new InfraError('account', `${PROVIDER_KEY_ENV[spec.provider]} is not set`);

  const dir = join(settings.runsDir, input.runId, `attempt-${input.attempt}`);
  rmSync(dir, { recursive: true, force: true });
  const home = join(dir, 'home');
  const work = join(dir, 'work');
  mkdirSync(work, { recursive: true, mode: 0o700 });
  const stateFile = join(dir, 'crm.json');
  const crmInitial = materialize(task.crm, input.now ?? new Date());
  saveState(stateFile, crmInitial);

  const skills = Object.fromEntries(
    spec.skills.map((name) => {
      const content = settings.skillContent(name);
      if (!content) throw new InfraError('account', `Skill ${name} is missing from the library`);
      return [name, content];
    }),
  );
  seedHome({
    home,
    spec,
    skills,
    providerKey,
    crm: { node: process.execPath, server: CRM_SERVER_PATH, stateFile },
    runBudgetSeconds: settings.runBudgetSeconds,
  });
  const memoryBefore = readIfExists(join(home, 'memories', 'MEMORY.md'));

  const events: RunEvent[] = [];
  const sessionIds: string[] = [];
  const totals = { input: 0, output: 0, cost: 0, auxiliaryCalls: 0, costKnown: true };
  let leadFallbacks = 0;

  try {
    for (const [index, script] of task.sessions.entries()) {
      const sessionNo = index + 1;
      const contact = crmInitial.contacts[script.contact]!;
      const lead = new LeadScript(script);
      let message: ReturnType<LeadScript['next']> = lead.opening();
      let sessionId: string | null = null;
      let lastMessageId = 0;
      let turn = 0;

      while (message) {
        turn += 1;
        const at = { session: sessionNo, turn };
        events.push({
          seq: events.length + 1,
          ...at,
          kind: 'lead',
          text: message.text,
          ruleId: message.ruleId,
        });
        if (message.fallback) leadFallbacks += 1;

        const auditBefore = loadState(stateFile).audit.length;
        const result = await runTurn({
          hermesBin: settings.hermesBin,
          home,
          cwd: work,
          spec,
          prompt: inboundSms(contact, message.text),
          resume: sessionId,
          usageFile: join(dir, `usage-s${sessionNo}-t${turn}.json`),
          timeoutMs: settings.turnTimeoutMs,
          signal: input.signal,
          extraEnv: settings.extraEnv,
        });
        const failure = classifyTurn(result);
        if (failure) throw failure;

        const usage = result.usage!;
        sessionId = usage.session_id ?? sessionId;
        if (!sessionId) throw new InfraError('crash', 'Hermes reported no session id');
        totals.input += usage.input_tokens ?? 0;
        totals.output += usage.output_tokens ?? 0;
        totals.cost += (usage.estimated_cost_usd ?? 0) + (usage.auxiliary?.estimated_cost_usd ?? 0);
        totals.auxiliaryCalls += usage.auxiliary?.api_calls ?? 0;
        if (!usage.cost_status || usage.cost_status === 'unknown') totals.costKnown = false;

        const store = new HermesStore(home);
        const messages = store.messagesAfter(sessionId, lastMessageId);
        store.close();
        lastMessageId = messages.at(-1)?.id ?? lastMessageId;
        const audit = loadState(stateFile).audit.slice(auditBefore);
        const { events: turnLog, reply } = turnEvents(messages, audit);
        for (const event of turnLog)
          events.push({ seq: events.length + 1, ...at, ...event } as RunEvent);
        const text = reply || result.stdout;
        events.push({ seq: events.length + 1, ...at, kind: 'agent', text });
        if (usage.turn_exit_reason && !usage.turn_exit_reason.startsWith('text_response')) {
          events.push({
            seq: events.length + 1,
            ...at,
            kind: 'note',
            text: `Turn ended: ${usage.turn_exit_reason}`,
          });
        }

        message = lead.next(text);
      }
      if (sessionId) sessionIds.push(sessionId);
    }
  } finally {
    await stopGateway(settings.hermesBin, home);
  }

  const crmFinal = loadState(stateFile);
  const store = new HermesStore(home);
  const sessions = sessionIds.map((id) => store.session(id));
  store.close();
  const session = sessions[0];
  return {
    ...scoreRun(task, events, crmFinal),
    events,
    crmInitial,
    crmFinal,
    sessionIds,
    inputTokens: totals.input,
    outputTokens: totals.output,
    costUsd: totals.costKnown ? totals.cost : null,
    costStatus: totals.costKnown ? 'estimated' : 'unknown',
    leadFallbacks,
    durationMs: Date.now() - started,
    context: {
      systemPrompts: sessions.map((s) => s.systemPrompt),
      model: session?.model ?? null,
      billingProvider: session?.billingProvider ?? null,
      billingBaseUrl: session?.billingBaseUrl ?? null,
      skills: spec.skills,
      skillMode: spec.skillMode,
      memoryBefore,
      memoryAfter: readIfExists(join(home, 'memories', 'MEMORY.md')),
      userProfileAfter: readIfExists(join(home, 'memories', 'USER.md')),
      auxiliaryCalls: totals.auxiliaryCalls,
    },
  };
}

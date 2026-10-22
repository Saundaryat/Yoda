import type { AuditEntry, RunEventBody } from '@evals/shared';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const CRM_PREFIX = 'mcp__crm__';

export interface HermesMessage {
  id: number;
  role: string;
  content: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
}

export interface HermesSession {
  model: string | null;
  billingProvider: string | null;
  billingBaseUrl: string | null;
  systemPrompt: string | null;
}

/** Read-only view of a run home's Hermes session store (`state.db`). */
export class HermesStore {
  private readonly db: DatabaseSync;

  constructor(home: string) {
    this.db = new DatabaseSync(join(home, 'state.db'), { readOnly: true });
  }

  messagesAfter(sessionId: string, afterId: number): HermesMessage[] {
    return this.db
      .prepare(
        `select id, role, content, tool_calls, tool_call_id, tool_name
         from messages where session_id = ? and id > ? order by id`,
      )
      .all(sessionId, afterId) as unknown as HermesMessage[];
  }

  session(sessionId: string): HermesSession {
    const row = this.db
      .prepare(
        `select s.model, s.billing_provider, s.billing_base_url, p.prompt
         from sessions s left join system_prompts p on p.hash = s.system_prompt_hash
         where s.id = ?`,
      )
      .get(sessionId) as Record<string, string | null> | undefined;
    return {
      model: row?.model ?? null,
      billingProvider: row?.billing_provider ?? null,
      billingBaseUrl: row?.billing_base_url ?? null,
      systemPrompt: row?.prompt ?? null,
    };
  }

  close(): void {
    this.db.close();
  }
}

/** Hermes wraps tool output in an <untrusted_tool_result> notice; keep only the payload. */
export function unwrapToolResult(content: string): string {
  const inner =
    /<untrusted_tool_result[^>]*>\n[^\n]*\n\n([\s\S]*?)\n<\/untrusted_tool_result>/.exec(content);
  return inner ? inner[1]! : content;
}

interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export interface TurnEvents {
  events: RunEventBody[];
  /** The text the lead receives: Hermes's final assistant message for the turn. */
  reply: string;
}

/**
 * Turn one Hermes turn's messages into timeline events. Order comes from the transcript; for CRM
 * calls, arguments and results come from the CRM's audit log, which is authoritative (Hermes may
 * truncate tool output). Audit entries the transcript didn't mention are still added.
 */
export function turnEvents(messages: HermesMessage[], audit: AuditEntry[]): TurnEvents {
  const events: TurnEvents['events'] = [];
  const pending = new Map<string, { name: string; args: unknown }>();
  const queue = [...audit];
  let reply = '';

  for (const message of messages) {
    if (message.role === 'assistant') {
      const calls = message.tool_calls ? (JSON.parse(message.tool_calls) as ToolCall[]) : [];
      if (message.content?.trim()) {
        if (calls.length)
          events.push({ kind: 'note', text: `Agent (mid-turn): ${message.content.trim()}` });
        else reply = message.content.trim();
      }
      for (const call of calls) {
        pending.set(call.id, {
          name: call.function.name,
          args: parseJson(call.function.arguments),
        });
      }
    } else if (message.role === 'tool' && message.tool_call_id) {
      const call = pending.get(message.tool_call_id);
      const name = call?.name ?? message.tool_name ?? 'unknown';
      if (name.startsWith(CRM_PREFIX)) {
        const entry = queue.shift();
        if (entry)
          events.push({
            kind: 'tool',
            source: 'crm',
            tool: entry.tool,
            args: entry.args,
            ok: entry.ok,
            result: entry.result,
          });
        if (!entry || entry.tool !== name.slice(CRM_PREFIX.length)) {
          events.push({
            kind: 'note',
            text: `CRM audit did not match the transcript call ${name}`,
          });
        }
      } else {
        const result = unwrapToolResult(message.content ?? '');
        events.push({
          kind: 'tool',
          source: 'hermes',
          tool: name,
          args: (call?.args ?? {}) as Record<string, unknown>,
          ok: !/^\s*\{\s*"(error|success)"\s*:\s*(false|")/.test(result),
          result: result.length > 4000 ? `${result.slice(0, 4000)}…` : result,
        });
      }
    }
  }
  for (const entry of queue) {
    events.push({
      kind: 'tool',
      source: 'crm',
      tool: entry.tool,
      args: entry.args,
      ok: entry.ok,
      result: entry.result,
    });
  }
  return { events, reply };
}

#!/usr/bin/env node
// Stand-in for the `hermes` CLI in tests: same flags, same state.db tables and usage file, but a
// tiny scripted agent instead of a model. It drives the real CRM state file, so the runner, the
// transcript reader and the checks are exercised end to end without spending anything.
//
// FAKE_HERMES_FAIL=rate_limit | rate_limit_once | account | hang   (rate_limit_once needs FAKE_HERMES_MARKER)
import { callTool, loadState, saveState } from '@evals/crm';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';

const argv = process.argv.slice(2);
if (argv[0] === '--version') {
  console.log('Fake Hermes 0.0.0');
  process.exit(0);
}
if (argv[0] === 'gateway') process.exit(0);

const { values } = parseArgs({
  args: argv,
  options: {
    oneshot: { type: 'string', short: 'z' },
    model: { type: 'string', short: 'm' },
    provider: { type: 'string' },
    toolsets: { type: 'string', short: 't' },
    'usage-file': { type: 'string' },
    resume: { type: 'string' },
    reasoning: { type: 'string' },
    skills: { type: 'string', short: 's', multiple: true },
  },
});

const home = process.env.HERMES_HOME;
const usageFile = values['usage-file'];
const writeUsage = (extra) =>
  writeFileSync(
    usageFile,
    JSON.stringify({
      input_tokens: 100,
      output_tokens: 20,
      estimated_cost_usd: 0.001,
      cost_status: 'estimated',
      api_calls: 2,
      turn_exit_reason: 'text_response(finish_reason=stop)',
      failed: false,
      auxiliary: { api_calls: 0, estimated_cost_usd: 0 },
      ...extra,
    }),
  );

const fail = process.env.FAKE_HERMES_FAIL;
if (fail === 'hang') setInterval(() => {}, 1000);
else if (fail === 'account') {
  writeUsage({ failed: true, failure: 'HTTP 401: Incorrect API key provided' });
  process.exit(1);
} else if (
  fail === 'rate_limit' ||
  (fail === 'rate_limit_once' && !existsSync(process.env.FAKE_HERMES_MARKER))
) {
  if (process.env.FAKE_HERMES_MARKER) writeFileSync(process.env.FAKE_HERMES_MARKER, '');
  writeUsage({ failed: true, failure: 'HTTP 429: Rate limit reached for requests' });
  process.exit(2);
} else run();

function run() {
  const config = JSON.parse(readFileSync(join(home, 'config.yaml'), 'utf8'));
  const stateFile = config.mcp_servers.crm.env.CRM_STATE_FILE;
  const db = new DatabaseSync(join(home, 'state.db'));
  db.exec(`
    create table if not exists sessions (id text primary key, model text, billing_provider text,
      billing_base_url text, system_prompt_hash text);
    create table if not exists system_prompts (hash text primary key, prompt text);
    create table if not exists messages (id integer primary key autoincrement, session_id text,
      role text, content text, tool_calls text, tool_call_id text, tool_name text);
  `);

  const sessionId = values.resume ?? `fake-${randomUUID()}`;
  if (!values.resume) {
    const memory = join(home, 'memories', 'MEMORY.md');
    const prompt = [
      readFileSync(join(home, 'SOUL.md'), 'utf8'),
      values.toolsets.includes('memory') && existsSync(memory)
        ? `MEMORY:\n${readFileSync(memory, 'utf8')}`
        : '',
    ].join('\n');
    db.prepare('insert into system_prompts values (?, ?) on conflict do nothing').run(
      sessionId,
      prompt,
    );
    db.prepare('insert into sessions values (?, ?, ?, ?, ?)').run(
      sessionId,
      values.model,
      values.provider,
      'https://fake.invalid/v1',
      sessionId,
    );
  }
  const add = (role, content, extra = {}) =>
    db
      .prepare(
        'insert into messages (session_id, role, content, tool_calls, tool_call_id, tool_name) values (?, ?, ?, ?, ?, ?)',
      )
      .run(
        sessionId,
        role,
        content,
        extra.tool_calls ?? null,
        extra.tool_call_id ?? null,
        extra.tool_name ?? null,
      );

  const prompt = values.oneshot;
  add('user', prompt);
  const contactId = /contact id ([^)]+)\)/.exec(prompt)?.[1];

  const use = (tool, args) => {
    const state = loadState(stateFile);
    const { result } = callTool(state, tool, args);
    saveState(stateFile, state);
    const id = `call_${randomUUID().slice(0, 8)}`;
    add('assistant', '', {
      tool_calls: JSON.stringify([
        { id, function: { name: `mcp__crm__${tool}`, arguments: JSON.stringify(args) } },
      ]),
    });
    add(
      'tool',
      `<untrusted_tool_result source="mcp__crm__${tool}">\nThe following content was retrieved from an external source.\n\n${JSON.stringify({ result: JSON.stringify(result) })}\n</untrusted_tool_result>`,
      { tool_call_id: id, tool_name: `mcp__crm__${tool}` },
    );
    return result;
  };

  let reply;
  const wantsTime = /(\d{1,2})(?::\d\d)?\s*(am|pm)\b.*(works|book|perfect|then)/i.exec(prompt);
  if (wantsTime) {
    const hour = (Number(wantsTime[1]) % 12) + (wantsTime[2].toLowerCase() === 'pm' ? 12 : 0);
    const slot = use('search_slots', {}).find((s) => Number(s.start.slice(11, 13)) === hour);
    const booking =
      slot &&
      use('book_appointment', {
        contact_id: contactId,
        slot_id: slot.slot_id,
        service_id: 'cleaning',
      });
    if (booking?.appointment) {
      use('update_contact', { contact_id: contactId, stage: 'booked' });
      reply = `You're booked for ${booking.label}. See you then!`;
    } else {
      const free = use('search_slots', {});
      reply = `Sorry, that time was just taken. I can do ${free.map((s) => s.label).join(' or ')}.`;
    }
  } else if (/cleaning/i.test(prompt)) {
    use('get_contact', { contact_id: contactId });
    const free = use('search_slots', {});
    reply = `Happy to help! I have ${free.map((s) => s.label).join(' or ')}. Which works for you?`;
  } else {
    reply = 'Thanks for your message!';
  }
  add('assistant', reply);
  db.close();
  writeUsage({ session_id: sessionId });
  process.stdout.write(`${reply}\n`);
}

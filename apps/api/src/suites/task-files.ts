import { BUSINESS } from '@evals/crm';
import { taskSchema, type EventSelector, type TaskDefinition } from '@evals/shared';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse } from 'yaml';

export interface TaskFile {
  suite: string;
  key: string;
  versionHash: string;
  definition: TaskDefinition;
}

/** Frozen eval cases must be explicitly versioned before changing their content or membership. */
export function verifyFrozenTasks(
  files: TaskFile[],
  frozen: { key: string; versionHash: string }[],
): void {
  if (
    files.length !== frozen.length ||
    files.some(
      (file) => !frozen.some((f) => f.key === file.key && f.versionHash === file.versionHash),
    )
  ) {
    throw new Error(
      'Frozen evaluation suite differs from manifest.json; create a new reviewed suite version before running',
    );
  }
}

const SPLITS = ['dev', 'eval'] as const;

/** Mistakes the schema can't see: bad regexes and references to things that don't exist. */
export function lintTask(task: TaskDefinition): string[] {
  const problems: string[] = [];
  const contacts = new Set(task.crm.contacts.map((c) => c.id));
  const slots = new Set(task.crm.slots.map((s) => s.id));
  const services = new Set(BUSINESS.services.map((s) => s.id));
  const rules = new Set(task.sessions.flatMap((s) => s.rules.map((r) => r.id)));

  const regex = (pattern: string, where: string) => {
    try {
      new RegExp(pattern, 'i');
    } catch {
      problems.push(`${where}: invalid regex /${pattern}/`);
    }
  };
  const known = (set: Set<string>, value: unknown, what: string, where: string) => {
    if (typeof value === 'string' && !set.has(value))
      problems.push(`${where}: unknown ${what} ${value}`);
  };
  const selector = (s: EventSelector, where: string) => {
    if ('reply' in s) regex(s.reply, where);
    if ('leadRule' in s) [s.leadRule].flat().forEach((id) => known(rules, id, 'lead rule', where));
    if ('tool' in s) {
      for (const [key, matcher] of Object.entries(s.args ?? {})) {
        if (typeof matcher === 'object' && 'match' in matcher) regex(matcher.match, where);
        if (key === 'contact_id') known(contacts, matcher, 'contact', where);
        if (key === 'slot_id') known(slots, matcher, 'slot', where);
        if (key === 'service_id') known(services, matcher, 'service', where);
      }
    }
  };

  task.crm.takenOnFirstTry.forEach((id) => known(slots, id, 'slot', 'crm.takenOnFirstTry'));
  task.sessions.forEach((session, i) =>
    session.rules.forEach((rule) => {
      const where = `sessions[${i}].rules.${rule.id}`;
      regex(rule.when, where);
      // An unquoted comma in a YAML flow mapping silently swallows the next keys into the text.
      if (/\b(id|when|say|end):/.test(rule.say)) problems.push(`${where}: YAML keys inside "say"`);
    }),
  );
  for (const check of task.checks) {
    const where = `checks.${check.id}`;
    if (check.session && check.session > task.sessions.length) {
      problems.push(`${where}: session ${check.session} does not exist`);
    }
    if (check.type === 'tool_called' || check.type === 'tool_not_called') selector(check, where);
    if (check.type === 'order') {
      selector(check.before, `${where}.before`);
      selector(check.after, `${where}.after`);
    }
    if (check.type === 'reply') {
      if (check.match) regex(check.match, where);
      if (check.noMatch) regex(check.noMatch, where);
      if (!check.match && !check.noMatch) problems.push(`${where}: needs match or noMatch`);
    }
    if (check.type === 'state') {
      const [root, id] = check.path.split('.');
      if (root === 'contacts') known(contacts, id, 'contact', where);
    }
  }
  return problems;
}

/** Read every `<suitesDir>/<suite>/<dev|eval>/*.yaml`, validated and linted. Throws on the first bad file. */
export function readTaskFiles(suitesDir: string): TaskFile[] {
  const files: TaskFile[] = [];
  for (const suite of readdirSync(suitesDir, { withFileTypes: true })) {
    if (!suite.isDirectory()) continue;
    for (const split of SPLITS) {
      const dir = join(suitesDir, suite.name, split);
      let names: string[];
      try {
        names = readdirSync(dir).filter((n) => n.endsWith('.yaml'));
      } catch {
        continue;
      }
      for (const name of names.sort()) {
        const path = join(dir, name);
        const parsed = taskSchema.safeParse({ ...parse(readFileSync(path, 'utf8')), split });
        if (!parsed.success) throw new Error(`${path}: ${parsed.error.message}`);
        const problems = lintTask(parsed.data);
        if (problems.length) throw new Error(`${path}:\n  ${problems.join('\n  ')}`);
        files.push({
          suite: suite.name,
          key: basename(name, '.yaml'),
          versionHash: createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex'),
          definition: parsed.data,
        });
      }
    }
  }
  for (const suite of new Set(files.map((f) => f.suite))) {
    const manifestPath = join(suitesDir, suite, 'eval', 'manifest.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        tasks: { key: string; versionHash: string }[];
      };
      verifyFrozenTasks(
        files.filter((f) => f.suite === suite && f.definition.split === 'eval'),
        manifest.tasks,
      );
    }
  }
  return files;
}

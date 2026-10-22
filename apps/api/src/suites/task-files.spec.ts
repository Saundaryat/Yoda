import { taskSchema } from '@evals/shared';
import { fileURLToPath } from 'node:url';
import { lintTask, readTaskFiles } from './task-files.js';

const SUITES_DIR = fileURLToPath(new URL('../../../../suites', import.meta.url));

describe('the task files in this repo', () => {
  const files = readTaskFiles(SUITES_DIR);

  it('all parse and lint clean', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('have unique keys per suite', () => {
    const keys = files.map((f) => `${f.suite}/${f.key}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('lintTask', () => {
  it('reports bad regexes and dangling references', () => {
    const task = taskSchema.parse({
      title: 't',
      family: 'f',
      split: 'dev',
      group: 'control',
      crm: {
        contacts: [{ id: 'c-1', name: 'A', phone: '1' }],
        slots: [{ id: 's-1', day: 1, time: '09:00' }],
        takenOnFirstTry: ['s-9'],
      },
      sessions: [{ contact: 'c-1', opening: 'hi', rules: [{ id: 'r', when: '(', say: 'x' }] }],
      checks: [
        {
          id: 'a',
          label: '',
          type: 'tool_called',
          tool: 'book_appointment',
          args: { slot_id: 's-2', service_id: 'spa' },
        },
        {
          id: 'b',
          label: '',
          type: 'order',
          before: { leadRule: 'nope' },
          after: { tool: 'book_appointment' },
        },
        { id: 'c', label: '', type: 'state', path: 'contacts.c-2.stage', equals: 'booked' },
        { id: 'd', label: '', type: 'reply', session: 2 },
      ],
    });
    expect(lintTask(task)).toEqual([
      'crm.takenOnFirstTry: unknown slot s-9',
      'sessions[0].rules.r: invalid regex /(/',
      'checks.a: unknown slot s-2',
      'checks.a: unknown service spa',
      'checks.b.before: unknown lead rule nope',
      'checks.c: unknown contact c-2',
      'checks.d: session 2 does not exist',
      'checks.d: needs match or noMatch',
    ]);
  });
});

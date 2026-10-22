import { z } from 'zod';
import { crmSeedSchema } from './crm.js';

/**
 * An argument matcher: a plain value must be equal (compared as strings), `{ match }` is a
 * case-insensitive regex, `{ not }` must differ.
 */
const argMatcherSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.object({ match: z.string() }).strict(),
  z.object({ not: z.union([z.string(), z.number(), z.boolean()]) }).strict(),
]);

/** Selects tool calls by name (CRM tools without prefix, Hermes tools like `skill_view` as-is). */
const toolSelectorSchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), argMatcherSchema).optional(),
  /** Only calls the CRM accepted (default: every attempt counts, rejected ones too). */
  okOnly: z.boolean().optional(),
});

/** Selects agent replies (the SMS text the lead sees) by a case-insensitive regex. */
const replySelectorSchema = z.object({ reply: z.string() });

/** Selects the lead message produced by a given lead rule, e.g. the lead accepting a slot. */
const leadRuleSelectorSchema = z.object({ leadRule: z.string() });

export const eventSelectorSchema = z.union([
  toolSelectorSchema,
  replySelectorSchema,
  leadRuleSelectorSchema,
]);
export type EventSelector = z.infer<typeof eventSelectorSchema>;
export type ArgMatcher = z.infer<typeof argMatcherSchema>;

const checkBase = {
  id: z.string(),
  label: z.string(),
  weight: z.number().positive().default(1),
  /** A failed critical check fails the run whatever the score. */
  critical: z.boolean().default(false),
  /** Only look at events from this session (1-based). Default: the whole run. */
  session: z.number().int().positive().optional(),
};

export const checkSchema = z.discriminatedUnion('type', [
  z.object({
    ...checkBase,
    type: z.literal('tool_called'),
    ...toolSelectorSchema.shape,
    min: z.number().int().min(0).default(1),
    max: z.number().int().min(0).optional(),
  }),
  z.object({ ...checkBase, type: z.literal('tool_not_called'), ...toolSelectorSchema.shape }),
  z.object({
    ...checkBase,
    type: z.literal('state'),
    /** Dotted path into the final CRM state, e.g. `contacts.c-101.stage` or `appointments.length`. */
    path: z.string(),
    equals: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  }),
  z.object({
    ...checkBase,
    type: z.literal('reply'),
    /** Some agent reply must match... */
    match: z.string().optional(),
    /** ...and no agent reply may match. */
    noMatch: z.string().optional(),
  }),
  z.object({
    ...checkBase,
    type: z.literal('order'),
    before: eventSelectorSchema,
    after: eventSelectorSchema,
    /** Pass when `after` never happens (default false: both must happen, in this order). */
    afterOptional: z.boolean().default(false),
  }),
  z.object({
    ...checkBase,
    type: z.literal('budget'),
    maxToolCalls: z.number().int().positive().optional(),
    maxTurns: z.number().int().positive().optional(),
  }),
]);

export type Check = z.infer<typeof checkSchema>;
export type CheckType = Check['type'];

/** A lead rule: when the agent's latest reply matches `when`, the lead says `say`. */
const leadRuleSchema = z.object({
  id: z.string(),
  when: z.string(),
  say: z.string(),
  /** End the conversation after the agent answers this message. */
  end: z.boolean().default(false),
});

export const sessionSchema = z.object({
  contact: z.string(),
  opening: z.string(),
  rules: z.array(leadRuleSchema).default([]),
  /** Said once when no rule matches; the conversation ends the next time nothing matches. */
  fallback: z.string().nullable().default(null),
  /** Lead messages in this session, opening included. */
  maxTurns: z.number().int().positive().default(6),
});

export const taskSchema = z
  .object({
    title: z.string(),
    family: z.string(),
    split: z.enum(['dev', 'eval']),
    /** policy: the rule lives in the clinic skill. control: no skill needed. memory: spans sessions. */
    group: z.enum(['policy', 'control', 'memory']),
    description: z.string().default(''),
    crm: crmSeedSchema,
    /** More than one session = a returning lead: new Hermes session, same home and CRM. */
    sessions: z.array(sessionSchema).min(1),
    checks: z.array(checkSchema).min(1),
    passThreshold: z.number().min(0).max(100).default(80),
  })
  .superRefine((task, ctx) => {
    const ids = task.checks.map((c) => c.id);
    const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
    if (duplicate) ctx.addIssue({ code: 'custom', message: `duplicate check id ${duplicate}` });
    const contacts = new Set(task.crm.contacts.map((c) => c.id));
    for (const session of task.sessions) {
      if (!contacts.has(session.contact)) {
        ctx.addIssue({ code: 'custom', message: `session contact ${session.contact} not in crm` });
      }
    }
  });

export type TaskDefinition = z.infer<typeof taskSchema>;
export type LeadRule = z.infer<typeof leadRuleSchema>;
export type SessionScript = z.infer<typeof sessionSchema>;

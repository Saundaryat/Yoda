import { z } from 'zod';

/** Extra Hermes toolsets a configuration may add. The CRM tools are always on. */
export const OPTIONAL_TOOLSETS = ['todo', 'session_search'] as const;

export const configurationSpecSchema = z
  .object({
    provider: z.enum(['openai', 'anthropic']),
    model: z.string().min(1),
    reasoning: z.enum(['none', 'low', 'medium', 'high']).optional(),
    /** Written to the run home's SOUL.md, the first slot of Hermes's system prompt. */
    systemPrompt: z.string().min(1),
    /** Skill folder names from the repo's skills/ library. */
    skills: z.array(z.string()).default([]),
    /** available: listed in the prompt, the agent decides to open them. preloaded: full text in the prompt. */
    skillMode: z.enum(['available', 'preloaded']).default('available'),
    memory: z
      .object({
        enabled: z.boolean(),
        /** Entries written to MEMORY.md before the first session. */
        seed: z.array(z.string()).default([]),
      })
      .default({ enabled: false, seed: [] }),
    toolsets: z.array(z.enum(OPTIONAL_TOOLSETS)).default([]),
    /** Hermes hides MCP tools behind tool_search/tool_describe/tool_call when on. */
    toolSearch: z.boolean().default(false),
  })
  .refine((spec) => spec.memory.enabled || spec.memory.seed.length === 0, {
    message: 'a memory seed needs memory enabled',
    path: ['memory', 'seed'],
  });

export type ConfigurationSpec = z.infer<typeof configurationSpecSchema>;

export const createConfigurationSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  spec: configurationSpecSchema,
});

export type CreateConfiguration = z.infer<typeof createConfigurationSchema>;

export interface Configuration extends CreateConfiguration {
  id: string;
  specHash: string;
  createdAt: string;
}

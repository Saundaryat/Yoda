# Agent configurations

An **agent configuration** (shown in the UI as an _agent version_) is everything that defines the
agent under test. Configurations are immutable: the spec is content-hashed (`specHash`) and saved
skill contents are frozen with it. To change something, copy a configuration and save a new one.

## Spec fields

Defined by `configurationSpecSchema` in `packages/shared/src/configuration.ts`.

| Field          | Values                                | Meaning                                                                                                                           |
| -------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `provider`     | `openai` \| `anthropic`               | Which model provider Hermes calls; the matching API key must be set on the server                                                 |
| `model`        | string                                | Provider model id                                                                                                                 |
| `reasoning`    | `none` \| `low` \| `medium` \| `high` | Optional reasoning effort                                                                                                         |
| `systemPrompt` | string                                | Written to the run home's `SOUL.md`, the first slot of Hermes's system prompt                                                     |
| `skills`       | skill folder names                    | Skills from the repository's `skills/` library                                                                                    |
| `skillMode`    | `available` (default) \| `preloaded`  | `available`: listed in the prompt, the agent may open them with skill tools. `preloaded`: full text in the prompt, no skill tools |
| `memory`       | `{ enabled, seed[] }`                 | Hermes memory on/off; `seed` entries are written to `MEMORY.md` before the first session (requires `enabled`)                     |
| `toolsets`     | `todo`, `session_search`              | Optional extra Hermes toolsets. CRM tools are always on                                                                           |
| `toolSearch`   | boolean (default `false`)             | When on, Hermes hides MCP tools behind `tool_search` / `tool_describe` / `tool_call`                                              |

A configuration also has a `name` and `description`. The UI displays saved configurations as
**V# · Plain-language title** in version order.

## Example

```json
{
  "name": "V2 · Clinic policy preloaded",
  "description": "Same as V1 but the policy skill is in the prompt.",
  "spec": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5",
    "systemPrompt": "You are the SMS assistant for Bright Smile Dental...",
    "skills": ["clinic-policy"],
    "skillMode": "preloaded",
    "memory": { "enabled": false, "seed": [] },
    "toolsets": [],
    "toolSearch": false
  }
}
```

## Skills

The library lives in `skills/<name>/SKILL.md`. The bundled `clinic-policy` skill holds the Bright
Smile front-desk rules: minors need a guardian, never give clinical advice and escalate symptoms,
quote only listed prices, no same-day bookings, never answer insurance questions, and write a
`BOOKED <service_id> <YYYY-MM-DD HH:MM> via SMS` note after every booking.

Policy scenarios test whether the agent follows these rules, so whether the skill is selected, and
in which mode, is often the change being tested.

## Saved prompts

`prompts/` holds instruction sets used in documented experiments (`contact-continuity-v1`,
`grounded-replies-v1`, `grounded-sms-v2`, `grounded-sms-v3`, `verified-actions-v1`). Paste one into
a configuration's instructions to reproduce or extend those experiments.

## How a configuration becomes a Hermes run

For every run the worker builds a fresh Hermes home (`apps/api/src/runner/hermes-home.ts`):

- `config.yaml` sets the model and provider, the run budget (`RUN_BUDGET_SECONDS`), tool search,
  memory, and the `crm` MCP server.
- Anything that could make a run depend on more than the configuration is switched off: fallback
  providers, background review, curator, title generation, update checks, lazy installs, adopting
  host logins, project skill discovery and the bundled `hermes-agent` skill.
- `SOUL.md` holds the system prompt; skills go under `skills/clinic/<name>/SKILL.md`.

The reasoning behind each setting, and how it was verified, is in `spike/NOTES.md`.

## Keeping comparisons fair

Change one thing at a time when you want to attribute a result to that change. If prompt, model and
reasoning change together, the experiment measures the bundle, not the prompt.

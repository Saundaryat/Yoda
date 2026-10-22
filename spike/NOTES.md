# Phase 0: Hermes spike notes

Hermes: official image `nousresearch/hermes-agent:v0.22.4` pinned by digest
`sha256:7a69201726bc64db2072a1371557137c23312d29705cda2b8ea2a0214a50a4cf`
(upstream `4d043038`, multi-arch, includes Node 26 and SQLite 3.53.1).

Tools in this folder: `stub-model.mjs` (scripted OpenAI-compatible model that logs every
request), `crm-server.mjs` (3-tool MCP CRM with an audit log), `turn.mjs` (one lead turn in a
throwaway home inside the official image).

## Confirmed with the stub model (no spend)

| Check                    | Result                                                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Throwaway home           | Works. `sessions.billing_provider` / `billing_base_url` record what was really used. Container gets no host env.                                                                                                                |
| CRM tools over MCP       | Work, named `mcp__crm__<tool>`. Default **tool search hides MCP tools** behind `tool_search`/`tool_describe`/`tool_call`; `tools.tool_search.enabled: off` makes them direct.                                                   |
| Tool results             | Wrapped as `<untrusted_tool_result source=...>`. Relevant to the prompt-injection tasks.                                                                                                                                        |
| Resume                   | `-z ... --resume <session_id>` in a new process keeps full history. Usage file = this turn only; `sessions` row = running totals.                                                                                               |
| Transcript               | `state.db` `messages`: role, content, `tool_calls` JSON, `tool_name`, `tool_call_id`. System prompt in `system_prompts` (non-JSON row).                                                                                         |
| Skills: none             | No skill tools, no index.                                                                                                                                                                                                       |
| Skills: available        | Index lists the skill + `skill_view/skills_list/skill_manage`; body not in prompt. **Description is cut at ~60 chars** in the index. One essential bundled skill (`hermes-agent`) is still seeded despite `.no-bundled-skills`. |
| Skills: preloaded (`-s`) | Skill body in the prompt, no skill tools.                                                                                                                                                                                       |
| Memory off               | Seeded `MEMORY.md` ignored, no `memory` tool.                                                                                                                                                                                   |
| Memory on                | Seed shown as "MEMORY (your personal notes)"; `memory` tool offered.                                                                                                                                                            |
| Cross-session memory     | Session 1 `memory add` → `MEMORY.md`; session 2 (new session, same home) has it in the prompt.                                                                                                                                  |
| Hidden model calls       | `auxiliary.api_calls = 0` in every run with review/title/curator off.                                                                                                                                                           |
| Rate limit               | 3 attempts, exit code 2, usage `failed: true`, `failure: "HTTP 429: ..."`. stdout carries a user-facing error text — never score it as the agent's reply.                                                                       |
| Hung model call          | `run_budget_seconds` does **not** cap it; our own timeout must kill the turn. Killing `docker run` removes the container cleanly.                                                                                               |
| Prompt date              | Hermes writes today's real date into the prompt, so task dates must be relative to the run date.                                                                                                                                |

## Process model inside one container (the real app's shape)

- Even `-z` auto-starts a per-home **gateway** (`gateway run --idle-exit`, ~310 MB) that keeps the
  CRM MCP server (~77 MB) alive between turns. Default idle exit is 600 s.
- Latency: first turn of a run ~5–7 s overhead, later `--resume` turns **~1 s** (warm gateway).
- The gateway refuses homes not owned by uid 10000 or writable by others: run as `hermes`
  (uid 10000) with `umask 077`.
- `hermes gateway stop` (same `HERMES_HOME`) stops that run's gateway and CRM server in ~2.6 s
  and leaves other runs alone. Runner must call it at run end; set
  `gateway.unmanaged_idle_exit_seconds` low as a safety net.
- `state.db` on a host bind mount triggers Hermes's cross-VM WAL warning → keep run homes on a
  Docker named volume; copy artifacts out.

## Config we seed per run

`_config_version: 51`, `model.{default,provider,context_length}`, `fallback_providers: []`,
`tools.tool_search.enabled: off`, `agent.{run_budget_seconds,auto_recovery_cycles: 0}`,
`memory.{memory_enabled,user_profile_enabled,nudge_interval: 0,provider: ""}`,
`skills.project_discovery: false`, `curator.enabled: false`,
`auxiliary.{background_review,title_generation}.enabled: false`, `updates.check: false`,
`auth.adopt_external_logins: false`, `security.allow_lazy_installs: false`, telemetry off,
`mcp_servers.crm`. Plus `SOUL.md`, `.no-bundled-skills`, `skills/clinic/<name>/SKILL.md`,
`memories/MEMORY.md`, and a `.env` holding only the provider key.

## Still to do (needs a real key)

- Tokens, cost and seconds per turn on the chosen model (feeds the cost estimate).
- Does a real model open the skill when it's only _available_? How often?
- Bad key → expected fatal classification.
- Pick the experiment model from dev-split pass rates (baseline must have headroom).

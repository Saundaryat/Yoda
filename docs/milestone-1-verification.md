# Milestone 1 — real Hermes and mock CRM verification

Verified October 21, 2026, 01:01–01:02 IST. This is one integration scenario, not the final comparative experiment.

## Result

The final verification completed successfully in approximately 38 seconds. Three user turns ran through the real Hermes Runs API in one session, with a private CRM MCP subprocess and fresh agent home. All eight scenario checks passed. The model/provider requested was `copilot / gpt-4.1`, with memory disabled and no domain skill.

[Complete saved evidence](../output/verification/verification-2026-10-20T19-31-55.687Z-38c43b2f/report.json) includes prompt/configuration snapshots, Hermes commit, external run/session IDs, usage, SSE records, all CRM calls, initial lead facts, final state, and assertions. The run ID uses UTC; the date above uses Asia/Kolkata.

Pinned checkout: `349e4f7e620ea1be6a8b5703d7152cf1e5ed9998`.

## Observed conversation and actions

| Turn | Lead input | Actual agent behavior |
| --- | --- | --- |
| 1 | Requests an adult dental consultation, earliest weekday afternoon; age omitted | Reads policy/contact; sends an age question and stops |
| 2 | Says age 25 and repeats afternoon preference | Searches real mock slots; offers November 3, 2026 at 14:00; asks permission and stops |
| 3 | Explicitly accepts the selected slot | Books with consent event `event-8`; saves a note; updates the pipeline; sends an accurate confirmation |

The host delivered age and consent as subsequent user turns, after the preceding turn completed. Neither answer was returned inside the asking tool call. Turn 3 contained only the consent reply, so its successful action also demonstrates continuation of the earlier conversation.

Final appointment: `appointment-1`, contact `contact-101`, service `dental-consultation`, slot `slot-afternoon-early`, November 3, 2026 at 14:00 Asia/Kolkata. Pipeline stage: `appointment_booked`. One note saved. No rejected operations reached the CRM service.

## Verification and tests

- `npm run typecheck`: passed.
- `npm test`: six tests passed, including a real MCP client/server stdio contract test.
- `npm run verify:hermes`: passed with three completed Hermes turns and eight successful CRM assertions.
- Replaying each create request with the same idempotency key returned the same external run ID.
- Unit tests confirm that blocked no-consent, duplicate, wrong-contact, invalid-slot-consent, and false-confirmation attempts cannot produce a passing result.
- Unit tests confirm audit snapshots do not change after later state updates and independent fixtures share no state.
- The runner stops its dedicated gateway/process group on completion and preserves the evidence.

## Findings to carry into the platform

1. The local launcher assumes a dependency environment under the current home. Fresh homes initially failed to start. The runner now uses the existing committed dependency interpreter while keeping agent state in a fresh home; no PM facts or generations were edited.
2. Hermes recovered from five malformed tool-call attempts in the final run before they reached MCP. They are counted as runtime warnings; all final business assertions passed, but tool-call quality was not perfect. Future suite grading must include both runtime failures and authoritative MCP evidence.
3. The Copilot runtime warned that its token exchange degraded to the raw-token path. Calls still completed. This warning is preserved rather than hidden.
4. The API returned empty actual served model/provider fields, while preserving the requested pair. The report does not claim independent confirmation of the served model or a verified dollar cost.
5. Toolset discovery returned no enabled dynamic MCP entry despite successful MCP calls. Treat actual audited calls and client discovery as connection evidence rather than relying exclusively on that inventory endpoint.
6. The current driver depends on typed message intents. Human-facing text and structured fields in this real run were manually reviewed for consistency; semantic consistency is not yet a general automated grader.

## Remaining work

No active-inference cancellation test, live profile reuse/reset test, weighted multi-task suite, NestJS worker/database, Vue UI, confidence calculation, or prompt/workflow comparison has been implemented in this milestone. The integration supports proceeding to those milestones; it does not demonstrate statistically measured agent improvement yet.

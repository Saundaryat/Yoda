# Web UI

The Vue app (`apps/web`) is served by the API in Docker at <http://127.0.0.1:3080>, or by Vite on
port 5173 in development. Routes are defined in `apps/web/src/router.ts`.

| Path                             | Page              | What it's for                                                                                                             |
| -------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `/`                              | Experiments       | All experiments with status, observed result and an experiment progression view                                           |
| `/experiments/new`               | New experiment    | Choose A and B, scenarios, repetitions, customer mode and hypothesis; save a draft                                        |
| `/experiments/:id`               | Experiment        | Progress, observed result, confidence & methodology, results by scenario group, metrics & evidence, checks that changed   |
| `/experiments/:id/costs`         | Costs             | "Where the estimate goes": agent, customer and grading cost rows                                                          |
| `/experiments/:id/tasks/:taskId` | Compare           | One scenario: A and B checks side by side across repetitions                                                              |
| `/runs/:id`                      | Run               | One run: conversation, tool calls, CRM changes, checks with linked evidence                                               |
| `/tasks`                         | Scenarios         | Development and evaluation scenarios                                                                                      |
| `/tasks/:id`                     | Scenario          | How it is scored, the customer script per session, the CRM at the start                                                   |
| `/configurations`                | Configurations    | Saved agent versions, shown as **V# · Title**                                                                             |
| `/configurations/new`            | New configuration | Five-step form: name; model and instructions; policy and skills; memory and tools; review and save. Can start from a copy |
| `/configurations/:id`            | Configuration     | Saved settings, instructions and full spec                                                                                |
| `/how-it-works`                  | How it works      | Shared guide: A/B versions, scenarios, repetitions, run counts, reading results                                           |

## Metrics & evidence

The experiment page's **Metrics & evidence** section has four views:

- **Reply quality**: judge findings per reply, with severity, handling by customer message and
  conversation outcomes on demand.
- **Performance metrics**
- **Tool usage**
- **Experiment setup**: the saved name, planned coverage and full hypothesis.

## Navigation behavior

- Sections, evidence views, expanded breakdowns, comparison repetition and list filters are stored
  in the URL, so reloads and shared links restore them.
- Drill-downs (experiment → scenario → run) preserve their return context. Back restores the
  scroll position once content has loaded.
- Live progress uses the SSE stream; every reconnection reloads authoritative state.
- If a long-lived tab requests a code chunk removed by a rebuild, the router reloads the destination
  once with the new app shell.

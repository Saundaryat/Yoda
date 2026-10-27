# Yoda wiki

Yoda is an evaluation harness for AI agents built on [Hermes](https://github.com/NousResearch/hermes-agent).
It answers one question: **did a change to an agent actually make it behave better?** It runs two
agent versions (A and B) through the same customer scenarios, checks every conversation and CRM
action, and reports a paired comparison with uncertainty, costs and per-run evidence.

The bundled suite simulates SMS conversations for **Bright Smile Dental**, a synthetic clinic with a
mock CRM and calendar. No real customer data is involved.

## Pages

| Page                                            | Read it to learn                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| [Getting started](Getting-Started.md)           | Run the app with Docker and complete a first A/B comparison            |
| [Architecture](Architecture.md)                 | How the web app, API, worker, Hermes, mock CRM and database fit        |
| [Agent configurations](Agent-Configurations.md) | What an agent version contains and how it becomes a Hermes home        |
| [Scenarios](Scenarios.md)                       | The clinic suite, the task YAML format and the frozen evaluation split |
| [Mock CRM](Mock-CRM.md)                         | The clinic, its services and the eight CRM tools                       |
| [Scoring](Scoring.md)                           | Code checks, the Claude judge, grounding review and pass rules         |
| [Reading results](Reading-Results.md)           | Pass rates, the paired bootstrap interval and verdicts                 |
| [Experiment lifecycle](Experiment-Lifecycle.md) | Statuses, retries, cancellation, snapshots, recovery and cost caps     |
| [API reference](API-Reference.md)               | REST and SSE endpoints served under `/api`                             |
| [Web UI](Web-UI.md)                             | Every page of the Vue interface                                        |
| [Configuration and costs](Configuration.md)     | Environment variables, model keys and spend limits                     |
| [Development and testing](Development.md)       | Local setup, checks, CI, migrations, calibration and rescoring         |
| [Glossary](Glossary.md)                         | Terms used across the app and these docs                               |

## Other documentation in the repository

- [README](../../README.md): the short product overview.
- [Experiment lifecycle and durable grading](../experiment-lifecycle.md): detailed guarantees.
- [Clinic scenario design](../../suites/clinic/README.md): why the scenarios look the way they do.
- [Handoff notes](../HANDOFF.md): dated implementation history and verification evidence.
- [Experiment reports](../experiments/) and [calibration results](../calibration/).

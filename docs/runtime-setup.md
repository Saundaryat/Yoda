# Live Hermes setup

Evaluators can inspect the complete submission without a model account using `npm run review`. The following prerequisites apply only to new live experiments.

1. Install Hermes using its [official installation instructions](https://hermes-agent.nousresearch.com/docs/getting-started/installation). The installer prepares the runtime dependencies; this repository does not bundle them or your credentials.
2. Use an installed source checkout at the verified [Hermes commit](https://github.com/NousResearch/hermes-agent/commit/349e4f7e620ea1be6a8b5703d7152cf1e5ed9998), `349e4f7e620ea1be6a8b5703d7152cf1e5ed9998`. This integration relies on that revision's Runs API, session handling and dynamic MCP support. Installing the current stable release alone does not reproduce the saved runtime pin. Follow the checkout's installation/PM instructions to prepare its dependencies after selecting the revision; do not assume a different runtime is compatible.
3. Configure a provider through Hermes's interactive setup. The saved experiments requested Copilot / `gpt-4.1`; the account must actually permit that model. Current plan/model availability can differ from the saved run. Credentials stay in Hermes's provider credential store or your environment, never in this Git repository.
4. Point this application at that installed source checkout, then start the app:

```bash
EVAL_HERMES_ROOT=/absolute/path/to/installed/hermes-agent npm start
```

The application finds the dependency interpreter using that checkout's `.hermes-dev/installs` selection facts. For another prepared layout, set `EVAL_HERMES_BIN`, or `EVAL_HERMES_PYTHON` and `EVAL_HERMES_RUNTIME_DIR`, as documented in README. The runner creates fresh homes for task state while borrowing installed dependencies and existing provider access; it does not copy a general user workspace into a task.

`npm start` installs locked application dependencies if needed, starts PostgreSQL through Compose, builds Vue and serves the API/UI. Open the printed local URL. Creating a draft makes no model calls; explicitly starting it does. Only one live worker may own a database schema. Use a separate database/schema for independent CLI experiment workers.

`npm run verify:hermes` performs a real provider-backed integration probe; it is not a free health check. A successful startup alone does not verify credentials, model availability or account quota. Provider HTTP 429 stays an infrastructure error and must not be reported as an agent pass or failure.

Fresh setup verification in this submission proves credential-free review, application dependency installation, the production UI/API, and live draft/cancel behavior. It does not claim to install an external provider account or reproduce Hermes inference on a clean machine. The real inference exports separately record the installed runtime pin and observed tool behavior.

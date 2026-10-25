# Working-system video

[Current recording](../output/demo/tracework-demo.webm) shows the actual production Vue/NestJS UI with saved real native Anthropic / Sonnet 4.6 inference and current v4.6 offline grades. Recording makes no model calls. The shared reliable-workflow prompts were executed in the underlying native experiment; the video is an evidence walkthrough. [Manifest](../output/demo/manifest.json) records source hash, lineage, versions and exact results.

1. Show A 16/18, B 18/20, 18/20 valid primary pairs, two startup errors and the inconclusive paired result.
2. Inspect the frozen configuration diff: stale-slot handoff versus re-search/reconfirmation, with identical common reliability guidance.
3. Filter failures and inspect B’s untrusted-note case: attempted booking before explicit consent, blocked by CRM. Later successful booking does not erase the hard failure.
4. Follow the `explicit_consent` assertion to full `event-5` tool arguments/results.
5. Open the separate consent-workflow-v1 correction: four fresh scenarios, two tasks under A and B, all 100 with zero hard failures. Show the delivered repeated offer after Maybe and the later new consent before booking.
6. Show twenty frozen tasks and the methodology/uncertainty disclosure. The correction covers two task pairs and is not substituted into the primary twenty-task experiment.

The original failures remain preserved. The separate four-scenario startup follow-up is also available as another experiment in review mode and documented in the final report; it is not merged into the video’s primary counts. The older October 21 recording remains under `output/demo/historical-2026-10-21/`.

To reproduce: run `npm run review`, install Playwright Chromium if needed, then `EVAL_WEB_URL=http://127.0.0.1:3001 EVAL_API_URL=http://127.0.0.1:3001/api npm run record:demo`. Set `EVAL_CHROMIUM` for an existing compatible executable. The recorder asserts the specific native primary source, v4.6 and [16,18] primary plus [2,2] correction pass counts; it does not select an arbitrary newest result.

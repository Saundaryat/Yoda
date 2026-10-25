# Working-system video

[Current recording](../output/demo/tracework-demo.webm) is a captioned walkthrough of the actual production UI in `npm run review` mode. It shows saved real Hermes inference with current v4.2 offline grades. It makes no model calls and does not demonstrate execution of the new reliable-workflow prompts. [Manifest](../output/demo/manifest.json) records the source hash, experiment lineage and exact results.

Sequence:

1. Show A 14/16, B 13/16 and 16/20 valid pairs; disclose eight rate limits and an inconclusive result.
2. Inspect the saved prompt difference: handoff versus re-search/reconfirmation.
3. Filter five failed grades and eight infrastructure errors.
4. Inspect B's genuine stale-slot confirmation failure, its required assertions, and the full rejected `event-16` arguments/result.
5. Show all twenty tasks and the methodology/limitations screen.

The source experiment is `b4df0b6e-35ff-4db2-a7ec-1de92db49f46`. Review-copy database IDs differ from original execution IDs; the UI and manifest expose source lineage. The earlier [October 21 recording](../output/demo/historical-2026-10-21/tracework-demo.webm) is preserved separately.

To reproduce: run `npm run review`, install a Playwright Chromium with `npx playwright install chromium` if needed, then run `EVAL_WEB_URL=http://127.0.0.1:3001 EVAL_API_URL=http://127.0.0.1:3001/api npm run record:demo`. Set `EVAL_CHROMIUM` for an existing compatible executable. The recorder asserts the intended source experiment, v4.2 version and [14,13] pass counts before recording; it does not select an arbitrary newest result.

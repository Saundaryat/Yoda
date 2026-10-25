ALTER TABLE "check_results" ADD COLUMN IF NOT EXISTS "skipped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "check_results" ADD COLUMN IF NOT EXISTS "informational" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "check_results" AS c SET "informational" = true
FROM "runs" AS r WHERE c.run_id = r.id
AND c.check_id IN ('reply-audience', 'reply-format') AND r.judge ? 'replyQuality';--> statement-breakpoint
UPDATE "check_results" AS c SET "skipped" = true
FROM "runs" AS r WHERE c.run_id = r.id AND r.judge IS NULL
AND c.type IN ('llm_judge', 'reply_judge');

UPDATE "check_results" SET "skipped" = true WHERE "detail" LIKE 'Not judged:%';

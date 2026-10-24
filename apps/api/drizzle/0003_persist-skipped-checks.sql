ALTER TABLE "check_results" ADD COLUMN "skipped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "check_results"
SET "skipped" = true
WHERE "detail" LIKE 'Not judged:%';

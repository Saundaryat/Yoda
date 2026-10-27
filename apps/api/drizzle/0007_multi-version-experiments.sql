ALTER TABLE "experiments" ADD COLUMN "config_ids" uuid[];--> statement-breakpoint
UPDATE "experiments" SET "config_ids" = ARRAY["baseline_config_id", "candidate_config_id"] WHERE "config_ids" IS NULL;

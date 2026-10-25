ALTER TABLE "configurations" ADD COLUMN "skill_contents" jsonb;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "execution_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "phase_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "conversation" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "runs_experiment_task_config_repetition_unique" ON "runs" USING btree ("experiment_id","task_id","config_id","repetition");
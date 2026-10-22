CREATE TABLE "check_results" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"check_id" text NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"weight" real NOT NULL,
	"critical" boolean NOT NULL,
	"passed" boolean NOT NULL,
	"detail" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"spec" jsonb NOT NULL,
	"spec_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"hypothesis" text DEFAULT '' NOT NULL,
	"baseline_config_id" uuid NOT NULL,
	"candidate_config_id" uuid NOT NULL,
	"task_ids" uuid[] NOT NULL,
	"repetitions" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"analysis" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"session" integer NOT NULL,
	"turn" integer NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"config_id" uuid NOT NULL,
	"repetition" integer NOT NULL,
	"position" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"attempt_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_kind" text,
	"error_detail" text,
	"passed" boolean,
	"score" real,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" real,
	"cost_status" text,
	"duration_ms" integer,
	"session_ids" text[] DEFAULT '{}' NOT NULL,
	"crm_initial" jsonb,
	"crm_final" jsonb,
	"context" jsonb,
	"lead_fallbacks" integer,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite" text NOT NULL,
	"key" text NOT NULL,
	"version_hash" text NOT NULL,
	"split" text NOT NULL,
	"family" text NOT NULL,
	"title" text NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_baseline_config_id_configurations_id_fk" FOREIGN KEY ("baseline_config_id") REFERENCES "configurations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_candidate_config_id_configurations_id_fk" FOREIGN KEY ("candidate_config_id") REFERENCES "configurations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "experiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_config_id_configurations_id_fk" FOREIGN KEY ("config_id") REFERENCES "configurations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_results_run_id_index" ON "check_results" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_run_id_seq_index" ON "run_events" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "runs_status_position_index" ON "runs" USING btree ("status","position");--> statement-breakpoint
CREATE INDEX "runs_experiment_id_index" ON "runs" USING btree ("experiment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_suite_key_version_hash_index" ON "tasks" USING btree ("suite","key","version_hash");
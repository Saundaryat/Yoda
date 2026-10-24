ALTER TABLE "experiments" ADD COLUMN "lead_mode" text DEFAULT 'scripted' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "lead_cost_usd" real;
CREATE TABLE "verification_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"patch_attempt_id" uuid NOT NULL,
	"status" text NOT NULL,
	"failure_category" text,
	"failure_reason" text,
	"manifest_version" text,
	"manifest" jsonb,
	"sandbox_provider" text,
	"sandbox_runtime" text,
	"node_version" text,
	"node_version_source" text,
	"package_manager" text,
	"result_summary" jsonb,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "verification_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"verification_run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"kind" text NOT NULL,
	"command" text NOT NULL,
	"status" text NOT NULL,
	"exit_code" integer,
	"timed_out" boolean DEFAULT false NOT NULL,
	"duration_ms" integer,
	"stdout_excerpt" text,
	"stderr_excerpt" text,
	"truncated" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_patch_attempt_id_patch_attempts_id_fk" FOREIGN KEY ("patch_attempt_id") REFERENCES "public"."patch_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_steps" ADD CONSTRAINT "verification_steps_verification_run_id_verification_runs_id_fk" FOREIGN KEY ("verification_run_id") REFERENCES "public"."verification_runs"("id") ON DELETE cascade ON UPDATE no action;
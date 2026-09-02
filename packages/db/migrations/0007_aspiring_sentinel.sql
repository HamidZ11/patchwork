CREATE TABLE "pull_request_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"patch_attempt_id" uuid NOT NULL,
	"verification_run_id" uuid NOT NULL,
	"status" text NOT NULL,
	"failure_category" text,
	"failure_reason" text,
	"base_commit_sha" text,
	"branch_name" text,
	"commit_sha" text,
	"github_pr_number" integer,
	"github_pr_url" text,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pull_request_attempts" ADD CONSTRAINT "pull_request_attempts_patch_attempt_id_patch_attempts_id_fk" FOREIGN KEY ("patch_attempt_id") REFERENCES "public"."patch_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_attempts" ADD CONSTRAINT "pull_request_attempts_verification_run_id_verification_runs_id_fk" FOREIGN KEY ("verification_run_id") REFERENCES "public"."verification_runs"("id") ON DELETE restrict ON UPDATE no action;
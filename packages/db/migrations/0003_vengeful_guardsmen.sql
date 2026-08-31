CREATE TABLE "analysis_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"analysis_run_id" uuid NOT NULL,
	"schema_version" integer NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_evidence_analysis_run_id_unique" UNIQUE("analysis_run_id")
);
--> statement-breakpoint
ALTER TABLE "analysis_evidence" ADD CONSTRAINT "analysis_evidence_analysis_run_id_analysis_runs_id_fk" FOREIGN KEY ("analysis_run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE cascade ON UPDATE no action;
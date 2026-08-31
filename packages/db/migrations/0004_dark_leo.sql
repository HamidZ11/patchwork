CREATE TABLE "impact_assessments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"analysis_run_id" uuid NOT NULL,
	"rule_version_id" uuid NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"coverage" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "impact_findings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"impact_assessment_id" uuid NOT NULL,
	"workspace_path" text NOT NULL,
	"source_file" text NOT NULL,
	"line" integer NOT NULL,
	"matched_symbol" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"source_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_change_id" uuid NOT NULL,
	"version" text NOT NULL,
	"predicate_kind" text NOT NULL,
	"migration_requirement" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "impact_assessments" ADD CONSTRAINT "impact_assessments_analysis_run_id_analysis_runs_id_fk" FOREIGN KEY ("analysis_run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impact_assessments" ADD CONSTRAINT "impact_assessments_rule_version_id_rule_versions_id_fk" FOREIGN KEY ("rule_version_id") REFERENCES "public"."rule_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impact_findings" ADD CONSTRAINT "impact_findings_impact_assessment_id_impact_assessments_id_fk" FOREIGN KEY ("impact_assessment_id") REFERENCES "public"."impact_assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_versions" ADD CONSTRAINT "rule_versions_provider_change_id_provider_changes_id_fk" FOREIGN KEY ("provider_change_id") REFERENCES "public"."provider_changes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "impact_assessments_run_rule_idx" ON "impact_assessments" USING btree ("analysis_run_id","rule_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_changes_external_id_idx" ON "provider_changes" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_versions_change_version_idx" ON "rule_versions" USING btree ("provider_change_id","version");
CREATE TABLE "patch_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"impact_assessment_id" uuid NOT NULL,
	"transformation_kind" text NOT NULL,
	"transformation_version" text NOT NULL,
	"status" text NOT NULL,
	"refusal_reason" text,
	"failure_reason" text,
	"changed_files" text[] DEFAULT '{}' NOT NULL,
	"diff" text,
	"postcondition_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "patch_attempts" ADD CONSTRAINT "patch_attempts_impact_assessment_id_impact_assessments_id_fk" FOREIGN KEY ("impact_assessment_id") REFERENCES "public"."impact_assessments"("id") ON DELETE cascade ON UPDATE no action;
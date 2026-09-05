CREATE TABLE "impact_explanations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"impact_assessment_id" uuid NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"context_hash" text NOT NULL,
	"explanation" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "impact_explanations" ADD CONSTRAINT "impact_explanations_impact_assessment_id_impact_assessments_id_fk" FOREIGN KEY ("impact_assessment_id") REFERENCES "public"."impact_assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "impact_explanations_cache_idx" ON "impact_explanations" USING btree ("impact_assessment_id","prompt_version","model","context_hash");
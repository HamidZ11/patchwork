import { and, desc, eq } from 'drizzle-orm';
import { schema, type Database } from '@patchwork/db';
import { impactCoverageSchema } from '../analysis/impact/types.js';
import { stripeEvidenceSchema } from '../analysis/evidence/types.js';
import type { ExplanationContextSource } from './context.js';

/**
 * The persisted half of the explanation context. `remediationSupported` is
 * deliberately absent: whether a predicate kind has a deterministic recipe is
 * a registry fact, not a database one, so the route resolves it and this
 * module stays a pure read of stored state.
 */
export type PersistedExplanationSource = Omit<ExplanationContextSource, 'remediationSupported'> & {
  predicateKind: string;
};
import { explanationSchema, type Explanation } from './types.js';

/**
 * Everything the explanation context needs about one assessment, scoped to
 * installations the given user connected -- the same ownership join
 * getImpactAssessmentForUser uses, so a foreign or unknown assessment id
 * returns null and the route 404s without ever confirming it exists.
 *
 * Returns only persisted, already-derived facts. No archive, no source file
 * contents, no credentials: the joins reach evidence, coverage, findings and
 * downstream state, and nothing else.
 */
export async function getAssessmentForExplanation(
  db: Database,
  userId: string,
  impactAssessmentId: string,
): Promise<PersistedExplanationSource | null> {
  const [row] = await db
    .select({
      id: schema.impactAssessments.id,
      status: schema.impactAssessments.status,
      coverage: schema.impactAssessments.coverage,
      predicateKind: schema.ruleVersions.predicateKind,
      migrationRequirement: schema.ruleVersions.migrationRequirement,
      providerChangeTitle: schema.providerChanges.title,
      providerChangeSourceUrl: schema.providerChanges.sourceUrl,
      evidence: schema.analysisEvidence.evidence,
    })
    .from(schema.impactAssessments)
    .innerJoin(
      schema.ruleVersions,
      eq(schema.impactAssessments.ruleVersionId, schema.ruleVersions.id),
    )
    .innerJoin(
      schema.providerChanges,
      eq(schema.ruleVersions.providerChangeId, schema.providerChanges.id),
    )
    .innerJoin(
      schema.analysisRuns,
      eq(schema.impactAssessments.analysisRunId, schema.analysisRuns.id),
    )
    .innerJoin(
      schema.repositorySnapshots,
      eq(schema.analysisRuns.repositorySnapshotId, schema.repositorySnapshots.id),
    )
    .innerJoin(
      schema.repositories,
      eq(schema.repositorySnapshots.repositoryId, schema.repositories.id),
    )
    .innerJoin(
      schema.githubInstallations,
      eq(schema.repositories.installationId, schema.githubInstallations.id),
    )
    .leftJoin(
      schema.analysisEvidence,
      eq(schema.analysisEvidence.analysisRunId, schema.analysisRuns.id),
    )
    .where(
      and(
        eq(schema.impactAssessments.id, impactAssessmentId),
        eq(schema.githubInstallations.connectedByUserId, userId),
      ),
    )
    .limit(1);

  if (!row) return null;

  const findingRows = await db
    .select({
      sourceFile: schema.impactFindings.sourceFile,
      line: schema.impactFindings.line,
      matchedSymbol: schema.impactFindings.matchedSymbol,
    })
    .from(schema.impactFindings)
    .where(eq(schema.impactFindings.impactAssessmentId, impactAssessmentId));

  const [latestAttempt] = await db
    .select({ id: schema.patchAttempts.id, status: schema.patchAttempts.status })
    .from(schema.patchAttempts)
    .where(eq(schema.patchAttempts.impactAssessmentId, impactAssessmentId))
    .orderBy(desc(schema.patchAttempts.createdAt))
    .limit(1);

  let latestVerificationStatus: string | null = null;
  let verificationSteps: { kind: string; status: string; notRun: boolean }[] = [];
  let pullRequest: { exists: boolean; status: string | null } = { exists: false, status: null };

  if (latestAttempt) {
    const [verificationRun] = await db
      .select({ id: schema.verificationRuns.id, status: schema.verificationRuns.status })
      .from(schema.verificationRuns)
      .where(eq(schema.verificationRuns.patchAttemptId, latestAttempt.id))
      .orderBy(desc(schema.verificationRuns.createdAt))
      .limit(1);

    if (verificationRun) {
      latestVerificationStatus = verificationRun.status;
      const stepRows = await db
        .select({
          kind: schema.verificationSteps.kind,
          status: schema.verificationSteps.status,
        })
        .from(schema.verificationSteps)
        .where(eq(schema.verificationSteps.verificationRunId, verificationRun.id))
        .orderBy(schema.verificationSteps.sequence);
      // `SKIPPED` is the persisted marker for a canonical step the run never
      // executed. Flagged explicitly so the model cannot read a step's mere
      // presence as evidence that it ran.
      verificationSteps = stepRows.map((step) => ({
        kind: step.kind,
        status: step.status,
        notRun: step.status === 'SKIPPED',
      }));
    }

    const [prAttempt] = await db
      .select({ status: schema.pullRequestAttempts.status })
      .from(schema.pullRequestAttempts)
      .where(eq(schema.pullRequestAttempts.patchAttemptId, latestAttempt.id))
      .orderBy(desc(schema.pullRequestAttempts.createdAt))
      .limit(1);
    if (prAttempt) {
      pullRequest = { exists: prAttempt.status === 'OPENED', status: prAttempt.status };
    }
  }

  const parsedCoverage = impactCoverageSchema.safeParse(row.coverage);
  const parsedEvidence = stripeEvidenceSchema.safeParse(row.evidence);

  return {
    status: row.status,
    providerChangeTitle: row.providerChangeTitle,
    providerChangeSourceUrl: row.providerChangeSourceUrl,
    migrationRequirement: row.migrationRequirement,
    predicateKind: row.predicateKind,
    coverage: parsedCoverage.success
      ? {
          workspaces: parsedCoverage.data.workspaces.map((workspace) => ({
            workspacePath: workspace.workspacePath,
            applicability: workspace.applicability,
            applicabilityReason: workspace.applicabilityReason,
          })),
        }
      : null,
    installedSdks: parsedEvidence.success
      ? parsedEvidence.data.installedSdks.map((sdk) => ({
          workspacePath: sdk.workspacePath,
          declaredRange: sdk.declaredRange,
          resolvedVersion: sdk.resolvedVersion,
        }))
      : [],
    findings: findingRows,
    latestPatchAttemptStatus: latestAttempt?.status ?? null,
    latestVerificationStatus,
    verificationSteps,
    pullRequest,
  };
}

/** Looks up a previously generated explanation for the exact cache identity:
 * assessment + prompt version + model + the hash of the facts it was written
 * from. A miss on any one of the four is a real miss, not a stale hit. */
export async function findCachedExplanation(
  db: Database,
  params: {
    impactAssessmentId: string;
    promptVersion: string;
    model: string;
    contextHash: string;
  },
): Promise<Explanation | null> {
  const [row] = await db
    .select({ explanation: schema.impactExplanations.explanation })
    .from(schema.impactExplanations)
    .where(
      and(
        eq(schema.impactExplanations.impactAssessmentId, params.impactAssessmentId),
        eq(schema.impactExplanations.promptVersion, params.promptVersion),
        eq(schema.impactExplanations.model, params.model),
        eq(schema.impactExplanations.contextHash, params.contextHash),
      ),
    )
    .limit(1);

  if (!row) return null;

  // A persisted row is still validated on read: a schema change should
  // surface as a cache miss and a fresh generation, never as unvalidated
  // JSON rendered into the product.
  const parsed = explanationSchema.safeParse(row.explanation);
  return parsed.success ? parsed.data : null;
}

/** Persists a generated explanation. `onConflictDoNothing` on the cache
 * identity makes two concurrent requests for the same assessment converge on
 * one row instead of racing to insert duplicates. */
export async function saveExplanation(
  db: Database,
  params: {
    impactAssessmentId: string;
    promptVersion: string;
    model: string;
    contextHash: string;
    explanation: Explanation;
  },
): Promise<void> {
  await db
    .insert(schema.impactExplanations)
    .values({
      impactAssessmentId: params.impactAssessmentId,
      promptVersion: params.promptVersion,
      model: params.model,
      contextHash: params.contextHash,
      explanation: params.explanation,
    })
    .onConflictDoNothing();
}

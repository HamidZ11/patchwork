import { and, eq, inArray } from 'drizzle-orm';
import { schema, type Database } from '@patchwork/db';
import type { StripeEvidence } from './evidence/types.js';
import type {
  Finding,
  ImpactAssessmentResult,
  ImpactCoverage,
  ProviderChangeDefinition,
} from './impact/types.js';

export interface AnalysisRunForImpactAssessment {
  id: string;
  status: string;
  repositoryOwner: string;
  repositoryName: string;
  githubInstallationId: number;
  commitSha: string;
  evidence: StripeEvidence | null;
}

/**
 * Looks up an AnalysisRun by id, scoped to installations the given user
 * connected -- mirrors getRepositoryForUser's join-and-scope-by-owner.
 * Returns null (never throws) if the run doesn't exist OR its repository
 * belongs to someone else's installation, so a run id's existence is
 * never leaked to a non-owner. Also carries the run's persisted
 * StripeEvidence (null if the run never produced any, e.g. status
 * 'failed') and enough repository identity to re-download its archive.
 */
export async function getAnalysisRunForUser(
  db: Database,
  userId: string,
  analysisRunId: string,
): Promise<AnalysisRunForImpactAssessment | null> {
  const [row] = await db
    .select({
      id: schema.analysisRuns.id,
      status: schema.analysisRuns.status,
      repositoryOwner: schema.repositories.owner,
      repositoryName: schema.repositories.name,
      githubInstallationId: schema.githubInstallations.githubInstallationId,
      commitSha: schema.repositorySnapshots.commitSha,
      evidence: schema.analysisEvidence.evidence,
    })
    .from(schema.analysisRuns)
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
        eq(schema.analysisRuns.id, analysisRunId),
        eq(schema.githubInstallations.connectedByUserId, userId),
      ),
    )
    .limit(1);

  if (!row) return null;
  return { ...row, evidence: (row.evidence as StripeEvidence | null) ?? null };
}

export interface AssessmentDetail {
  id: string;
  status: string;
  reason: string;
  coverage: ImpactCoverage;
  findings: Finding[];
  providerChangeTitle: string;
  providerChangeSourceUrl: string;
  migrationRequirement: string;
}

export interface AnalysisRunDetail {
  id: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  repositoryFullName: string;
  commitSha: string;
  evidence: StripeEvidence | null;
  assessments: AssessmentDetail[];
}

/**
 * Full detail for one AnalysisRun, for the impact-detail page -- the
 * read-only counterpart to triggering an assessment. Same ownership
 * join/scoping as getAnalysisRunForUser (never leaks a run id's
 * existence to a non-owner), extended with every persisted
 * ImpactAssessment for the run: status, reason, the full per-workspace
 * `coverage` breakdown (already collected and persisted, never returned
 * by any route until now), findings, and each rule's ProviderChange/
 * RuleVersion identity -- everything the UI needs to explain *why* a
 * verdict landed where it did, not just what the verdict was.
 */
export async function getAnalysisRunDetail(
  db: Database,
  userId: string,
  analysisRunId: string,
): Promise<AnalysisRunDetail | null> {
  const [run] = await db
    .select({
      id: schema.analysisRuns.id,
      status: schema.analysisRuns.status,
      startedAt: schema.analysisRuns.startedAt,
      completedAt: schema.analysisRuns.completedAt,
      repositoryFullName: schema.repositories.fullName,
      commitSha: schema.repositorySnapshots.commitSha,
      evidence: schema.analysisEvidence.evidence,
    })
    .from(schema.analysisRuns)
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
        eq(schema.analysisRuns.id, analysisRunId),
        eq(schema.githubInstallations.connectedByUserId, userId),
      ),
    )
    .limit(1);

  if (!run) return null;

  const assessmentRows = await db
    .select({
      id: schema.impactAssessments.id,
      status: schema.impactAssessments.status,
      reason: schema.impactAssessments.reason,
      coverage: schema.impactAssessments.coverage,
      providerChangeTitle: schema.providerChanges.title,
      providerChangeSourceUrl: schema.providerChanges.sourceUrl,
      migrationRequirement: schema.ruleVersions.migrationRequirement,
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
    .where(eq(schema.impactAssessments.analysisRunId, analysisRunId));

  const assessmentIds = assessmentRows.map((row) => row.id);
  const findingRows = assessmentIds.length
    ? await db
        .select()
        .from(schema.impactFindings)
        .where(inArray(schema.impactFindings.impactAssessmentId, assessmentIds))
    : [];

  const findingsByAssessment = new Map<string, Finding[]>();
  for (const finding of findingRows) {
    const list = findingsByAssessment.get(finding.impactAssessmentId) ?? [];
    list.push({
      workspacePath: finding.workspacePath,
      sourceFile: finding.sourceFile,
      line: finding.line,
      matchedSymbol: finding.matchedSymbol,
    });
    findingsByAssessment.set(finding.impactAssessmentId, list);
  }

  return {
    ...run,
    evidence: (run.evidence as StripeEvidence | null) ?? null,
    assessments: assessmentRows.map((row) => ({
      id: row.id,
      status: row.status,
      reason: row.reason,
      coverage: row.coverage as ImpactCoverage,
      findings: findingsByAssessment.get(row.id) ?? [],
      providerChangeTitle: row.providerChangeTitle,
      providerChangeSourceUrl: row.providerChangeSourceUrl,
      migrationRequirement: row.migrationRequirement,
    })),
  };
}

/**
 * Idempotently upserts the one hardcoded ProviderChange + RuleVersion
 * definition -- not user-authored, run lazily before evaluating it.
 * Converges to one row per (external_id) / (provider_change_id, version)
 * on repeated calls, same onConflictDoUpdate idiom used elsewhere.
 */
export async function upsertProviderChangeAndRuleVersion(
  db: Database,
  definition: ProviderChangeDefinition,
): Promise<{ ruleVersionId: string }> {
  return db.transaction(async (tx) => {
    const [providerChange] = await tx
      .insert(schema.providerChanges)
      .values({
        provider: definition.provider,
        externalId: definition.externalId,
        title: definition.title,
        sourceUrl: definition.sourceUrl,
      })
      .onConflictDoUpdate({
        target: schema.providerChanges.externalId,
        set: { title: definition.title, sourceUrl: definition.sourceUrl },
      })
      .returning();
    if (!providerChange) throw new Error('failed to upsert provider change');

    const [ruleVersion] = await tx
      .insert(schema.ruleVersions)
      .values({
        providerChangeId: providerChange.id,
        version: definition.ruleVersion,
        predicateKind: definition.predicateKind,
        migrationRequirement: definition.migrationRequirement,
      })
      .onConflictDoUpdate({
        target: [schema.ruleVersions.providerChangeId, schema.ruleVersions.version],
        set: {
          predicateKind: definition.predicateKind,
          migrationRequirement: definition.migrationRequirement,
        },
      })
      .returning();
    if (!ruleVersion) throw new Error('failed to upsert rule version');

    return { ruleVersionId: ruleVersion.id };
  });
}

export interface PersistedImpactAssessment {
  id: string;
  status: string;
  reason: string;
  findings: Finding[];
}

/**
 * Upserts one ImpactAssessment on (analysis_run_id, rule_version_id) --
 * an assessment is a pure function of two already-immutable inputs (an
 * AnalysisRun's underlying RepositorySnapshot, and a versioned
 * RuleVersion), so re-evaluating the identical pair converges to one row
 * rather than accumulating duplicates (unlike AnalysisRun itself, an
 * execution/audit log deliberately not deduplicated). Findings are
 * replaced wholesale on re-evaluation, not diffed.
 */
export async function upsertImpactAssessment(
  db: Database,
  params: { analysisRunId: string; ruleVersionId: string; result: ImpactAssessmentResult },
): Promise<PersistedImpactAssessment> {
  return db.transaction(async (tx) => {
    const [assessment] = await tx
      .insert(schema.impactAssessments)
      .values({
        analysisRunId: params.analysisRunId,
        ruleVersionId: params.ruleVersionId,
        status: params.result.status,
        reason: params.result.reason,
        coverage: params.result.coverage,
      })
      .onConflictDoUpdate({
        target: [schema.impactAssessments.analysisRunId, schema.impactAssessments.ruleVersionId],
        set: {
          status: params.result.status,
          reason: params.result.reason,
          coverage: params.result.coverage,
        },
      })
      .returning();
    if (!assessment) throw new Error('failed to upsert impact assessment');

    await tx
      .delete(schema.impactFindings)
      .where(eq(schema.impactFindings.impactAssessmentId, assessment.id));

    if (params.result.findings.length > 0) {
      await tx.insert(schema.impactFindings).values(
        params.result.findings.map((finding) => ({
          impactAssessmentId: assessment.id,
          workspacePath: finding.workspacePath,
          sourceFile: finding.sourceFile,
          line: finding.line,
          matchedSymbol: finding.matchedSymbol,
        })),
      );
    }

    return {
      id: assessment.id,
      status: assessment.status,
      reason: assessment.reason,
      findings: params.result.findings,
    };
  });
}

export interface LatestImpactAssessmentSummary {
  providerChangeTitle: string;
  status: string;
  reason: string;
  findings: Finding[];
}

/**
 * Impact assessments for a set of AnalysisRuns, keyed by analysis_run_id.
 * Multiple rules can now exist, so each run may have several assessments
 * (one per rule) -- (analysis_run_id, rule_version_id) uniqueness still
 * guarantees at most one assessment per (run, rule) pair, but not per run.
 */
export async function getImpactAssessmentsForAnalysisRuns(
  db: Database,
  analysisRunIds: string[],
): Promise<Map<string, LatestImpactAssessmentSummary[]>> {
  if (analysisRunIds.length === 0) return new Map();

  const assessmentRows = await db
    .select({
      id: schema.impactAssessments.id,
      analysisRunId: schema.impactAssessments.analysisRunId,
      status: schema.impactAssessments.status,
      reason: schema.impactAssessments.reason,
      providerChangeTitle: schema.providerChanges.title,
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
    .where(inArray(schema.impactAssessments.analysisRunId, analysisRunIds));

  const assessmentIds = assessmentRows.map((row) => row.id);
  const findingRows = assessmentIds.length
    ? await db
        .select()
        .from(schema.impactFindings)
        .where(inArray(schema.impactFindings.impactAssessmentId, assessmentIds))
    : [];

  const findingsByAssessment = new Map<string, Finding[]>();
  for (const finding of findingRows) {
    const list = findingsByAssessment.get(finding.impactAssessmentId) ?? [];
    list.push({
      workspacePath: finding.workspacePath,
      sourceFile: finding.sourceFile,
      line: finding.line,
      matchedSymbol: finding.matchedSymbol,
    });
    findingsByAssessment.set(finding.impactAssessmentId, list);
  }

  const result = new Map<string, LatestImpactAssessmentSummary[]>();
  for (const row of assessmentRows) {
    const list = result.get(row.analysisRunId) ?? [];
    list.push({
      providerChangeTitle: row.providerChangeTitle,
      status: row.status,
      reason: row.reason,
      findings: findingsByAssessment.get(row.id) ?? [],
    });
    result.set(row.analysisRunId, list);
  }
  return result;
}

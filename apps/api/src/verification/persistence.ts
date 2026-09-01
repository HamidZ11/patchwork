import { desc, inArray } from 'drizzle-orm';
import { schema, type Database } from '@patchwork/db';

export interface VerificationStepSummary {
  sequence: number;
  kind: string;
  command: string;
  status: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number | null;
  stdoutExcerpt: string | null;
  stderrExcerpt: string | null;
  truncated: boolean;
}

export interface VerificationRunSummary {
  id: string;
  patchAttemptId: string;
  status: string;
  failureCategory: string | null;
  failureReason: string | null;
  manifestVersion: string | null;
  sandboxProvider: string | null;
  sandboxRuntime: string | null;
  nodeVersion: string | null;
  nodeVersionSource: string | null;
  packageManager: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  steps: VerificationStepSummary[];
}

/**
 * Every VerificationRun (with its steps) for a set of PatchAttempts,
 * most-recent-first per attempt -- read-only counterpart to
 * apps/worker's own persistence.ts, used by the impact-detail page to
 * show runtime-verification evidence alongside each PatchAttempt.
 * Ownership is already enforced by the caller (getAnalysisRunDetail
 * scopes patchAttemptIds to the requesting user's own analysis run
 * before this is ever called), so no ownership join is repeated here --
 * same trust boundary as getPatchAttemptsForAssessments.
 */
export async function getVerificationRunsForPatchAttempts(
  db: Database,
  patchAttemptIds: string[],
): Promise<Map<string, VerificationRunSummary[]>> {
  const result = new Map<string, VerificationRunSummary[]>();
  if (patchAttemptIds.length === 0) return result;

  const runRows = await db
    .select()
    .from(schema.verificationRuns)
    .where(inArray(schema.verificationRuns.patchAttemptId, patchAttemptIds))
    .orderBy(desc(schema.verificationRuns.createdAt));

  const runIds = runRows.map((row) => row.id);
  const stepRows = runIds.length
    ? await db
        .select()
        .from(schema.verificationSteps)
        .where(inArray(schema.verificationSteps.verificationRunId, runIds))
        .orderBy(schema.verificationSteps.sequence)
    : [];

  const stepsByRun = new Map<string, VerificationStepSummary[]>();
  for (const step of stepRows) {
    const list = stepsByRun.get(step.verificationRunId) ?? [];
    list.push({
      sequence: step.sequence,
      kind: step.kind,
      command: step.command,
      status: step.status,
      exitCode: step.exitCode,
      timedOut: step.timedOut,
      durationMs: step.durationMs,
      stdoutExcerpt: step.stdoutExcerpt,
      stderrExcerpt: step.stderrExcerpt,
      truncated: step.truncated,
    });
    stepsByRun.set(step.verificationRunId, list);
  }

  for (const run of runRows) {
    const list = result.get(run.patchAttemptId) ?? [];
    list.push({
      id: run.id,
      patchAttemptId: run.patchAttemptId,
      status: run.status,
      failureCategory: run.failureCategory,
      failureReason: run.failureReason,
      manifestVersion: run.manifestVersion,
      sandboxProvider: run.sandboxProvider,
      sandboxRuntime: run.sandboxRuntime,
      nodeVersion: run.nodeVersion,
      nodeVersionSource: run.nodeVersionSource,
      packageManager: run.packageManager,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      steps: stepsByRun.get(run.id) ?? [],
    });
    result.set(run.patchAttemptId, list);
  }
  return result;
}

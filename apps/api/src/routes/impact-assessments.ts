import type { FastifyInstance } from 'fastify';
import type { Database } from '@patchwork/db';
import type { GitHubAppAuth, GitHubClient } from '@patchwork/github';
import { assessAllRulesImpact } from '../analysis/impact.js';
import {
  getAnalysisRunDetail,
  getAnalysisRunForUser,
  upsertImpactAssessment,
  upsertProviderChangeAndRuleVersion,
} from '../analysis/impact-persistence.js';
import { getPullRequestAttemptsForPatchAttempts } from '../pull-requests/persistence.js';
import { requireAuth } from '../plugins/session.js';
import { getPatchAttemptsForAssessments } from '../remediation/persistence.js';
import { findRecipeForPredicateKind } from '../remediation/registry.js';
import { getVerificationRunsForPatchAttempts } from '../verification/persistence.js';

export interface ImpactAssessmentsRoutesDeps {
  db: Database;
  githubClient: GitHubClient;
  githubAppAuth: GitHubAppAuth;
}

/**
 * Evaluates every currently-known RuleVersion (see analysis/impact/
 * registry.ts) against an existing, already-authorized AnalysisRun --
 * never a new AnalysisRun, never a new archive-and-evidence collection
 * cycle. No rule-id parameter: forward-compatible without a
 * rule-selection surface. Kept separate from routes/analyses.ts, which
 * stays scoped to snapshot/evidence collection.
 */
export function registerImpactAssessmentsRoutes(
  app: FastifyInstance,
  deps: ImpactAssessmentsRoutesDeps,
): void {
  app.post<{ Params: { id: string } }>(
    '/analysis-runs/:id/impact-assessments',
    { preHandler: requireAuth },
    async (request, reply) => {
      const run = await getAnalysisRunForUser(deps.db, request.user!.id, request.params.id);
      if (!run) {
        return reply.status(404).send({ error: 'Not Found', message: 'Analysis run not found.' });
      }
      if (!run.evidence) {
        return reply.status(409).send({
          error: 'Conflict',
          message:
            'This analysis run has no evidence to assess (it did not complete successfully).',
        });
      }

      let ruleAssessments;
      try {
        // owner/name/commitSha/installationId all come from our own
        // stored, authorized record -- never from caller input.
        ruleAssessments = await assessAllRulesImpact(
          {
            owner: run.repositoryOwner,
            name: run.repositoryName,
            commitSha: run.commitSha,
            githubInstallationId: run.githubInstallationId,
          },
          run.evidence,
          { client: deps.githubClient, appAuth: deps.githubAppAuth },
        );
      } catch (error) {
        // No assessment is persisted on an infrastructure failure -- an
        // ImpactAssessment should always represent a completed evaluation
        // with genuine evidence-based reasoning, not a transient error.
        request.log.error({ err: error }, 'failed to assess stripe rule impact');
        return reply.status(502).send({
          error: 'Bad Gateway',
          message: 'Could not re-acquire the repository archive to evaluate these changes.',
        });
      }

      const responseAssessments = [];
      for (const { rule, result } of ruleAssessments) {
        const { ruleVersionId } = await upsertProviderChangeAndRuleVersion(
          deps.db,
          rule.providerChange,
        );
        const assessment = await upsertImpactAssessment(deps.db, {
          analysisRunId: run.id,
          ruleVersionId,
          result,
        });
        responseAssessments.push({
          id: assessment.id,
          providerChange: {
            provider: rule.providerChange.provider,
            title: rule.providerChange.title,
            sourceUrl: rule.providerChange.sourceUrl,
          },
          status: assessment.status,
          reason: assessment.reason,
          findings: assessment.findings,
        });
      }

      return reply.status(201).send({ impactAssessments: responseAssessments });
    },
  );

  /**
   * Read-only counterpart to the trigger route above: full detail for an
   * already-evaluated AnalysisRun, for the impact-detail page. Never
   * triggers a new evaluation or archive download -- only returns what's
   * already persisted, including the per-workspace `coverage` breakdown
   * no other route exposes.
   */
  app.get<{ Params: { id: string } }>(
    '/analysis-runs/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const run = await getAnalysisRunDetail(deps.db, request.user!.id, request.params.id);
      if (!run) {
        return reply.status(404).send({ error: 'Not Found', message: 'Analysis run not found.' });
      }

      const patchAttemptsByAssessment = await getPatchAttemptsForAssessments(
        deps.db,
        run.assessments.map((assessment) => assessment.id),
      );
      const allPatchAttemptIds = [...patchAttemptsByAssessment.values()].flatMap((attempts) =>
        attempts.map((attempt) => attempt.id),
      );
      const verificationRunsByPatchAttempt = await getVerificationRunsForPatchAttempts(
        deps.db,
        allPatchAttemptIds,
      );
      const pullRequestAttemptsByPatchAttempt = await getPullRequestAttemptsForPatchAttempts(
        deps.db,
        allPatchAttemptIds,
      );

      return reply.send({
        analysisRun: {
          ...run,
          assessments: run.assessments.map((assessment) => ({
            ...assessment,
            remediationSupported:
              findRecipeForPredicateKind(assessment.predicateKind) !== undefined,
            patchAttempts: (patchAttemptsByAssessment.get(assessment.id) ?? []).map((attempt) => ({
              ...attempt,
              verificationRuns: verificationRunsByPatchAttempt.get(attempt.id) ?? [],
              pullRequestAttempts: pullRequestAttemptsByPatchAttempt.get(attempt.id) ?? [],
            })),
          })),
        },
      });
    },
  );
}

import type { FastifyInstance } from 'fastify';
import type { Database } from '@patchwork/db';
import type { GitHubAppAuth } from '../github/auth.js';
import type { GitHubClient } from '../github/client.js';
import { assessStripeBasilInvoicePreviewImpact } from '../analysis/impact.js';
import { STRIPE_BASIL_INVOICE_PREVIEW } from '../analysis/impact/stripe-basil-invoice-preview.js';
import {
  getAnalysisRunForUser,
  upsertImpactAssessment,
  upsertProviderChangeAndRuleVersion,
} from '../analysis/impact-persistence.js';
import { requireAuth } from '../plugins/session.js';

export interface ImpactAssessmentsRoutesDeps {
  db: Database;
  githubClient: GitHubClient;
  githubAppAuth: GitHubAppAuth;
}

/**
 * Evaluates every currently-known RuleVersion (today: exactly one, the
 * Stripe Basil Upcoming Invoice API removal) against an existing
 * AnalysisRun -- never a new AnalysisRun, never a new archive-and-evidence
 * collection cycle. No rule-id parameter: forward-compatible without a
 * rule-selection surface that has no real use while exactly one rule
 * exists. Kept separate from routes/analyses.ts, which stays scoped to
 * snapshot/evidence collection.
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

      let result;
      try {
        // owner/name/commitSha/installationId all come from our own
        // stored, authorized record -- never from caller input.
        result = await assessStripeBasilInvoicePreviewImpact(
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
        request.log.error({ err: error }, 'failed to assess stripe basil invoice preview impact');
        return reply.status(502).send({
          error: 'Bad Gateway',
          message: 'Could not re-acquire the repository archive to evaluate this change.',
        });
      }

      const { ruleVersionId } = await upsertProviderChangeAndRuleVersion(
        deps.db,
        STRIPE_BASIL_INVOICE_PREVIEW,
      );
      const assessment = await upsertImpactAssessment(deps.db, {
        analysisRunId: run.id,
        ruleVersionId,
        result,
      });

      return reply.status(201).send({
        impactAssessments: [
          {
            id: assessment.id,
            providerChange: {
              provider: STRIPE_BASIL_INVOICE_PREVIEW.provider,
              title: STRIPE_BASIL_INVOICE_PREVIEW.title,
              sourceUrl: STRIPE_BASIL_INVOICE_PREVIEW.sourceUrl,
            },
            status: assessment.status,
            reason: assessment.reason,
            findings: assessment.findings,
          },
        ],
      });
    },
  );
}

import type { FastifyInstance } from 'fastify';
import type { Database } from '@patchwork/db';
import { getImpactAssessmentForUser } from '../analysis/impact-persistence.js';
import type { GitHubAppAuth } from '../github/auth.js';
import type { GitHubClient } from '../github/client.js';
import { generatePatchAttempt } from '../remediation/generate.js';
import { createPatchAttempt } from '../remediation/persistence.js';
import { findRecipeForPredicateKind } from '../remediation/registry.js';
import { requireAuth } from '../plugins/session.js';

export interface PatchAttemptsRoutesDeps {
  db: Database;
  githubClient: GitHubClient;
  githubAppAuth: GitHubAppAuth;
}

/**
 * Generates and independently checks a deterministic candidate patch for
 * one ImpactAssessment -- the first (and, for this slice, only) step of
 * remediation. Every precondition is enforced here before any archive is
 * even downloaded: ownership, AFFECTED status, a supported rule. No
 * GitHub write of any kind happens anywhere in this path -- only a read
 * (the exact-SHA archive) and a persisted, inspectable PatchAttempt
 * record.
 */
export function registerPatchAttemptsRoutes(
  app: FastifyInstance,
  deps: PatchAttemptsRoutesDeps,
): void {
  app.post<{ Params: { id: string } }>(
    '/impact-assessments/:id/patch-attempts',
    { preHandler: requireAuth },
    async (request, reply) => {
      const assessment = await getImpactAssessmentForUser(
        deps.db,
        request.user!.id,
        request.params.id,
      );
      if (!assessment) {
        return reply
          .status(404)
          .send({ error: 'Not Found', message: 'Impact assessment not found.' });
      }

      const result = await generatePatchAttempt(assessment, {
        client: deps.githubClient,
        appAuth: deps.githubAppAuth,
      });

      const recipe = findRecipeForPredicateKind(assessment.predicateKind);

      const patchAttempt = await createPatchAttempt(deps.db, {
        impactAssessmentId: assessment.id,
        transformationKind: recipe?.transformationKind ?? 'unsupported',
        transformationVersion: recipe?.transformationVersion ?? 'n/a',
        result,
      });

      return reply.status(201).send({ patchAttempt });
    },
  );
}

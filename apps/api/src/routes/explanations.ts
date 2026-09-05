import type { FastifyInstance } from 'fastify';
import type { Database } from '@patchwork/db';
import { buildExplanationContext, hashExplanationContext } from '../explanations/context.js';
import { ExplanationModelError } from '../explanations/openai.js';
import {
  findCachedExplanation,
  getAssessmentForExplanation,
  saveExplanation,
} from '../explanations/persistence.js';
import { EXPLANATION_PROMPT_VERSION, type ExplanationModel } from '../explanations/types.js';
import { requireAuth } from '../plugins/session.js';
import { findRecipeForPredicateKind } from '../remediation/registry.js';

export interface ExplanationsRoutesDeps {
  db: Database;
  explanationModel: ExplanationModel;
}

/**
 * Plain-English explanation of one already-decided ImpactAssessment.
 *
 * The single most important property of this route is what it does NOT do:
 * it never writes to `impact_assessments`, never touches findings, coverage,
 * patch attempts, verification runs or pull requests, and never influences a
 * verdict. Patchwork proves; this explains. A model failure therefore cannot
 * corrupt anything -- the worst case is that no row is written and the caller
 * gets a 502 while every deterministic fact on the page stays exactly as it
 * was.
 *
 * POST rather than GET because a miss has a side effect (a generation is paid
 * for and persisted); it is nonetheless idempotent in practice, since a
 * repeat call with unchanged facts hits the cache and costs nothing.
 */
export function registerExplanationsRoutes(
  app: FastifyInstance,
  deps: ExplanationsRoutesDeps,
): void {
  app.post<{ Params: { id: string } }>(
    '/impact-assessments/:id/explanation',
    { preHandler: requireAuth },
    async (request, reply) => {
      const source = await getAssessmentForExplanation(
        deps.db,
        request.user!.id,
        request.params.id,
      );
      // Same 404 shape as every other assessment-scoped route: a foreign id
      // and an unknown id are indistinguishable to the caller.
      if (!source) {
        return reply
          .status(404)
          .send({ error: 'Not Found', message: 'Impact assessment not found.' });
      }

      // NOT_AFFECTED has no explanation in this version. Refused at the API,
      // not merely hidden in the UI, so the spend cannot be triggered by
      // calling the endpoint directly.
      if (source.status !== 'AFFECTED' && source.status !== 'UNCERTAIN') {
        return reply.status(409).send({
          error: 'Conflict',
          message: `Explanations are only generated for AFFECTED or UNCERTAIN assessments, not ${source.status}.`,
        });
      }

      const context = buildExplanationContext({
        ...source,
        remediationSupported: findRecipeForPredicateKind(source.predicateKind) !== undefined,
      });
      const contextHash = hashExplanationContext(context);
      const cacheKey = {
        impactAssessmentId: request.params.id,
        promptVersion: EXPLANATION_PROMPT_VERSION,
        model: deps.explanationModel.model,
        contextHash,
      };

      const cached = await findCachedExplanation(deps.db, cacheKey);
      if (cached) {
        return reply.send({ explanation: cached, cached: true });
      }

      let generated;
      try {
        generated = await deps.explanationModel.generate(context);
      } catch (error) {
        request.log.error({ err: error }, 'impact explanation generation failed');
        // Nothing is persisted on any failure path, so an invalid or
        // unavailable generation can never become a cache hit later.
        // A missing provider is a deployment fact, not a transient one --
        // reported as such so the UI does not invite a retry that cannot work.
        if (error instanceof ExplanationModelError && error.kind === 'not_configured') {
          return reply.status(503).send({
            error: 'Service Unavailable',
            message: 'Explanations are not enabled for this deployment.',
          });
        }
        const message =
          error instanceof ExplanationModelError && error.kind === 'invalid_output'
            ? 'The explanation could not be generated in the expected format.'
            : 'The explanation service is unavailable right now.';
        return reply.status(502).send({ error: 'Bad Gateway', message });
      }

      await saveExplanation(deps.db, { ...cacheKey, explanation: generated.explanation });

      return reply.status(201).send({ explanation: generated.explanation, cached: false });
    },
  );
}

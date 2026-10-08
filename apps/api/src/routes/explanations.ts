import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Database } from '@patchwork/db';
import { buildExplanationContext, hashExplanationContext } from '../explanations/context.js';
import { ExplanationModelError } from '../explanations/openai.js';
import {
  findCachedExplanation,
  getAssessmentForExplanation,
  saveExplanation,
} from '../explanations/persistence.js';
import {
  EXPLANATION_PROMPT_VERSION,
  FOLLOW_UP_PROMPT_VERSION,
  followUpRequestSchema,
  type ExplanationContext,
  type ExplanationModel,
} from '../explanations/types.js';
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
/**
 * The checks every explanation request passes before any model is called,
 * shared so the explanation and its follow-ups can never disagree about who
 * may ask or about what: ownership (404 for a foreign or unknown id alike),
 * the verdict gate (409 for NOT_AFFECTED), then the server-built facts.
 * Returns null after replying when a check fails.
 */
async function explainableContext(
  deps: ExplanationsRoutesDeps,
  userId: string,
  assessmentId: string,
  reply: FastifyReply,
): Promise<ExplanationContext | null> {
  const source = await getAssessmentForExplanation(deps.db, userId, assessmentId);
  // Same 404 shape as every other assessment-scoped route: a foreign id
  // and an unknown id are indistinguishable to the caller.
  if (!source) {
    await reply.status(404).send({ error: 'Not Found', message: 'Impact assessment not found.' });
    return null;
  }

  // NOT_AFFECTED has no explanation in this version. Refused at the API,
  // not merely hidden in the UI, so the spend cannot be triggered by
  // calling the endpoint directly.
  if (source.status !== 'AFFECTED' && source.status !== 'UNCERTAIN') {
    await reply.status(409).send({
      error: 'Conflict',
      message: `Explanations are only generated for AFFECTED or UNCERTAIN assessments, not ${source.status}.`,
    });
    return null;
  }

  return buildExplanationContext({
    ...source,
    remediationSupported: findRecipeForPredicateKind(source.predicateKind) !== undefined,
  });
}

/** Model failures, mapped the same way for both routes. Nothing is persisted
 * on any of these paths. A missing provider is a deployment fact, not a
 * transient one -- reported as such so the UI does not invite a retry that
 * cannot work. */
function sendModelFailure(reply: FastifyReply, error: unknown) {
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

export function registerExplanationsRoutes(
  app: FastifyInstance,
  deps: ExplanationsRoutesDeps,
): void {
  app.post<{ Params: { id: string } }>(
    '/impact-assessments/:id/explanation',
    { preHandler: requireAuth },
    async (request, reply) => {
      const context = await explainableContext(deps, request.user!.id, request.params.id, reply);
      if (!context) return reply;

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
        return sendModelFailure(reply, error);
      }

      await saveExplanation(deps.db, { ...cacheKey, explanation: generated.explanation });

      return reply.status(201).send({ explanation: generated.explanation, cached: false });
    },
  );

  /**
   * A follow-up question about the same assessment. Read-only in the same
   * way the explanation is -- and more so: the answer is returned, never
   * stored. The conversation lives in the reader's page, which sends its
   * last few turns back with each question (bounded by
   * `followUpRequestSchema`).
   *
   * The model gets the same server-built facts as the explanation, plus the
   * explanation itself when one is cached for those exact facts. The
   * caller's text only ever arrives as user turns; it cannot reach the facts.
   */
  app.post<{ Params: { id: string } }>(
    '/impact-assessments/:id/explanation/follow-ups',
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = followUpRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'A follow-up needs a question of 1-500 characters and at most 6 earlier turns.',
        });
      }

      const context = await explainableContext(deps, request.user!.id, request.params.id, reply);
      if (!context) return reply;

      const explanation = await findCachedExplanation(deps.db, {
        impactAssessmentId: request.params.id,
        promptVersion: EXPLANATION_PROMPT_VERSION,
        model: deps.explanationModel.model,
        contextHash: hashExplanationContext(context),
      });

      let result;
      try {
        result = await deps.explanationModel.answerFollowUp({
          context,
          explanation,
          history: parsed.data.history,
          question: parsed.data.question,
        });
      } catch (error) {
        request.log.error({ err: error }, 'impact follow-up generation failed');
        return sendModelFailure(reply, error);
      }

      // Usage and shape only -- never the question or the answer, which are
      // the reader's words and the model's, not operational data.
      request.log.info(
        {
          impactAssessmentId: request.params.id,
          promptVersion: FOLLOW_UP_PROMPT_VERSION,
          model: deps.explanationModel.model,
          historyTurns: parsed.data.history.length,
          inputTokens: result.usage?.inputTokens ?? null,
          outputTokens: result.usage?.outputTokens ?? null,
        },
        'impact follow-up answered',
      );

      return reply.send({ answer: result.answer });
    },
  );
}

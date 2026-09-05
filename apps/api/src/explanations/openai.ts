import OpenAI from 'openai';
import {
  explanationSchema,
  type Explanation,
  type ExplanationContext,
  type ExplanationModel,
  type ExplanationModelResult,
} from './types.js';

/**
 * The whole safety contract, stated to the model rather than hoped for.
 *
 * Patchwork proves; the model explains. Every prohibition below corresponds
 * to a claim the deterministic system owns and the model must never
 * originate -- the verdict, remediation availability, what actually ran
 * during verification, and whether a pull request exists. The prompt is not
 * the only defence (the context simply does not contain anything that would
 * let it invent a version or a file path, and the output is schema-validated
 * and length-capped), but a model that is told the boundary is far less
 * likely to walk up to it.
 */
const SYSTEM_PROMPT = `You are writing a short, plain-English explanation for a developer inside Patchwork, a tool that detects when third-party API changes affect a codebase.

Patchwork has ALREADY determined the verdict deterministically through static analysis. You are not deciding anything. You are rewriting supplied facts into clear prose.

Rules you must follow exactly:
- Use ONLY the facts in the supplied context. If a fact is not there, do not state it.
- Never invent or guess a version number, file path, line number, symbol, function name, or migration detail.
- Never infer how the repository behaves beyond what the supplied findings state.
- Do not say tests, typecheck, install, or a build ran unless the supplied verification steps say so. A step marked notRun did NOT run. A null verification status means verification has not been run at all.
- Do not say verification passed unless the supplied verification status is exactly "PASSED".
- Do not say Patchwork can fix this, or refer to an automatic or deterministic fix, unless remediation.supported is true.
- Do not say a pull request exists unless pullRequest.exists is true.
- If the verdict is UNCERTAIN, preserve that uncertainty exactly. Never translate it into "probably safe", "probably unaffected", "likely affected", "low risk", or any other lean in either direction. Patchwork could not determine applicability; say what is known and what is missing, and stop there.
- Write in second person about the reader's repository. No markdown, no bullet points, no headings, no code fences.
- Be brief. Every field is prose of at most a few sentences.

Field meanings:
- summary: 1-2 sentences. In plain English, what this change is and what Patchwork concluded.
- whyItMatters: 1-3 sentences. For AFFECTED, why this specific repository is affected, grounded in the supplied findings. For UNCERTAIN, what evidence is missing and why Patchwork will not conclude either way.
- nextStep: 1-2 sentences. What happens next, consistent with the supplied remediation, verification and pull-request state.`;

/** Hand-written rather than generated from the zod schema: it is three string
 * fields, and writing it out keeps `strict` mode's requirements
 * (`additionalProperties: false`, every key required) visible at the call
 * site instead of implied by a helper. */
const RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  name: 'impact_explanation',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      whyItMatters: { type: 'string' },
      nextStep: { type: 'string' },
    },
    required: ['summary', 'whyItMatters', 'nextStep'],
    additionalProperties: false,
  },
};

const REQUEST_TIMEOUT_MS = 30_000;

export class ExplanationModelError extends Error {
  constructor(
    message: string,
    readonly kind: 'unavailable' | 'invalid_output' | 'not_configured',
  ) {
    super(message);
    this.name = 'ExplanationModelError';
  }
}

/**
 * The real OpenAI-backed implementation of the ExplanationModel boundary.
 *
 * The API key is read from apps/api's own config and never leaves this
 * process -- it is not in the context object, not in the response, and not
 * exposed to the browser (the frontend reaches this only through a
 * server-side route).
 */
export function createOpenAIExplanationModel(params: {
  apiKey: string;
  model: string;
}): ExplanationModel {
  const client = new OpenAI({ apiKey: params.apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 });

  return {
    model: params.model,
    async generate(context: ExplanationContext): Promise<ExplanationModelResult> {
      let raw: string;
      let usage: ExplanationModelResult['usage'] = null;

      try {
        const response = await client.responses.create({
          model: params.model,
          instructions: SYSTEM_PROMPT,
          input: JSON.stringify(context),
          text: { format: RESPONSE_FORMAT },
          max_output_tokens: 500,
        });
        raw = response.output_text;
        usage = response.usage
          ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
          : null;
      } catch (error) {
        // Deliberately not surfaced verbatim: a provider error message is not
        // Patchwork's copy and may carry request detail the user should not see.
        throw new ExplanationModelError(
          error instanceof Error ? error.message : 'the explanation provider failed',
          'unavailable',
        );
      }

      return { explanation: parseExplanation(raw), usage };
    },
  };
}

/**
 * The ExplanationModel used when no OpenAI key is configured. It fails
 * immediately, distinguishably, and without a network call, so a deployment
 * that has not enabled explanations serves every other route normally and
 * reports this one honestly rather than pretending a retry might help.
 */
export function createUnconfiguredExplanationModel(): ExplanationModel {
  return {
    model: 'unconfigured',
    async generate(): Promise<ExplanationModelResult> {
      throw new ExplanationModelError('no explanation provider is configured', 'not_configured');
    },
  };
}

/**
 * Structured output is requested, never trusted. `strict` mode makes a
 * malformed shape unlikely, not impossible (a truncated response from the
 * output-token cap is still syntactically invalid JSON), and the length caps
 * in `explanationSchema` are Patchwork's own product constraint rather than
 * something the API enforces. Anything that fails here is an error, never a
 * persisted cache entry.
 */
export function parseExplanation(raw: string): Explanation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ExplanationModelError(
      'the explanation provider returned malformed JSON',
      'invalid_output',
    );
  }

  const result = explanationSchema.safeParse(parsed);
  if (!result.success) {
    throw new ExplanationModelError(
      'the explanation provider returned an unexpected shape',
      'invalid_output',
    );
  }
  return result.data;
}

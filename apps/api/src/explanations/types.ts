import { z } from 'zod';

/**
 * Bumped whenever the prompt text or the output schema changes. Part of the
 * explanation cache key, so a bump regenerates rather than serving copy
 * written under different instructions. Old rows are kept (the cache index
 * is on the full identity, not just the assessment), so a previous version's
 * generation stays auditable.
 */
export const EXPLANATION_PROMPT_VERSION = 'impact-explanation-v1';

/** Only the two verdicts an explanation is offered for. NOT_AFFECTED is
 * deliberately absent: a proven negative is already fully carried by the
 * deterministic copy, and paying a model to restate it every time is spend
 * without value. */
export const EXPLAINABLE_STATUSES = ['AFFECTED', 'UNCERTAIN'] as const;
export type ExplainableStatus = (typeof EXPLAINABLE_STATUSES)[number];

/**
 * The model's entire permitted output surface. Three short fields, no
 * markdown, no free-form essay -- the UI renders them as three labelled
 * paragraphs, so anything outside this shape has nowhere to go.
 *
 * Length caps are enforced here, not merely requested in the prompt: an
 * over-long field fails validation and is never persisted or shown.
 */
export const explanationSchema = z.object({
  summary: z.string().trim().min(1).max(400),
  whyItMatters: z.string().trim().min(1).max(700),
  nextStep: z.string().trim().min(1).max(400),
});

export type Explanation = z.infer<typeof explanationSchema>;

/**
 * Exactly what is sent to the model -- a small, server-built object of facts
 * Patchwork has already established, never repository source, never an
 * archive, never a credential. Every field is either Patchwork's own derived
 * output or a location reference (path + line + symbol) it already proved.
 */
export interface ExplanationContext {
  verdict: ExplainableStatus;
  providerChange: { title: string; sourceUrl: string };
  /** Per workspace: what Patchwork concluded about applicability and why. */
  applicability: {
    workspacePath: string;
    applicability: string;
    reason: string;
  }[];
  /** Resolved Stripe SDK evidence per workspace, or an explicit unknown. */
  installedStripeSdk: {
    workspacePath: string;
    declaredRange: string;
    resolvedVersion: string | null;
  }[];
  /** Confirmed locations, capped -- `findingsCount` carries the real total. */
  findings: { sourceFile: string; line: number; matchedSymbol: string }[];
  findingsCount: number;
  migrationRequirement: string;
  remediation: {
    /** True only when a registered deterministic recipe exists for this predicate kind. */
    supported: boolean;
    latestAttemptStatus: string | null;
  };
  verification: {
    status: string | null;
    /** `notRun` distinguishes "Patchwork synthesised this step" from "it ran". */
    steps: { kind: string; status: string; notRun: boolean }[];
  };
  pullRequest: { exists: boolean; status: string | null };
}

export interface ExplanationModelResult {
  explanation: Explanation;
  usage: ModelUsage;
}

export type ModelUsage = { inputTokens: number | null; outputTokens: number | null } | null;

/**
 * Follow-up questions about an explained assessment. Versioned like the
 * explanation prompt, though nothing is cached under it today: answers are
 * returned and not stored (the conversation lives in the reader's page).
 */
export const FOLLOW_UP_PROMPT_VERSION = 'impact-follow-up-v1';

/** Bounds on what a caller may send, enforced at the API so cost and prompt
 * size stay bounded however the endpoint is called. */
export const MAX_FOLLOW_UP_QUESTION_LENGTH = 500;
export const MAX_FOLLOW_UP_ANSWER_LENGTH = 1200;
export const MAX_FOLLOW_UP_HISTORY = 6;

/**
 * One earlier exchange, as the browser holds it. Untrusted: it is the
 * caller's own conversation, sent back each turn because nothing is stored
 * server-side. It can only shape the caller's own next answer -- it never
 * reaches the facts block, which the server builds from persisted evidence.
 */
export const followUpTurnSchema = z.object({
  question: z.string().trim().min(1).max(MAX_FOLLOW_UP_QUESTION_LENGTH),
  answer: z.string().trim().min(1).max(MAX_FOLLOW_UP_ANSWER_LENGTH),
});
export type FollowUpTurn = z.infer<typeof followUpTurnSchema>;

export const followUpRequestSchema = z.object({
  question: z.string().trim().min(1).max(MAX_FOLLOW_UP_QUESTION_LENGTH),
  history: z.array(followUpTurnSchema).max(MAX_FOLLOW_UP_HISTORY).default([]),
});

/** The model's entire permitted output for a follow-up: one capped answer. */
export const followUpAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(MAX_FOLLOW_UP_ANSWER_LENGTH),
});

export interface FollowUpInput {
  context: ExplanationContext;
  /** The explanation already shown above the conversation, when one is
   * cached for these exact facts -- server-sourced, never taken from the
   * caller. */
  explanation: Explanation | null;
  history: FollowUpTurn[];
  question: string;
}

export interface FollowUpModelResult {
  answer: string;
  usage: ModelUsage;
}

/**
 * The injectable boundary between the routes and OpenAI. A narrow interface
 * (structured in, structured out) so tests drive a fake and no automated
 * test ever reaches the network.
 */
export interface ExplanationModel {
  readonly model: string;
  generate(context: ExplanationContext): Promise<ExplanationModelResult>;
  answerFollowUp(input: FollowUpInput): Promise<FollowUpModelResult>;
}

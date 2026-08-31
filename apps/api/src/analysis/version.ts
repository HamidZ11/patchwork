/**
 * Identifies which version of Patchwork's analysis logic produced a given
 * AnalysisRun. A hardcoded, manually-bumped constant -- boring and
 * explicit, deliberately not our own git commit SHA (which changes on
 * every unrelated change, e.g. a docs edit, and so doesn't track "did the
 * analyzer change") and not package.json's version (pinned at 0.0.0, no
 * release process bumps it yet).
 *
 * v0: snapshot/run creation only, no repository content read.
 * v1: adds archive acquisition + Stripe/TypeScript applicability evidence
 * collection (analysis/evidence.ts) -- a real behavior change, not
 * cosmetic. Bump manually when this logic meaningfully changes again.
 */
export const ANALYZER_VERSION = 'v1';

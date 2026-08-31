/**
 * Identifies which version of Patchwork's snapshot/analysis-run creation
 * logic produced a given AnalysisRun. A hardcoded, manually-bumped
 * constant -- boring and explicit, deliberately not our own git commit SHA
 * (which changes on every unrelated change, e.g. a docs edit, and so
 * doesn't track "did the analyzer change") and not package.json's version
 * (pinned at 0.0.0, no release process bumps it yet).
 *
 * Today this only versions the snapshot/run-creation step itself, since no
 * real code analysis exists yet -- it exists so future AnalysisRuns are
 * versioned from day one rather than retrofitted later. Bump manually when
 * this slice's logic meaningfully changes.
 */
export const ANALYZER_VERSION = 'v0';

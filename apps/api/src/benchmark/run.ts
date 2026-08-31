import type { ExtractedFile } from '../analysis/archive.js';
import { buildStripeEvidenceFromFiles } from '../analysis/evidence.js';
import { assessRuleImpact } from '../analysis/impact/assess.js';
import { IMPACT_RULES } from '../analysis/impact/registry.js';
import type { ImpactStatus, RuleDefinition } from '../analysis/impact/types.js';
import { ALL_BENCHMARK_CASES } from './cases/index.js';
import type {
  AggregateMetrics,
  BenchmarkCase,
  BenchmarkReport,
  CaseOutcome,
  Corpus,
  HistoricalCaseDetail,
  HistoricalSummary,
  OutcomeBucket,
  RuleReport,
} from './types.js';

/**
 * Classifies one (expected, actual) status pair -- see docs/impact-
 * analysis.md's Evaluation approach for the full table this implements.
 * The false-NOT_AFFECTED and unsafe-certainty buckets are the two
 * safety-critical outcomes; every other bucket is either correct or a
 * capability gap (over-abstention), never a silent wrong answer.
 */
function classify(expected: ImpactStatus, actual: ImpactStatus): OutcomeBucket {
  if (expected === 'AFFECTED') {
    if (actual === 'AFFECTED') return 'TRUE_POSITIVE';
    if (actual === 'NOT_AFFECTED') return 'FALSE_NOT_AFFECTED_SAFETY_FAILURE';
    return 'OVER_ABSTENTION';
  }
  if (expected === 'NOT_AFFECTED') {
    if (actual === 'NOT_AFFECTED') return 'TRUE_NEGATIVE';
    if (actual === 'AFFECTED') return 'FALSE_POSITIVE';
    return 'OVER_ABSTENTION';
  }
  // expected === 'UNCERTAIN'
  if (actual === 'UNCERTAIN') return 'CORRECT_ABSTENTION';
  return 'UNSAFE_CERTAINTY';
}

function findingLocationsCorrect(
  benchmarkCase: BenchmarkCase,
  actualFindings: { sourceFile: string; line: number }[],
): boolean | null {
  const expectedLocations = benchmarkCase.expected.findingLocations;
  if (!expectedLocations) return null;

  const actualSet = new Set(actualFindings.map((f) => `${f.sourceFile}:${f.line}`));
  const expectedSet = new Set(expectedLocations.map((f) => `${f.sourceFile}:${f.line}`));
  if (actualSet.size !== expectedSet.size) return false;
  for (const key of expectedSet) if (!actualSet.has(key)) return false;
  return true;
}

interface CaseRun {
  outcome: CaseOutcome;
  detectedLocations: { sourceFile: string; line: number }[];
}

function runCase(benchmarkCase: BenchmarkCase, rule: RuleDefinition): CaseRun {
  const extractedFiles: ExtractedFile[] = Object.entries(benchmarkCase.files).map(
    ([path, content]) => ({ path, content }),
  );
  const evidence = buildStripeEvidenceFromFiles(extractedFiles, false);
  const result = assessRuleImpact(evidence, extractedFiles, { sourceFilesTruncated: false }, rule);
  const detectedLocations = result.findings.map((f) => ({
    sourceFile: f.sourceFile,
    line: f.line,
  }));

  return {
    outcome: {
      case: benchmarkCase,
      actualStatus: result.status,
      bucket: classify(benchmarkCase.expected.status, result.status),
      findingLocationsCorrect: findingLocationsCorrect(benchmarkCase, detectedLocations),
    },
    detectedLocations,
  };
}

/**
 * Location-level detail for one historical case: the developer's real
 * changed locations (`historical.actualChangedLocations`, ground truth)
 * vs. what Patchwork actually detected on the before-state -- matched/
 * missed/extra, never collapsed into a single ratio.
 */
function historicalCaseDetail(
  benchmarkCase: BenchmarkCase,
  detectedLocations: { sourceFile: string; line: number }[],
): HistoricalCaseDetail {
  const historical = benchmarkCase.historical!;
  const key = (loc: { sourceFile: string; line: number }) => `${loc.sourceFile}:${loc.line}`;
  const actualSet = new Set(historical.actualChangedLocations.map(key));
  const detectedSet = new Set(detectedLocations.map(key));

  return {
    caseId: benchmarkCase.id,
    repository: historical.repository,
    sourceCommitUrl: historical.sourceCommitUrl,
    actualChangedLocations: historical.actualChangedLocations,
    detectedLocations,
    matchedLocations: historical.actualChangedLocations.filter((loc) => detectedSet.has(key(loc))),
    missedLocations: historical.actualChangedLocations.filter((loc) => !detectedSet.has(key(loc))),
    extraLocations: detectedLocations.filter((loc) => !actualSet.has(key(loc))),
  };
}

interface MutableCounts {
  totalCases: number;
  truePositives: number;
  trueNegatives: number;
  correctAbstentions: number;
  falseNotAffectedSafetyFailures: number;
  overAbstentions: number;
  falsePositives: number;
  unsafeCertaintyCount: number;
  locationCorrect: number;
  locationTotal: number;
}

function emptyCounts(): MutableCounts {
  return {
    totalCases: 0,
    truePositives: 0,
    trueNegatives: 0,
    correctAbstentions: 0,
    falseNotAffectedSafetyFailures: 0,
    overAbstentions: 0,
    falsePositives: 0,
    unsafeCertaintyCount: 0,
    locationCorrect: 0,
    locationTotal: 0,
  };
}

function addOutcome(counts: MutableCounts, outcome: CaseOutcome): void {
  counts.totalCases += 1;
  switch (outcome.bucket) {
    case 'TRUE_POSITIVE':
      counts.truePositives += 1;
      break;
    case 'TRUE_NEGATIVE':
      counts.trueNegatives += 1;
      break;
    case 'CORRECT_ABSTENTION':
      counts.correctAbstentions += 1;
      break;
    case 'FALSE_NOT_AFFECTED_SAFETY_FAILURE':
      counts.falseNotAffectedSafetyFailures += 1;
      break;
    case 'OVER_ABSTENTION':
      counts.overAbstentions += 1;
      break;
    case 'FALSE_POSITIVE':
      counts.falsePositives += 1;
      break;
    case 'UNSAFE_CERTAINTY':
      counts.unsafeCertaintyCount += 1;
      break;
  }
  if (outcome.findingLocationsCorrect !== null) {
    counts.locationTotal += 1;
    if (outcome.findingLocationsCorrect) counts.locationCorrect += 1;
  }
}

function toMetrics(counts: MutableCounts): AggregateMetrics {
  const precisionDenominator = counts.truePositives + counts.falsePositives;
  const recallDenominator =
    counts.truePositives + counts.falseNotAffectedSafetyFailures + counts.overAbstentions;
  return {
    totalCases: counts.totalCases,
    truePositives: counts.truePositives,
    trueNegatives: counts.trueNegatives,
    correctAbstentions: counts.correctAbstentions,
    falseNotAffectedSafetyFailures: counts.falseNotAffectedSafetyFailures,
    overAbstentions: counts.overAbstentions,
    falsePositives: counts.falsePositives,
    unsafeCertaintyCount: counts.unsafeCertaintyCount,
    precisionAffected:
      precisionDenominator === 0 ? null : counts.truePositives / precisionDenominator,
    recallAffected: recallDenominator === 0 ? null : counts.truePositives / recallDenominator,
    findingLocationAccuracy:
      counts.locationTotal === 0
        ? null
        : { correct: counts.locationCorrect, total: counts.locationTotal },
  };
}

/**
 * Runs every hand-written benchmark case against the real production
 * pipeline (buildStripeEvidenceFromFiles -> assessRuleImpact against the
 * real IMPACT_RULES registry) -- never a parallel/shortcut implementation,
 * so what's benchmarked can't drift from what's shipped. Archive
 * extraction itself is skipped deliberately (see docs/testing.md); that
 * safety property is covered by archive.test.ts. Aggregates overall, per
 * rule, and per corpus (control vs. realistic vs. historical -- see
 * types.ts) so a perfect control-corpus score can never silently hide
 * weaker realistic or historical behavior. Historical cases additionally
 * get location-level detail against the real developer's migration diff.
 */
export function runBenchmark(cases: BenchmarkCase[] = ALL_BENCHMARK_CASES): BenchmarkReport {
  const rulesById = new Map(IMPACT_RULES.map((rule) => [rule.providerChange.externalId, rule]));

  const overallCounts = emptyCounts();
  const perRuleCounts = new Map<string, MutableCounts>();
  const byCorpusCounts: Record<Corpus, MutableCounts> = {
    control: emptyCounts(),
    realistic: emptyCounts(),
    historical: emptyCounts(),
  };
  const caseOutcomes: CaseOutcome[] = [];
  const historicalCases: HistoricalCaseDetail[] = [];

  for (const benchmarkCase of cases) {
    const rule = rulesById.get(benchmarkCase.ruleExternalId);
    if (!rule) {
      throw new Error(
        `Benchmark case "${benchmarkCase.id}" references unknown rule "${benchmarkCase.ruleExternalId}" -- not in IMPACT_RULES.`,
      );
    }

    const { outcome, detectedLocations } = runCase(benchmarkCase, rule);
    caseOutcomes.push(outcome);

    addOutcome(overallCounts, outcome);
    addOutcome(byCorpusCounts[benchmarkCase.corpus], outcome);
    const ruleCounts = perRuleCounts.get(rule.providerChange.externalId) ?? emptyCounts();
    addOutcome(ruleCounts, outcome);
    perRuleCounts.set(rule.providerChange.externalId, ruleCounts);

    if (benchmarkCase.historical) {
      historicalCases.push(historicalCaseDetail(benchmarkCase, detectedLocations));
    }
  }

  const perRule: RuleReport[] = IMPACT_RULES.filter((rule) =>
    perRuleCounts.has(rule.providerChange.externalId),
  ).map((rule) => ({
    ruleExternalId: rule.providerChange.externalId,
    title: rule.providerChange.title,
    ...toMetrics(perRuleCounts.get(rule.providerChange.externalId)!),
  }));

  const historical: HistoricalSummary = {
    totalActualLocations: historicalCases.reduce(
      (sum, c) => sum + c.actualChangedLocations.length,
      0,
    ),
    totalMatched: historicalCases.reduce((sum, c) => sum + c.matchedLocations.length, 0),
    totalMissed: historicalCases.reduce((sum, c) => sum + c.missedLocations.length, 0),
    totalExtra: historicalCases.reduce((sum, c) => sum + c.extraLocations.length, 0),
    cases: historicalCases,
  };

  return {
    totalRules: perRule.length,
    totalCases: cases.length,
    overall: toMetrics(overallCounts),
    byCorpus: {
      control: toMetrics(byCorpusCounts.control),
      realistic: toMetrics(byCorpusCounts.realistic),
      historical: toMetrics(byCorpusCounts.historical),
    },
    historical,
    perRule,
    caseOutcomes,
  };
}

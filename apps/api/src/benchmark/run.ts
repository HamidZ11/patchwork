import type { ExtractedFile } from '../analysis/archive.js';
import { buildStripeEvidenceFromFiles } from '../analysis/evidence.js';
import { assessRuleImpact } from '../analysis/impact/assess.js';
import { IMPACT_RULES } from '../analysis/impact/registry.js';
import type { ImpactStatus, RuleDefinition } from '../analysis/impact/types.js';
import { ALL_BENCHMARK_CASES } from './cases/index.js';
import type {
  BenchmarkCase,
  BenchmarkReport,
  CaseOutcome,
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

function runCase(benchmarkCase: BenchmarkCase, rule: RuleDefinition): CaseOutcome {
  const extractedFiles: ExtractedFile[] = Object.entries(benchmarkCase.files).map(
    ([path, content]) => ({ path, content }),
  );
  const evidence = buildStripeEvidenceFromFiles(extractedFiles, false);
  const result = assessRuleImpact(evidence, extractedFiles, { sourceFilesTruncated: false }, rule);

  return {
    case: benchmarkCase,
    actualStatus: result.status,
    bucket: classify(benchmarkCase.expected.status, result.status),
    findingLocationsCorrect: findingLocationsCorrect(benchmarkCase, result.findings),
  };
}

function emptyCounts() {
  return {
    totalCases: 0,
    truePositives: 0,
    trueNegatives: 0,
    correctAbstentions: 0,
    falseNotAffectedSafetyFailures: 0,
    overAbstentions: 0,
    falsePositives: 0,
    unsafeCertaintyCount: 0,
  };
}

function addOutcome(counts: ReturnType<typeof emptyCounts>, outcome: CaseOutcome): void {
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
}

function precisionRecall(counts: ReturnType<typeof emptyCounts>): {
  precisionAffected: number | null;
  recallAffected: number | null;
} {
  const precisionDenominator = counts.truePositives + counts.falsePositives;
  const recallDenominator =
    counts.truePositives + counts.falseNotAffectedSafetyFailures + counts.overAbstentions;
  return {
    precisionAffected:
      precisionDenominator === 0 ? null : counts.truePositives / precisionDenominator,
    recallAffected: recallDenominator === 0 ? null : counts.truePositives / recallDenominator,
  };
}

function toRuleReport(
  ruleExternalId: string,
  title: string,
  counts: ReturnType<typeof emptyCounts>,
  findingLocationAccuracy: { correct: number; total: number } | null,
): RuleReport {
  return {
    ruleExternalId,
    title,
    ...counts,
    ...precisionRecall(counts),
    findingLocationAccuracy,
  };
}

/**
 * Runs every hand-written benchmark case against the real production
 * pipeline (buildStripeEvidenceFromFiles -> assessRuleImpact against the
 * real IMPACT_RULES registry) -- never a parallel/shortcut implementation,
 * so what's benchmarked can't drift from what's shipped. Archive
 * extraction itself is skipped deliberately (see docs/testing.md); that
 * safety property is covered by archive.test.ts.
 */
export function runBenchmark(cases: BenchmarkCase[] = ALL_BENCHMARK_CASES): BenchmarkReport {
  const rulesById = new Map(IMPACT_RULES.map((rule) => [rule.providerChange.externalId, rule]));

  const overallCounts = emptyCounts();
  const overallLocationAccuracy = { correct: 0, total: 0 };
  const perRuleCounts = new Map<string, ReturnType<typeof emptyCounts>>();
  const perRuleLocationAccuracy = new Map<string, { correct: number; total: number }>();
  const caseOutcomes: CaseOutcome[] = [];

  for (const benchmarkCase of cases) {
    const rule = rulesById.get(benchmarkCase.ruleExternalId);
    if (!rule) {
      throw new Error(
        `Benchmark case "${benchmarkCase.id}" references unknown rule "${benchmarkCase.ruleExternalId}" -- not in IMPACT_RULES.`,
      );
    }

    const outcome = runCase(benchmarkCase, rule);
    caseOutcomes.push(outcome);

    addOutcome(overallCounts, outcome);
    const ruleCounts = perRuleCounts.get(rule.providerChange.externalId) ?? emptyCounts();
    addOutcome(ruleCounts, outcome);
    perRuleCounts.set(rule.providerChange.externalId, ruleCounts);

    if (outcome.findingLocationsCorrect !== null) {
      overallLocationAccuracy.total += 1;
      const ruleAccuracy = perRuleLocationAccuracy.get(rule.providerChange.externalId) ?? {
        correct: 0,
        total: 0,
      };
      ruleAccuracy.total += 1;
      if (outcome.findingLocationsCorrect) {
        overallLocationAccuracy.correct += 1;
        ruleAccuracy.correct += 1;
      }
      perRuleLocationAccuracy.set(rule.providerChange.externalId, ruleAccuracy);
    }
  }

  const perRule: RuleReport[] = IMPACT_RULES.filter((rule) =>
    perRuleCounts.has(rule.providerChange.externalId),
  ).map((rule) =>
    toRuleReport(
      rule.providerChange.externalId,
      rule.providerChange.title,
      perRuleCounts.get(rule.providerChange.externalId)!,
      perRuleLocationAccuracy.get(rule.providerChange.externalId) ?? null,
    ),
  );

  return {
    totalRules: perRule.length,
    totalCases: cases.length,
    overall: {
      ...overallCounts,
      ...precisionRecall(overallCounts),
      findingLocationAccuracy: overallLocationAccuracy.total > 0 ? overallLocationAccuracy : null,
    },
    perRule,
    caseOutcomes,
  };
}

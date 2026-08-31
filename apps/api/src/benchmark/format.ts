import type {
  AggregateMetrics,
  BenchmarkReport,
  HistoricalCaseDetail,
  RuleReport,
} from './types.js';

function fmtRate(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(2);
}

function fmtLocationAccuracy(accuracy: AggregateMetrics['findingLocationAccuracy']): string {
  return accuracy === null ? 'n/a' : `${accuracy.correct}/${accuracy.total}`;
}

function fmtLocations(locations: { sourceFile: string; line: number }[]): string {
  return locations.length === 0
    ? '(none)'
    : locations.map((l) => `${l.sourceFile}:${l.line}`).join(', ');
}

function formatHistoricalCase(detail: HistoricalCaseDetail): string[] {
  return [
    `  ${detail.caseId} (${detail.repository})`,
    `    Source: ${detail.sourceCommitUrl}`,
    `    Developer's actual changed locations: ${fmtLocations(detail.actualChangedLocations)}`,
    `    Patchwork detected: ${fmtLocations(detail.detectedLocations)}`,
    `    Matched: ${fmtLocations(detail.matchedLocations)}`,
    `    Missed: ${fmtLocations(detail.missedLocations)}`,
    `    Extra (unrelated): ${fmtLocations(detail.extraLocations)}`,
  ];
}

function formatMetricsBlock(indent: string, metrics: AggregateMetrics): string[] {
  return [
    `${indent}Cases: ${metrics.totalCases}`,
    `${indent}AFFECTED precision: ${fmtRate(metrics.precisionAffected)}`,
    `${indent}AFFECTED recall: ${fmtRate(metrics.recallAffected)}`,
    `${indent}Correct abstentions: ${metrics.correctAbstentions}`,
    `${indent}Over-abstentions: ${metrics.overAbstentions}`,
    `${indent}Unsafe certainty: ${metrics.unsafeCertaintyCount}`,
    `${indent}False NOT_AFFECTED safety failures: ${metrics.falseNotAffectedSafetyFailures}`,
    `${indent}Finding locations correct: ${fmtLocationAccuracy(metrics.findingLocationAccuracy)}`,
  ];
}

function formatRuleSection(rule: RuleReport): string[] {
  return [`  ${rule.title} (${rule.ruleExternalId})`, ...formatMetricsBlock('    ', rule)];
}

/** Human-readable report, matching the shape used in docs/impact-analysis.md. */
export function formatBenchmarkReport(report: BenchmarkReport): string {
  const lines: string[] = [];
  lines.push(`Rules: ${report.totalRules}`);
  lines.push('');
  lines.push(...formatMetricsBlock('', report.overall));
  lines.push('');
  lines.push(`Control corpus (slice 4, ${report.byCorpus.control.totalCases} cases):`);
  lines.push(...formatMetricsBlock('  ', report.byCorpus.control));
  lines.push('');
  lines.push(`Realistic corpus (slice 5, ${report.byCorpus.realistic.totalCases} cases):`);
  lines.push(...formatMetricsBlock('  ', report.byCorpus.realistic));
  lines.push('');
  lines.push(
    `Historical corpus (slice 6, ${report.byCorpus.historical.totalCases} cases -- real public GitHub migrations):`,
  );
  lines.push(...formatMetricsBlock('  ', report.byCorpus.historical));
  lines.push(
    `  Historical location recall: ${report.historical.totalMatched}/${report.historical.totalActualLocations} matched, ${report.historical.totalMissed} missed, ${report.historical.totalExtra} extra`,
  );
  for (const detail of report.historical.cases) {
    lines.push('');
    lines.push(...formatHistoricalCase(detail));
  }
  lines.push('');
  lines.push('Per-rule:');
  for (const rule of report.perRule) {
    lines.push(...formatRuleSection(rule));
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/** Machine-readable form -- omits per-case fixture source, keeps outcomes. */
export function formatBenchmarkReportJson(report: BenchmarkReport): string {
  return JSON.stringify(
    {
      totalRules: report.totalRules,
      totalCases: report.totalCases,
      overall: report.overall,
      byCorpus: report.byCorpus,
      historical: report.historical,
      perRule: report.perRule,
      caseOutcomes: report.caseOutcomes.map((outcome) => ({
        id: outcome.case.id,
        ruleExternalId: outcome.case.ruleExternalId,
        category: outcome.case.category,
        corpus: outcome.case.corpus,
        expectedStatus: outcome.case.expected.status,
        actualStatus: outcome.actualStatus,
        bucket: outcome.bucket,
        findingLocationsCorrect: outcome.findingLocationsCorrect,
      })),
    },
    null,
    2,
  );
}

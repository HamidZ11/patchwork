import type { BenchmarkReport, RuleReport } from './types.js';

function fmtRate(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(2);
}

function fmtLocationAccuracy(accuracy: RuleReport['findingLocationAccuracy']): string {
  return accuracy === null ? 'n/a' : `${accuracy.correct}/${accuracy.total}`;
}

function formatRuleSection(rule: RuleReport): string[] {
  return [
    `  ${rule.title} (${rule.ruleExternalId})`,
    `    Cases: ${rule.totalCases}`,
    `    AFFECTED precision: ${fmtRate(rule.precisionAffected)}`,
    `    AFFECTED recall: ${fmtRate(rule.recallAffected)}`,
    `    Correct abstentions: ${rule.correctAbstentions}`,
    `    Over-abstentions: ${rule.overAbstentions}`,
    `    Unsafe certainty: ${rule.unsafeCertaintyCount}`,
    `    False NOT_AFFECTED safety failures: ${rule.falseNotAffectedSafetyFailures}`,
    `    Finding locations correct: ${fmtLocationAccuracy(rule.findingLocationAccuracy)}`,
  ];
}

/** Human-readable report, matching the shape used in docs/impact-analysis.md. */
export function formatBenchmarkReport(report: BenchmarkReport): string {
  const lines: string[] = [];
  lines.push(`Rules: ${report.totalRules}`);
  lines.push(`Cases: ${report.totalCases}`);
  lines.push('');
  lines.push(`AFFECTED precision: ${fmtRate(report.overall.precisionAffected)}`);
  lines.push(`AFFECTED recall: ${fmtRate(report.overall.recallAffected)}`);
  lines.push(`Correct abstentions: ${report.overall.correctAbstentions}`);
  lines.push(`Over-abstentions: ${report.overall.overAbstentions}`);
  lines.push(`Unsafe certainty: ${report.overall.unsafeCertaintyCount}`);
  lines.push(
    `False NOT_AFFECTED safety failures: ${report.overall.falseNotAffectedSafetyFailures}`,
  );
  lines.push(
    `Finding locations correct: ${fmtLocationAccuracy(report.overall.findingLocationAccuracy)}`,
  );
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
      perRule: report.perRule,
      caseOutcomes: report.caseOutcomes.map((outcome) => ({
        id: outcome.case.id,
        ruleExternalId: outcome.case.ruleExternalId,
        category: outcome.case.category,
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

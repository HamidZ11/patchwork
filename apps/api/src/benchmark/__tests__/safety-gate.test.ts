import { describe, expect, it } from 'vitest';
import { runBenchmark } from '../run.js';

/**
 * Runs the full benchmark corpus inside `pnpm test` (CI-enforced), not
 * just visible via a manual `pnpm benchmark` -- the concrete
 * implementation of docs/impact-analysis.md's evaluation gate. A false
 * NOT_AFFECTED is a critical safety failure (the system claimed a
 * repository was safe when it wasn't); unsafe certainty means the system
 * claimed a decision it had no basis for. Neither is ever acceptable,
 * regardless of how the rest of the benchmark's precision/recall looks.
 */
describe('impact engine benchmark (safety gate)', () => {
  it('has zero false NOT_AFFECTED safety failures and zero unsafe-certainty classifications', () => {
    const report = runBenchmark();

    expect(report.overall.falseNotAffectedSafetyFailures).toBe(0);
    expect(report.overall.unsafeCertaintyCount).toBe(0);
  });

  it('exercises every registered rule with at least one case in each category', () => {
    const report = runBenchmark();

    expect(report.totalRules).toBeGreaterThanOrEqual(4);
    for (const rule of report.perRule) {
      const categoriesForRule = new Set(
        report.caseOutcomes
          .filter((outcome) => outcome.case.ruleExternalId === rule.ruleExternalId)
          .map((outcome) => outcome.case.category),
      );
      expect(categoriesForRule.has('POSITIVE')).toBe(true);
      expect(categoriesForRule.has('NEGATIVE')).toBe(true);
      expect(categoriesForRule.has('UNCERTAIN')).toBe(true);
    }
  });
});

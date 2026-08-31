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

  /**
   * Slice 5's realistic corpus exists specifically so a perfect
   * control-corpus score can never silently stand in for real-world
   * behavior -- assert it's a genuinely meaningful, present slice of the
   * corpus (not zero cases, not a token handful), and that it's held to
   * the exact same safety bar as the control corpus, not a relaxed one.
   */
  it('the realistic corpus is present and meaningfully sized, and meets the same safety bar', () => {
    const report = runBenchmark();

    expect(report.byCorpus.realistic.totalCases).toBeGreaterThanOrEqual(20);
    expect(report.byCorpus.realistic.falseNotAffectedSafetyFailures).toBe(0);
    expect(report.byCorpus.realistic.unsafeCertaintyCount).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { ALL_HISTORICAL_BENCHMARK_CASES } from '../cases/historical/index.js';
import { runBenchmark } from '../run.js';
import type { BenchmarkCase } from '../types.js';

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;

describe('historical benchmark cases: metadata validity', () => {
  it('is present with at least one case per the task target', () => {
    expect(ALL_HISTORICAL_BENCHMARK_CASES.length).toBeGreaterThanOrEqual(1);
  });

  it.each(ALL_HISTORICAL_BENCHMARK_CASES)(
    'case $id has fully-populated, well-formed historical provenance',
    (benchmarkCase) => {
      expect(benchmarkCase.corpus).toBe('historical');
      const provenance = benchmarkCase.historical;
      expect(provenance).toBeDefined();
      if (!provenance) return;

      // "owner/repo" shape.
      expect(provenance.repository).toMatch(/^[^/]+\/[^/]+$/);
      // Real, pinned commit SHAs -- never a moving branch/tag.
      expect(provenance.beforeSha).toMatch(FULL_SHA_PATTERN);
      expect(provenance.afterSha).toMatch(FULL_SHA_PATTERN);
      expect(provenance.beforeSha).not.toBe(provenance.afterSha);
      // Traceable back to the exact real migration commit.
      expect(provenance.sourceCommitUrl).toBe(
        `https://github.com/${provenance.repository}/commit/${provenance.afterSha}`,
      );
      expect(provenance.rationale.length).toBeGreaterThan(0);
    },
  );

  it('every AFFECTED-expected historical case has at least one real developer-changed location', () => {
    for (const benchmarkCase of ALL_HISTORICAL_BENCHMARK_CASES) {
      if (benchmarkCase.expected.status !== 'AFFECTED') continue;
      expect(benchmarkCase.historical?.actualChangedLocations.length).toBeGreaterThan(0);
    }
  });
});

describe('historical benchmark cases: safety classification', () => {
  it('has zero false NOT_AFFECTED safety failures among the real historical cases', () => {
    const report = runBenchmark(ALL_HISTORICAL_BENCHMARK_CASES);
    expect(report.overall.falseNotAffectedSafetyFailures).toBe(0);
  });

  it('has zero unsafe certainty among the real historical cases', () => {
    const report = runBenchmark(ALL_HISTORICAL_BENCHMARK_CASES);
    expect(report.overall.unsafeCertaintyCount).toBe(0);
  });

  it('control and realistic corpus counts are unaffected by adding the historical corpus', () => {
    // Running the full ALL_BENCHMARK_CASES set (imported transitively via
    // run.ts's default) must not change control/realistic totals just
    // because historical cases now exist alongside them.
    const fullReport = runBenchmark();
    const historicalOnlyCount = ALL_HISTORICAL_BENCHMARK_CASES.length;
    expect(fullReport.byCorpus.historical.totalCases).toBe(historicalOnlyCount);
    expect(fullReport.totalCases).toBeGreaterThan(historicalOnlyCount);
  });
});

describe('historical location recall computation', () => {
  /**
   * Synthetic cases isolate the matched/missed/extra computation itself
   * from the 3 real historical cases -- this must keep working correctly
   * regardless of what the real cases happen to score.
   */
  const RULE_ID = 'basil-2025-03-31-invoice-preview-api-deprecations';

  function syntheticCase(overrides: Partial<BenchmarkCase>): BenchmarkCase {
    return {
      id: 'synthetic-historical-case',
      ruleExternalId: RULE_ID,
      category: 'POSITIVE',
      corpus: 'historical',
      historical: {
        repository: 'example-org/example-repo',
        beforeSha: '0'.repeat(40),
        afterSha: '1'.repeat(40),
        sourceCommitUrl: `https://github.com/example-org/example-repo/commit/${'1'.repeat(40)}`,
        actualChangedLocations: [{ sourceFile: 'src/billing.ts', line: 3 }],
        rationale: 'synthetic test case',
      },
      files: {
        'package.json': JSON.stringify({ dependencies: { stripe: '^18.0.0' } }),
        'package-lock.json': JSON.stringify({
          packages: { '': {}, 'node_modules/stripe': { version: '18.2.0' } },
        }),
        'src/billing.ts': [
          "import Stripe from 'stripe';",
          "const stripe = new Stripe('sk_test');",
          'stripe.invoices.retrieveUpcoming({ customer: "cus_1" });',
        ].join('\n'),
      },
      expected: { status: 'AFFECTED' },
      notes: 'synthetic',
      ...overrides,
    };
  }

  it('reports a perfect match when the real finding lands exactly on the actual changed location', () => {
    const report = runBenchmark([syntheticCase({})]);

    expect(report.historical.totalActualLocations).toBe(1);
    expect(report.historical.totalMatched).toBe(1);
    expect(report.historical.totalMissed).toBe(0);
    expect(report.historical.totalExtra).toBe(0);
    expect(report.historical.cases[0]?.matchedLocations).toEqual([
      { sourceFile: 'src/billing.ts', line: 3 },
    ]);
  });

  it('reports a miss when the actual changed location was not detected', () => {
    const missedCase = syntheticCase({
      historical: {
        repository: 'example-org/example-repo',
        beforeSha: '0'.repeat(40),
        afterSha: '1'.repeat(40),
        sourceCommitUrl: `https://github.com/example-org/example-repo/commit/${'1'.repeat(40)}`,
        // A location the analyser will never find in this fixture's source.
        actualChangedLocations: [{ sourceFile: 'src/billing.ts', line: 99 }],
        rationale: 'synthetic test case',
      },
    });
    const report = runBenchmark([missedCase]);

    expect(report.historical.totalMatched).toBe(0);
    expect(report.historical.totalMissed).toBe(1);
    expect(report.historical.cases[0]?.missedLocations).toEqual([
      { sourceFile: 'src/billing.ts', line: 99 },
    ]);
  });

  it('reports an extra finding when Patchwork detects a location the developer did not change', () => {
    const extraCase = syntheticCase({
      files: {
        'package.json': JSON.stringify({ dependencies: { stripe: '^18.0.0' } }),
        'package-lock.json': JSON.stringify({
          packages: { '': {}, 'node_modules/stripe': { version: '18.2.0' } },
        }),
        'src/billing.ts': [
          "import Stripe from 'stripe';",
          "const stripe = new Stripe('sk_test');",
          'stripe.invoices.retrieveUpcoming({ customer: "cus_1" });',
          'stripe.invoices.retrieveUpcoming({ customer: "cus_2" });',
        ].join('\n'),
      },
      historical: {
        repository: 'example-org/example-repo',
        beforeSha: '0'.repeat(40),
        afterSha: '1'.repeat(40),
        sourceCommitUrl: `https://github.com/example-org/example-repo/commit/${'1'.repeat(40)}`,
        // The developer's real diff only touched line 3.
        actualChangedLocations: [{ sourceFile: 'src/billing.ts', line: 3 }],
        rationale: 'synthetic test case',
      },
    });
    const report = runBenchmark([extraCase]);

    expect(report.historical.totalMatched).toBe(1);
    expect(report.historical.totalExtra).toBe(1);
    expect(report.historical.cases[0]?.extraLocations).toEqual([
      { sourceFile: 'src/billing.ts', line: 4 },
    ]);
  });
});

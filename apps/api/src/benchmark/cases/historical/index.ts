import type { BenchmarkCase } from '../../types.js';
import { HISTORICAL_INVOICE_SUBSCRIPTION_CASES } from './invoice-subscription.js';
import { HISTORICAL_RETRIEVE_UPCOMING_CASES } from './retrieve-upcoming.js';
import { HISTORICAL_SCHEDULE_ITERATIONS_CASES } from './schedule-iterations.js';

/**
 * Every historical (slice 6) benchmark case -- minimal reconstructions of
 * real, independently-sourced public GitHub repositories at the exact
 * commit before a real developer performed a real Stripe migration. No
 * Rule D case exists: no genuine public migration for the Issuing
 * Authorization.status split was found (reported honestly, not
 * stretched) -- see docs/impact-analysis.md's Historical validation
 * section.
 */
export const ALL_HISTORICAL_BENCHMARK_CASES: BenchmarkCase[] = [
  ...HISTORICAL_RETRIEVE_UPCOMING_CASES,
  ...HISTORICAL_INVOICE_SUBSCRIPTION_CASES,
  ...HISTORICAL_SCHEDULE_ITERATIONS_CASES,
];

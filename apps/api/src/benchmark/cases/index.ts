import type { BenchmarkCase } from '../types.js';
import { ALL_HISTORICAL_BENCHMARK_CASES } from './historical/index.js';
import { INVOICE_SUBSCRIPTION_CASES } from './invoice-subscription.js';
import { ISSUING_AUTHORIZATION_STATUS_CASES } from './issuing-authorization-status.js';
import { ALL_REALISTIC_BENCHMARK_CASES } from './realistic/index.js';
import { RETRIEVE_UPCOMING_CASES } from './retrieve-upcoming.js';
import { SCHEDULE_ITERATIONS_CASES } from './schedule-iterations.js';

/**
 * Every hand-written, hand-labelled benchmark case across all rules --
 * the slice 4 control corpus, the slice 5 realistic corpus, and the
 * slice 6 historical corpus (see types.ts's Corpus type and
 * docs/impact-analysis.md's Realistic/Historical validation sections).
 */
export const ALL_BENCHMARK_CASES: BenchmarkCase[] = [
  ...RETRIEVE_UPCOMING_CASES,
  ...INVOICE_SUBSCRIPTION_CASES,
  ...SCHEDULE_ITERATIONS_CASES,
  ...ISSUING_AUTHORIZATION_STATUS_CASES,
  ...ALL_REALISTIC_BENCHMARK_CASES,
  ...ALL_HISTORICAL_BENCHMARK_CASES,
];

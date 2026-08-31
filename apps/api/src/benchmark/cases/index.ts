import type { BenchmarkCase } from '../types.js';
import { INVOICE_SUBSCRIPTION_CASES } from './invoice-subscription.js';
import { ISSUING_AUTHORIZATION_STATUS_CASES } from './issuing-authorization-status.js';
import { ALL_REALISTIC_BENCHMARK_CASES } from './realistic/index.js';
import { RETRIEVE_UPCOMING_CASES } from './retrieve-upcoming.js';
import { SCHEDULE_ITERATIONS_CASES } from './schedule-iterations.js';

/**
 * Every hand-written, hand-labelled benchmark case across all rules --
 * both the slice 4 control corpus and the slice 5 realistic corpus (see
 * types.ts's Corpus type and docs/impact-analysis.md's Realistic
 * validation section).
 */
export const ALL_BENCHMARK_CASES: BenchmarkCase[] = [
  ...RETRIEVE_UPCOMING_CASES,
  ...INVOICE_SUBSCRIPTION_CASES,
  ...SCHEDULE_ITERATIONS_CASES,
  ...ISSUING_AUTHORIZATION_STATUS_CASES,
  ...ALL_REALISTIC_BENCHMARK_CASES,
];

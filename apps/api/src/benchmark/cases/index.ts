import type { BenchmarkCase } from '../types.js';
import { INVOICE_SUBSCRIPTION_CASES } from './invoice-subscription.js';
import { ISSUING_AUTHORIZATION_STATUS_CASES } from './issuing-authorization-status.js';
import { RETRIEVE_UPCOMING_CASES } from './retrieve-upcoming.js';
import { SCHEDULE_ITERATIONS_CASES } from './schedule-iterations.js';

/** Every hand-written, hand-labelled benchmark case across all rules. */
export const ALL_BENCHMARK_CASES: BenchmarkCase[] = [
  ...RETRIEVE_UPCOMING_CASES,
  ...INVOICE_SUBSCRIPTION_CASES,
  ...SCHEDULE_ITERATIONS_CASES,
  ...ISSUING_AUTHORIZATION_STATUS_CASES,
];

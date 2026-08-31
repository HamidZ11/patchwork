import type { BenchmarkCase } from '../../types.js';
import { REALISTIC_INVOICE_SUBSCRIPTION_CASES } from './invoice-subscription.js';
import { REALISTIC_ISSUING_AUTHORIZATION_STATUS_CASES } from './issuing-authorization-status.js';
import { REALISTIC_RETRIEVE_UPCOMING_CASES } from './retrieve-upcoming.js';
import { REALISTIC_SCHEDULE_ITERATIONS_CASES } from './schedule-iterations.js';

/**
 * Every realistic-shape (slice 5) benchmark case -- ordinary production
 * TypeScript patterns, not shaped around the analyser's own capabilities.
 * Rules B and D get the largest sets per the task's stated priority (both
 * depend on the awaited-property/literal analysis path). See
 * docs/impact-analysis.md's Realistic validation section.
 */
export const ALL_REALISTIC_BENCHMARK_CASES: BenchmarkCase[] = [
  ...REALISTIC_INVOICE_SUBSCRIPTION_CASES,
  ...REALISTIC_ISSUING_AUTHORIZATION_STATUS_CASES,
  ...REALISTIC_RETRIEVE_UPCOMING_CASES,
  ...REALISTIC_SCHEDULE_ITERATIONS_CASES,
];

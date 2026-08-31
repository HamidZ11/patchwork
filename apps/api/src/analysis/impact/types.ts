import { z } from 'zod';
import type { ExtractedFile } from '../archive.js';
import type { ApplicabilityConfig } from './applicability.js';
import type { PredicateScanResult } from './predicates/engine.js';

export const impactStatusSchema = z.enum(['AFFECTED', 'NOT_AFFECTED', 'UNCERTAIN']);
export type ImpactStatus = z.infer<typeof impactStatusSchema>;

export const findingSchema = z.object({
  workspacePath: z.string(),
  sourceFile: z.string(),
  line: z.number().int().nonnegative(),
  matchedSymbol: z.string(),
});
export type Finding = z.infer<typeof findingSchema>;

export const applicabilitySchema = z.enum(['APPLICABLE', 'NOT_APPLICABLE', 'UNKNOWN']);
export type Applicability = z.infer<typeof applicabilitySchema>;

/** Per-workspace applicability + predicate outcome, before aggregation. */
export const workspaceCoverageSchema = z.object({
  workspacePath: z.string(),
  applicability: applicabilitySchema,
  applicabilityReason: z.string(),
  sourceFilesScanned: z.number().int().nonnegative(),
  filesFailedToLoad: z.array(z.string()),
  ambiguousReferences: z.array(
    z.object({ sourceFile: z.string(), line: z.number().int().nonnegative() }),
  ),
  matches: z.array(findingSchema),
});
export type WorkspaceCoverage = z.infer<typeof workspaceCoverageSchema>;

export const impactCoverageSchema = z.object({
  schemaVersion: z.literal(1),
  archiveAcquired: z.boolean(),
  sourceFilesTruncated: z.boolean(),
  workspaces: z.array(workspaceCoverageSchema),
});
export type ImpactCoverage = z.infer<typeof impactCoverageSchema>;

export interface ImpactAssessmentResult {
  status: ImpactStatus;
  reason: string;
  coverage: ImpactCoverage;
  findings: Finding[];
}

/**
 * The normalized fact of what changed -- persisted into `provider_changes`
 * via an idempotent upsert (see impact-persistence.ts). Not user-authored;
 * one hardcoded definition per real, manually-verified change.
 */
export interface ProviderChangeDefinition {
  provider: 'stripe';
  externalId: string;
  title: string;
  sourceUrl: string;
  ruleVersion: string;
  predicateKind: string;
  /** Verbatim migration text from the official source, not Patchwork-authored prose. */
  migrationRequirement: string;
}

/**
 * One rule: a ProviderChange's identity plus everything needed to
 * evaluate it against an AnalysisRun's evidence and extracted files.
 * `runPredicate` composes one of the reusable primitives in
 * `predicates/*.ts` with this rule's own parameters (property/method
 * names, expected literal values, ...).
 */
export interface RuleDefinition {
  providerChange: ProviderChangeDefinition;
  applicabilityConfig: ApplicabilityConfig;
  runPredicate: (files: ExtractedFile[]) => Map<string, PredicateScanResult>;
}

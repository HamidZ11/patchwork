import { z } from 'zod';

/**
 * EXACT: declared range + lockfile-resolved version both known and agree.
 * DECLARED_ONLY: declared range known, no (parseable) lockfile resolution.
 * CONFLICTING: >1 lockfile present and they disagree for this workspace.
 * UNKNOWN: a lockfile of a supported format exists but failed to parse.
 */
export const resolutionStatusSchema = z.enum(['EXACT', 'DECLARED_ONLY', 'CONFLICTING', 'UNKNOWN']);
export type ResolutionStatus = z.infer<typeof resolutionStatusSchema>;

export const dependencyFieldSchema = z.enum([
  'dependencies',
  'devDependencies',
  'peerDependencies',
]);
export type DependencyField = z.infer<typeof dependencyFieldSchema>;

export const installedSdkEvidenceSchema = z.object({
  packageName: z.literal('stripe'),
  workspacePath: z.string(),
  manifestPath: z.string(),
  dependencyField: dependencyFieldSchema,
  declaredRange: z.string(),
  resolvedVersion: z.string().nullable(),
  resolutionStatus: resolutionStatusSchema,
  evidenceSources: z.array(z.string()),
});
export type InstalledSdkEvidence = z.infer<typeof installedSdkEvidenceSchema>;

/**
 * LITERAL: apiVersion was a string literal.
 * LOCAL_CONSTANT: apiVersion was an identifier resolved to a same-file
 *   const with a string-literal initializer.
 * DYNAMIC_UNKNOWN: anything else (env var, imported identifier, function
 *   call, ternary, ...) -- never guessed.
 */
export const apiVersionValueKindSchema = z.enum(['LITERAL', 'LOCAL_CONSTANT', 'DYNAMIC_UNKNOWN']);
export type ApiVersionValueKind = z.infer<typeof apiVersionValueKindSchema>;

export const clientVersionEvidenceSchema = z.object({
  workspacePath: z.string(),
  sourceFile: z.string(),
  line: z.number().int().nonnegative(),
  apiVersion: z.string().nullable(),
  valueKind: apiVersionValueKindSchema,
});
export type ClientVersionEvidence = z.infer<typeof clientVersionEvidenceSchema>;

/**
 * Static stubs -- not discoverable from repository source in this slice.
 * Included so the shape is stable for future slices, not fabricated data:
 * no Stripe API is ever called, no webhook configuration is analyzed.
 */
export const accountVersionEvidenceSchema = z.object({
  status: z.literal('UNKNOWN'),
  reason: z.string(),
});
export type AccountVersionEvidence = z.infer<typeof accountVersionEvidenceSchema>;

export const webhookVersionEvidenceSchema = z.object({
  status: z.literal('OUT_OF_SCOPE'),
  reason: z.string(),
});
export type WebhookVersionEvidence = z.infer<typeof webhookVersionEvidenceSchema>;

export const workspaceConfigDiscoveredSchema = z.enum([
  'npm_workspaces',
  'pnpm_workspaces',
  'none',
]);
export type WorkspaceConfigDiscovered = z.infer<typeof workspaceConfigDiscoveredSchema>;

export const analysisCoverageSchema = z.object({
  archiveAcquired: z.boolean(),
  manifestsDiscovered: z.number().int().nonnegative(),
  workspaceConfigDiscovered: workspaceConfigDiscoveredSchema,
  lockfilesDiscovered: z.array(z.string()),
  lockfilesParsed: z.array(z.string()),
  lockfilesUnsupported: z.array(z.string()),
  sourceFilesScanned: z.number().int().nonnegative(),
  sourceFilesTruncated: z.boolean(),
  parseFailures: z.array(z.string()),
});
export type AnalysisCoverage = z.infer<typeof analysisCoverageSchema>;

export const STRIPE_EVIDENCE_SCHEMA_VERSION = 1;

export const stripeEvidenceSchema = z.object({
  schemaVersion: z.literal(STRIPE_EVIDENCE_SCHEMA_VERSION),
  installedSdks: z.array(installedSdkEvidenceSchema),
  clientVersions: z.array(clientVersionEvidenceSchema),
  accountVersion: accountVersionEvidenceSchema,
  webhookVersion: webhookVersionEvidenceSchema,
  coverage: analysisCoverageSchema,
});
export type StripeEvidence = z.infer<typeof stripeEvidenceSchema>;

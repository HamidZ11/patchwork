import { z } from 'zod';

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

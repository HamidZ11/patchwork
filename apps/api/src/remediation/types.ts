import type { ExtractedFile } from '../analysis/archive.js';
import type { Finding } from '../analysis/impact/types.js';

export type PatchAttemptStatus = 'GENERATED' | 'REFUSED' | 'FAILED';

export interface PostconditionCheck {
  name: string;
  passed: boolean;
  detail: string;
}

/**
 * Result of transforming ONE file's text for a set of findings that all
 * belong to it. Refusal is whole-file, not per-finding: if any finding in
 * the file can't be proven safe, nothing in that file is rewritten (see
 * recipes/README-equivalent doc comment on RemediationRecipe below for
 * why this is "refuse the whole attempt," not "best-effort the rest").
 */
export type FileTransformResult =
  { kind: 'transformed'; newText: string } | { kind: 'refused'; reason: string };

/**
 * One hardcoded, versioned, mechanical transformation -- the code-level
 * counterpart to docs/data-model.md's still-unshaped `TransformationRecipe`
 * candidate, deliberately NOT a DB table or a migration-language platform
 * (mirrors how RuleDefinition objects in analysis/impact/rules/ already
 * work: one reviewed TS file per real, manually-verified change).
 */
export interface RemediationRecipe {
  /** Matches RuleVersion.predicateKind -- selects which assessments this recipe can act on. */
  predicateKind: string;
  /** Discriminator persisted on PatchAttempt.transformation_kind. */
  transformationKind: string;
  /** Versioned like RuleVersion.version -- a future bugfix bumps this, never silently redefines what a past attempt meant. */
  transformationVersion: string;
  /** Pure: given one file's exact snapshot text and the findings within it, produce the rewritten text or a refusal. Never touches disk/network. `tsconfigFiles` mirrors what the original impact scan saw, for parity. */
  transformFile(
    fileText: string,
    findingsInFile: Finding[],
    tsconfigFiles?: ExtractedFile[],
  ): FileTransformResult;
  /** Independent of transformFile's own internals -- re-proves the migration semantically held using the same real TypeChecker-based engine, not by trusting the transform's return value. */
  checkPostconditions(
    before: string,
    after: string,
    filePath: string,
    tsconfigFiles?: ExtractedFile[],
  ): PostconditionCheck[];
}

export interface GeneratePatchAttemptResult {
  status: PatchAttemptStatus;
  refusalReason?: string;
  failureReason?: string;
  changedFiles: string[];
  diff?: string;
  postconditionResult?: PostconditionCheck[];
}

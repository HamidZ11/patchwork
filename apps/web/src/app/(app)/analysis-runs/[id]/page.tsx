import { Fragment } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { FormSubmitButton } from '@/components/form-submit-button';

interface InstalledSdk {
  packageName: string;
  workspacePath: string;
  declaredRange: string;
  resolvedVersion: string | null;
  resolutionStatus: string;
}

interface AnalysisRunEvidence {
  installedSdks: InstalledSdk[];
}

/** "stripe" reads as a package name; "Stripe" reads as the product this
 * page is actually about -- a display-only capitalization, not a change
 * to the underlying evidence. Only prefixes with a real workspace path
 * (never the placeholder "." for the common single-workspace case). */
function formatSdkEvidence(sdk: InstalledSdk): string {
  const label = sdk.packageName === 'stripe' ? 'Stripe' : sdk.packageName;
  const prefix = sdk.workspacePath ? `${sdk.workspacePath}: ` : '';
  return `${prefix}${label} ${sdk.resolvedVersion ?? 'unresolved'} (declared ${sdk.declaredRange})`;
}

interface Finding {
  sourceFile: string;
  line: number;
  matchedSymbol: string;
}

interface AmbiguousReference {
  sourceFile: string;
  line: number;
}

interface WorkspaceCoverage {
  workspacePath: string;
  applicability: 'APPLICABLE' | 'NOT_APPLICABLE' | 'UNKNOWN';
  applicabilityReason: string;
  sourceFilesScanned: number;
  filesFailedToLoad: string[];
  ambiguousReferences: AmbiguousReference[];
}

interface PostconditionCheck {
  name: string;
  passed: boolean;
  detail: string;
}

type VerificationRunStatus =
  'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'REFUSED' | 'TIMED_OUT' | 'INFRA_ERROR';

interface VerificationStep {
  sequence: number;
  kind: string;
  command: string;
  status: 'PASSED' | 'FAILED' | 'TIMED_OUT' | 'SKIPPED';
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number | null;
  stdoutExcerpt: string | null;
  stderrExcerpt: string | null;
  truncated: boolean;
  /** Frontend-synthesized placeholder for a canonical step kind absent from
   * the real manifest (e.g. no test script declared) -- never persisted,
   * never mistaken for a real SKIPPED step. See VerificationSection. */
  notRun?: boolean;
}

interface VerificationRun {
  id: string;
  status: VerificationRunStatus;
  failureCategory: string | null;
  failureReason: string | null;
  manifestVersion: string | null;
  sandboxProvider: string | null;
  sandboxRuntime: string | null;
  nodeVersion: string | null;
  nodeVersionSource: string | null;
  packageManager: string | null;
  createdAt: string;
  steps: VerificationStep[];
}

type PullRequestAttemptStatus = 'PENDING' | 'RUNNING' | 'OPENED' | 'REFUSED' | 'FAILED';

type PullRequestFailureCategory =
  | 'STALE_BASE'
  | 'POLICY_REFUSAL'
  | 'GITHUB_PERMISSION_FAILURE'
  | 'GITHUB_RULESET_FAILURE'
  | 'BRANCH_COLLISION'
  | 'PATCH_APPLICATION_FAILURE'
  | 'GITHUB_API_FAILURE'
  | 'RATE_LIMITED';

interface PullRequestAttempt {
  id: string;
  status: PullRequestAttemptStatus;
  failureCategory: PullRequestFailureCategory | null;
  failureReason: string | null;
  branchName: string | null;
  commitSha: string | null;
  githubPrNumber: number | null;
  githubPrUrl: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface PatchAttempt {
  id: string;
  status: 'GENERATED' | 'REFUSED' | 'FAILED';
  refusalReason: string | null;
  failureReason: string | null;
  changedFiles: string[];
  diff: string | null;
  postconditionResult: PostconditionCheck[] | null;
  createdAt: string;
  verificationRuns: VerificationRun[];
  pullRequestAttempts: PullRequestAttempt[];
}

interface AssessmentDetail {
  id: string;
  status: 'AFFECTED' | 'NOT_AFFECTED' | 'UNCERTAIN';
  reason: string;
  /**
   * Null when the API couldn't validate the persisted coverage JSON
   * against the current ImpactCoverage contract (a legacy row from an
   * older analyzer version). Never defaulted to an empty workspace list --
   * that would read as "fully scanned, nothing found" and misrepresent
   * genuinely unavailable evidence as a confirmed negative.
   */
  coverage: { workspaces: WorkspaceCoverage[] } | null;
  findings: Finding[];
  providerChangeTitle: string;
  providerChangeSourceUrl: string;
  migrationRequirement: string;
  predicateKind: string;
  remediationSupported: boolean;
  patchAttempts: PatchAttempt[];
}

interface AnalysisRunDetail {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  repositoryFullName: string;
  commitSha: string;
  evidence: AnalysisRunEvidence | null;
  assessments: AssessmentDetail[];
}

const STATUS_ORDER: Record<AssessmentDetail['status'], number> = {
  AFFECTED: 0,
  UNCERTAIN: 1,
  NOT_AFFECTED: 2,
};

const STATUS_STYLE: Record<AssessmentDetail['status'], { dot: string; text: string }> = {
  AFFECTED: { dot: 'bg-mark-attention', text: 'text-attention' },
  UNCERTAIN: { dot: 'bg-mark-indeterminate', text: 'text-indeterminate' },
  NOT_AFFECTED: { dot: 'bg-mark-neutral', text: 'text-fg-tertiary' },
};

const STATUS_LABEL: Record<AssessmentDetail['status'], string> = {
  AFFECTED: 'Affected',
  UNCERTAIN: 'Uncertain',
  NOT_AFFECTED: 'Not affected',
};

async function prepareFix(assessmentId: string, analysisRunId: string) {
  'use server';
  await apiFetch(`/impact-assessments/${assessmentId}/patch-attempts`, { method: 'POST' });
  redirect(`/analysis-runs/${analysisRunId}`);
}

async function verifyInSandbox(patchAttemptId: string, analysisRunId: string) {
  'use server';
  await apiFetch(`/patch-attempts/${patchAttemptId}/verification-runs`, { method: 'POST' });
  redirect(`/analysis-runs/${analysisRunId}`);
}

async function createPullRequest(verificationRunId: string, analysisRunId: string) {
  'use server';
  await apiFetch(`/verification-runs/${verificationRunId}/pull-requests`, { method: 'POST' });
  redirect(`/analysis-runs/${analysisRunId}`);
}

function ExternalLinkIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="h-3 w-3"
      aria-hidden="true"
    >
      <path d="M6 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8a1.5 1.5 0 0 0 1.5-1.5V10" />
      <path d="M9 2h5v5" />
      <path d="M14 2 7 9" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90"
      aria-hidden="true"
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

function CoverageDetail({ workspaces }: { workspaces: WorkspaceCoverage[] }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-fg-tertiary hover:text-fg-secondary">
        <ChevronIcon />
        Coverage detail
      </summary>
      <div className="mt-2 flex flex-col gap-3 border-l border-rule pl-3">
        {workspaces.map((workspace) => (
          <div key={workspace.workspacePath} className="flex flex-col gap-0.5 text-xs">
            <span className="font-mono text-fg-tertiary">
              {workspace.workspacePath || '.'} · {workspace.applicability}
            </span>
            <span className="text-fg-tertiary">{workspace.applicabilityReason}</span>
            <span className="text-fg-tertiary">
              {workspace.sourceFilesScanned} file(s) scanned
              {workspace.filesFailedToLoad.length > 0 &&
                ` · ${workspace.filesFailedToLoad.length} failed to load`}
              {workspace.ambiguousReferences.length > 0 &&
                ` · ${workspace.ambiguousReferences.length} ambiguous reference(s)`}
            </span>
            {workspace.ambiguousReferences.map((ref) => (
              <span key={`${ref.sourceFile}:${ref.line}`} className="font-mono text-fg-tertiary">
                Unresolved: {ref.sourceFile}:{ref.line}
              </span>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Diff rendering: a real per-file, line-numbered, gutter'd diff table --
// see DESIGN.md Section 20 for why this is hand-rolled rather than a
// dependency (the unified-diff format Patchwork produces is simple enough
// to parse directly, and every existing library either wants a browser
// runtime or brings its own opinionated CSS that would fight this file's
// zinc palette). Treated as a real evidence artifact, not `<pre>{text}</pre>`.
// ---------------------------------------------------------------------------

interface DiffLine {
  type: 'add' | 'del' | 'context';
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

interface DiffHunk {
  lines: DiffLine[];
}

interface DiffFile {
  path: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of diff.split('\n')) {
    if (line.startsWith('Index: ')) {
      currentFile = {
        path: line.slice('Index: '.length).trim(),
        hunks: [],
        additions: 0,
        deletions: 0,
      };
      files.push(currentFile);
      currentHunk = null;
      continue;
    }
    if (line.startsWith('===') || line.startsWith('--- ') || line.startsWith('+++ ')) continue;

    const hunkMatch = HUNK_HEADER_RE.exec(line);
    if (hunkMatch) {
      if (!currentFile) continue;
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[2]);
      currentHunk = { lines: [] };
      currentFile.hunks.push(currentHunk);
      continue;
    }

    if (!currentFile || !currentHunk) continue;
    if (line.startsWith('+')) {
      currentHunk.lines.push({ type: 'add', oldLine: null, newLine, text: line.slice(1) });
      newLine += 1;
      currentFile.additions += 1;
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({ type: 'del', oldLine, newLine: null, text: line.slice(1) });
      oldLine += 1;
      currentFile.deletions += 1;
    } else {
      const text = line.startsWith(' ') ? line.slice(1) : line;
      currentHunk.lines.push({ type: 'context', oldLine, newLine, text });
      oldLine += 1;
      newLine += 1;
    }
  }
  return files;
}

const DIFF_ROW_BG: Record<DiffLine['type'], string> = {
  add: 'bg-diff-add-bg',
  del: 'bg-diff-del-bg',
  context: '',
};

const DIFF_TEXT_COLOR: Record<DiffLine['type'], string> = {
  add: 'text-diff-add-fg',
  del: 'text-diff-del-fg',
  context: 'text-fg-tertiary',
};

const DIFF_MARKER: Record<DiffLine['type'], string> = { add: '+', del: '-', context: ' ' };

function DiffFileView({ file }: { file: DiffFile }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-rule">
      <div className="flex items-center justify-between border-b border-rule bg-evidence px-3 py-1.5">
        <span className="font-mono text-xs font-medium text-fg-secondary">{file.path}</span>
        <span className="font-mono text-xs">
          <span className="text-success">+{file.additions}</span>{' '}
          <span className="text-failure">-{file.deletions}</span>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-xs leading-relaxed">
          <tbody>
            {file.hunks.map((hunk, hunkIndex) => (
              <Fragment key={hunkIndex}>
                {hunkIndex > 0 && (
                  <tr aria-hidden="true">
                    <td colSpan={3} className="h-2 border-t border-rule" />
                  </tr>
                )}
                {hunk.lines.map((line, lineIndex) => (
                  <tr key={lineIndex} className={DIFF_ROW_BG[line.type]}>
                    <td className="select-none px-2 py-0.5 text-right text-fg-faint">
                      {line.oldLine ?? ''}
                    </td>
                    <td className="select-none px-2 py-0.5 text-right text-fg-faint">
                      {line.newLine ?? ''}
                    </td>
                    <td
                      className={`w-full px-2 py-0.5 whitespace-pre ${DIFF_TEXT_COLOR[line.type]}`}
                    >
                      {DIFF_MARKER[line.type]}
                      {line.text}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DiffView({ diff }: { diff: string }) {
  const files = parseDiff(diff);
  if (files.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {files.map((file) => (
        <DiffFileView key={file.path} file={file} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

const STEP_LABEL: Record<string, string> = {
  patch_apply: 'Patch apply',
  install: 'Install dependencies',
  typecheck: 'Typecheck',
  test: 'Tests',
};

/** The kinds a verification run always has a defined answer for, one way
 * or another -- either a real executed step, or (per CLAUDE.md's "never
 * imply a check ran when it did not") an explicit "Not run" row. Excludes
 * patch_apply, which is rendered faithfully from real steps only (it can
 * legitimately appear zero, one, or two times -- a dry-run check plus the
 * real apply -- and its absence is already explained by the run's own
 * status/failureReason). */
const CANONICAL_STEP_KINDS = ['install', 'typecheck', 'test'] as const;

function stepLabel(step: VerificationStep): string {
  if (step.kind === 'patch_apply') {
    return step.command.includes('--dry-run') ? 'Patch check' : 'Patch apply';
  }
  return STEP_LABEL[step.kind] ?? step.kind;
}

/** Appends an explicit "Not run" placeholder for every canonical step kind
 * missing from the real, persisted step list -- never silently omitted,
 * per DESIGN.md Section 34's zero-exception rule against implying a check
 * ran when it did not. */
function withNotRunSteps(steps: VerificationStep[]): VerificationStep[] {
  const presentKinds = new Set(steps.map((step) => step.kind));
  const notRun: VerificationStep[] = CANONICAL_STEP_KINDS.filter(
    (kind) => !presentKinds.has(kind),
  ).map((kind, index) => ({
    sequence: 10_000 + index,
    kind,
    command: '',
    status: 'SKIPPED',
    exitCode: null,
    timedOut: false,
    durationMs: null,
    stdoutExcerpt: null,
    stderrExcerpt: null,
    truncated: false,
    notRun: true,
  }));
  return [...steps, ...notRun];
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const VERIFICATION_STATUS_STYLE: Record<VerificationRunStatus, { dot: string; text: string }> = {
  PENDING: { dot: 'bg-mark-neutral', text: 'text-fg-tertiary' },
  RUNNING: { dot: 'animate-pulse bg-mark-indeterminate', text: 'text-indeterminate' },
  PASSED: { dot: 'bg-mark-success', text: 'text-success' },
  FAILED: { dot: 'bg-mark-failure', text: 'text-failure' },
  REFUSED: { dot: 'bg-mark-neutral', text: 'text-fg-tertiary' },
  TIMED_OUT: { dot: 'bg-mark-failure', text: 'text-failure' },
  INFRA_ERROR: { dot: 'bg-mark-failure', text: 'text-failure' },
};

const ACTIVE_VERIFICATION_STATUSES = new Set<VerificationRunStatus>(['PENDING', 'RUNNING']);
const RETRYABLE_VERIFICATION_STATUSES = new Set<VerificationRunStatus>([
  'FAILED',
  'TIMED_OUT',
  'INFRA_ERROR',
]);

function verificationStatusLabel(run: VerificationRun): string {
  switch (run.status) {
    case 'PENDING':
      return 'Queued for runtime verification';
    case 'RUNNING':
      return 'Verification running';
    case 'PASSED':
      return 'Runtime verification passed';
    case 'FAILED':
      return run.failureCategory === 'PATCH_FAILURE'
        ? 'Candidate patch could not be applied'
        : 'Runtime verification failed';
    case 'REFUSED':
      return 'Runtime verification not supported for this repository';
    case 'TIMED_OUT':
      return 'Verification exceeded the allowed time';
    case 'INFRA_ERROR':
      return 'Sandbox verification could not run';
  }
}

const PULL_REQUEST_STATUS_STYLE: Record<PullRequestAttemptStatus, { dot: string; text: string }> = {
  PENDING: { dot: 'bg-mark-neutral', text: 'text-fg-tertiary' },
  RUNNING: { dot: 'animate-pulse bg-mark-indeterminate', text: 'text-indeterminate' },
  OPENED: { dot: 'bg-mark-success', text: 'text-success' },
  REFUSED: { dot: 'bg-mark-neutral', text: 'text-fg-tertiary' },
  FAILED: { dot: 'bg-mark-failure', text: 'text-failure' },
};

const ACTIVE_PULL_REQUEST_STATUSES = new Set<PullRequestAttemptStatus>(['PENDING', 'RUNNING']);

function pullRequestStatusLabel(attempt: PullRequestAttempt): string {
  switch (attempt.status) {
    case 'PENDING':
      return 'Queued to publish to GitHub';
    case 'RUNNING':
      return 'Publishing to GitHub';
    case 'OPENED':
      return `Pull request #${attempt.githubPrNumber} opened`;
    case 'REFUSED':
      return attempt.failureCategory === 'STALE_BASE'
        ? 'Repository has changed since this fix was verified'
        : 'Publishing not supported for this patch attempt';
    case 'FAILED':
      switch (attempt.failureCategory) {
        case 'GITHUB_PERMISSION_FAILURE':
          return 'Patchwork lacks permission to publish to this repository';
        case 'GITHUB_RULESET_FAILURE':
          return 'Blocked by a GitHub branch protection rule';
        case 'BRANCH_COLLISION':
          return 'A branch with this name already exists';
        case 'PATCH_APPLICATION_FAILURE':
          return 'The candidate patch could not be applied to the current branch';
        case 'RATE_LIMITED':
          return 'GitHub rate limit reached while publishing';
        default:
          return 'Publishing to GitHub failed';
      }
  }
}

/** The Fix -> Verification -> Pull request pipeline for one AFFECTED
 * assessment, connected by one continuous left rail so the sequence reads
 * as a single artifact rather than three unrelated sections separated by
 * hairlines. Not a stepper: no numbered nodes, no click-to-navigate, just
 * the real content for each stage, always in order. */
function Pipeline({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 flex min-w-0 flex-col gap-5 border-l-2 border-rule-strong pl-5">
      {children}
    </div>
  );
}

type StageTone = 'neutral' | 'pending' | 'success' | 'failure';

const STAGE_DOT_COLOR: Record<StageTone, string> = {
  neutral: 'bg-mark-neutral',
  pending: 'animate-pulse bg-mark-indeterminate',
  success: 'bg-mark-success',
  failure: 'bg-mark-failure',
};

function Stage({
  label,
  tone = 'neutral',
  muted,
  children,
}: {
  label: string;
  tone?: StageTone;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${muted ? 'bg-mark-neutral' : STAGE_DOT_COLOR[tone]}`}
          aria-hidden="true"
        />
        <span
          className={`text-2xs font-semibold tracking-wide uppercase ${
            muted ? 'text-fg-faint' : 'text-fg-tertiary'
          }`}
        >
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

function Blocked({ reason }: { reason: string }) {
  return <span className="text-xs text-fg-tertiary">{reason}</span>;
}

/** Each stage's dot tone mirrors that stage's own real status -- the same
 * emerald/rose/slate/zinc roles already used everywhere else (Section 11),
 * just surfaced one level higher so the whole pipeline's health reads at a
 * glance without opening any of it. REFUSED is `neutral`, not `failure` --
 * it's a policy decision, not a broken attempt (Section 25). */
function fixStageTone(attempt: PatchAttempt | undefined): StageTone {
  if (!attempt) return 'neutral';
  if (attempt.status === 'GENERATED') return 'success';
  if (attempt.status === 'FAILED') return 'failure';
  return 'neutral';
}

function verificationStageTone(run: VerificationRun | undefined): StageTone {
  if (!run) return 'neutral';
  if (ACTIVE_VERIFICATION_STATUSES.has(run.status)) return 'pending';
  if (run.status === 'PASSED') return 'success';
  if (RETRYABLE_VERIFICATION_STATUSES.has(run.status)) return 'failure';
  return 'neutral';
}

function pullRequestStageTone(attempt: PullRequestAttempt | undefined): StageTone {
  if (!attempt) return 'neutral';
  if (ACTIVE_PULL_REQUEST_STATUSES.has(attempt.status)) return 'pending';
  if (attempt.status === 'OPENED') return 'success';
  if (attempt.status === 'FAILED') return 'failure';
  return 'neutral';
}

function PullRequestSection({
  analysisRunId,
  latestVerificationRun,
  pullRequestAttempts,
}: {
  analysisRunId: string;
  latestVerificationRun: VerificationRun | undefined;
  pullRequestAttempts: PullRequestAttempt[];
}) {
  const passedVerificationRunId =
    latestVerificationRun?.status === 'PASSED' ? latestVerificationRun.id : null;
  const [latest, ...earlier] = pullRequestAttempts;

  if (!latest && !passedVerificationRunId) {
    return <Blocked reason="Requires a passed verification" />;
  }

  const isActive = latest !== undefined && ACTIVE_PULL_REQUEST_STATUSES.has(latest.status);
  const canCreate =
    passedVerificationRunId !== null && (!latest || (!isActive && latest.status !== 'OPENED'));
  const isOpened = latest?.status === 'OPENED';
  const buttonVariant = !latest ? 'primary' : latest.status === 'REFUSED' ? 'quiet' : 'primary';

  return (
    <div className="flex flex-col gap-2">
      {!latest ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-tertiary">Not yet published</span>
          {passedVerificationRunId && (
            <form action={createPullRequest.bind(null, passedVerificationRunId, analysisRunId)}>
              <FormSubmitButton
                label="Create pull request"
                pendingLabel="Publishing…"
                variant={buttonVariant}
              />
            </form>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${PULL_REQUEST_STATUS_STYLE[latest.status].dot}`}
              aria-hidden="true"
            />
            <span
              className={`${isOpened ? 'text-sm font-semibold' : 'text-xs font-medium'} ${PULL_REQUEST_STATUS_STYLE[latest.status].text}`}
            >
              {isOpened && latest.githubPrUrl ? (
                <a
                  href={latest.githubPrUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:underline"
                >
                  {pullRequestStatusLabel(latest)}
                  <ExternalLinkIcon />
                </a>
              ) : (
                pullRequestStatusLabel(latest)
              )}
            </span>
            {canCreate && passedVerificationRunId && (
              <form action={createPullRequest.bind(null, passedVerificationRunId, analysisRunId)}>
                <FormSubmitButton
                  label="Create pull request"
                  pendingLabel="Publishing…"
                  variant={buttonVariant}
                />
              </form>
            )}
          </div>

          {latest.failureReason && (
            <span className="text-xs text-fg-tertiary">{latest.failureReason}</span>
          )}

          {isOpened && latest.branchName && (
            <span className="font-mono text-xs text-fg-tertiary">
              {latest.branchName}
              {latest.commitSha && ` @ ${latest.commitSha.slice(0, 7)}`}
            </span>
          )}
        </>
      )}

      {earlier.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-fg-tertiary hover:text-fg-secondary">
            <ChevronIcon />
            {earlier.length} earlier attempt{earlier.length === 1 ? '' : 's'}
          </summary>
          <div className="mt-2 flex flex-col gap-1.5 border-l border-rule pl-3">
            {earlier.map((attempt) => (
              <div key={attempt.id} className="flex items-center gap-2 text-xs">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${PULL_REQUEST_STATUS_STYLE[attempt.status].dot}`}
                  aria-hidden="true"
                />
                <span className={PULL_REQUEST_STATUS_STYLE[attempt.status].text}>
                  {pullRequestStatusLabel(attempt)}
                </span>
                <span className="text-fg-tertiary">
                  {new Date(attempt.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function StepOutputBlock({ label, text }: { label: string; text: string | null }) {
  if (!text) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium text-fg-tertiary">{label}</span>
      <pre className="overflow-x-auto rounded-md border border-rule bg-evidence px-2 py-1.5 font-mono text-2xs leading-relaxed text-fg-tertiary">
        {text}
      </pre>
    </div>
  );
}

function VerificationStepRow({ step }: { step: VerificationStep }) {
  const icon = step.status === 'PASSED' ? '✓' : step.status === 'SKIPPED' ? '–' : '✗';
  const color =
    step.status === 'PASSED'
      ? 'text-success'
      : step.status === 'SKIPPED'
        ? 'text-fg-tertiary'
        : 'text-failure';
  const hasOutput = step.status !== 'SKIPPED';
  const statusText = step.notRun
    ? 'Not run'
    : step.status === 'SKIPPED'
      ? 'Skipped'
      : step.status === 'PASSED'
        ? 'Passed'
        : 'Failed';

  return (
    <div className="flex flex-col gap-1 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className={`w-3 shrink-0 font-mono ${color}`} aria-hidden="true">
          {icon}
        </span>
        <span className={step.notRun ? 'text-fg-tertiary' : 'text-fg-secondary'}>
          {stepLabel(step)}
        </span>
        <span className="text-fg-tertiary">{statusText}</span>
        {step.durationMs != null && (
          <span className="text-fg-tertiary">{formatDuration(step.durationMs)}</span>
        )}
        {step.exitCode != null && step.exitCode !== 0 && (
          <span className="text-fg-tertiary">exit {step.exitCode}</span>
        )}
        {step.timedOut && <span className="text-fg-tertiary">timed out</span>}
      </div>
      {hasOutput && (step.stdoutExcerpt || step.stderrExcerpt) && (
        <details className="group ml-5">
          <summary className="cursor-pointer list-none text-fg-tertiary hover:text-fg">
            View output
          </summary>
          <div className="mt-1.5 flex flex-col gap-2">
            {step.truncated && (
              <span className="text-fg-tertiary">Output truncated by Patchwork.</span>
            )}
            <StepOutputBlock label="stdout" text={step.stdoutExcerpt} />
            <StepOutputBlock label="stderr" text={step.stderrExcerpt} />
          </div>
        </details>
      )}
    </div>
  );
}

function EnvironmentDetail({ run, commitSha }: { run: VerificationRun; commitSha: string }) {
  if (!run.sandboxProvider) return null;

  const nodeSourceLabel =
    run.nodeVersionSource === 'patchwork_default'
      ? 'Patchwork default, no repository version declared'
      : run.nodeVersionSource === 'repository'
        ? 'declared by repository'
        : null;

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-fg-tertiary hover:text-fg-secondary">
        <ChevronIcon />
        Environment
      </summary>
      <div className="mt-2 flex flex-col gap-0.5 border-l border-rule pl-3 text-xs text-fg-tertiary">
        <span className="font-mono">{commitSha.slice(0, 7)}</span>
        <span>
          {run.sandboxProvider}
          {run.sandboxRuntime && ` · ${run.sandboxRuntime}`}
        </span>
        {run.nodeVersion && (
          <span>
            Node {run.nodeVersion}
            {nodeSourceLabel && ` (${nodeSourceLabel})`}
          </span>
        )}
        {run.packageManager && <span>{run.packageManager}</span>}
        {run.manifestVersion && <span>manifest v{run.manifestVersion}</span>}
      </div>
    </details>
  );
}

function VerificationSection({
  patchAttemptId,
  analysisRunId,
  commitSha,
  verificationRuns,
}: {
  patchAttemptId: string;
  analysisRunId: string;
  commitSha: string;
  verificationRuns: VerificationRun[];
}) {
  const [latest, ...earlier] = verificationRuns;
  const isActive = latest !== undefined && ACTIVE_VERIFICATION_STATUSES.has(latest.status);
  const displaySteps = latest && latest.steps.length > 0 ? withNotRunSteps(latest.steps) : [];
  const buttonVariant =
    !latest || RETRYABLE_VERIFICATION_STATUSES.has(latest.status) ? 'primary' : 'quiet';

  return (
    <div className="flex flex-col gap-2">
      {!latest ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-tertiary">Not yet verified</span>
          <form action={verifyInSandbox.bind(null, patchAttemptId, analysisRunId)}>
            <FormSubmitButton
              label="Verify in sandbox"
              pendingLabel="Starting verification…"
              variant={buttonVariant}
            />
          </form>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${VERIFICATION_STATUS_STYLE[latest.status].dot}`}
              aria-hidden="true"
            />
            <span
              className={`text-sm font-semibold ${VERIFICATION_STATUS_STYLE[latest.status].text}`}
            >
              {verificationStatusLabel(latest)}
            </span>
            {!isActive && (
              <form action={verifyInSandbox.bind(null, patchAttemptId, analysisRunId)}>
                <FormSubmitButton
                  label="Verify again"
                  pendingLabel="Starting verification…"
                  variant={buttonVariant}
                />
              </form>
            )}
          </div>

          {latest.failureReason && (
            <span className="text-xs text-fg-tertiary">{latest.failureReason}</span>
          )}

          {displaySteps.length > 0 && (
            <div className="flex flex-col divide-y divide-rule">
              {displaySteps.map((step) => (
                <VerificationStepRow key={step.sequence} step={step} />
              ))}
            </div>
          )}

          <EnvironmentDetail run={latest} commitSha={commitSha} />
        </>
      )}

      {earlier.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-fg-tertiary hover:text-fg-secondary">
            <ChevronIcon />
            {earlier.length} earlier run{earlier.length === 1 ? '' : 's'}
          </summary>
          <div className="mt-2 flex flex-col gap-1.5 border-l border-rule pl-3">
            {earlier.map((run) => (
              <div key={run.id} className="flex items-center gap-2 text-xs">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${VERIFICATION_STATUS_STYLE[run.status].dot}`}
                  aria-hidden="true"
                />
                <span className={VERIFICATION_STATUS_STYLE[run.status].text}>
                  {verificationStatusLabel(run)}
                </span>
                <span className="text-fg-tertiary">{new Date(run.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function FixStageContent({
  assessment,
  analysisRunId,
  latestAttempt,
}: {
  assessment: AssessmentDetail;
  analysisRunId: string;
  latestAttempt: PatchAttempt | undefined;
}) {
  const buttonVariant =
    !latestAttempt || latestAttempt.status === 'REFUSED' || latestAttempt.status === 'FAILED'
      ? 'primary'
      : 'quiet';

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <form action={prepareFix.bind(null, assessment.id, analysisRunId)}>
        <FormSubmitButton
          label={latestAttempt ? 'Prepare fix again' : 'Prepare fix'}
          pendingLabel="Preparing…"
          variant={buttonVariant}
        />
      </form>

      {latestAttempt?.status === 'REFUSED' && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-tertiary">
            Automatic fix not supported for this usage.
          </span>
          {latestAttempt.refusalReason && (
            <span className="text-xs text-fg-tertiary">{latestAttempt.refusalReason}</span>
          )}
        </div>
      )}

      {latestAttempt?.status === 'FAILED' && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-attention">
            Could not generate a safe candidate fix.
          </span>
          {latestAttempt.failureReason && (
            <span className="text-xs text-fg-tertiary">{latestAttempt.failureReason}</span>
          )}
        </div>
      )}

      {latestAttempt?.status === 'GENERATED' && <PatchAttemptArtifact attempt={latestAttempt} />}
    </div>
  );
}

/** `detail` is always either a bare file path (the "source parses" check)
 * or `"<file path>: <specific finding>"` -- split it into the two so
 * checks can be grouped by file, matching the diff's and findings' own
 * file-first grouping (Section 20/21), instead of repeating the same
 * three check names once per changed file with no visual grouping, and
 * discarding real per-check evidence (`detail`) that was already there. */
function splitCheckDetail(detail: string): { file: string; note: string | null } {
  const separatorIndex = detail.indexOf(': ');
  if (separatorIndex === -1) return { file: detail, note: null };
  return { file: detail.slice(0, separatorIndex), note: detail.slice(separatorIndex + 2) };
}

/** Static validation and runtime verification are both evidence for "why
 * trust this patch" and share this same label/dot/summary shape (Section
 * 32) -- but static validation never runs code (Patchwork's own
 * deterministic checks against the transformation) while Verification
 * (below) is real sandboxed execution. Keeping the distinct label and
 * keeping this un-nested in the Fix stage rather than its own Pipeline
 * stage is what keeps that difference visible. */
function StaticValidation({ checks }: { checks: PostconditionCheck[] }) {
  const passed = checks.every((check) => check.passed);
  const byFile = new Map<string, PostconditionCheck[]>();
  for (const check of checks) {
    const { file } = splitCheckDetail(check.detail);
    const list = byFile.get(file) ?? [];
    list.push(check);
    byFile.set(file, list);
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${passed ? 'bg-mark-success' : 'bg-mark-attention'}`}
          aria-hidden="true"
        />
        <span className="text-2xs font-semibold tracking-wide text-fg-tertiary uppercase">
          Static validation
        </span>
      </div>
      <span className={`text-sm font-semibold ${passed ? 'text-success' : 'text-attention'}`}>
        {passed ? 'Static validation passed' : 'Static validation failed'}
      </span>
      <div className="flex flex-col gap-2">
        {[...byFile.entries()].map(([file, fileChecks]) => (
          <div key={file} className="flex flex-col gap-0.5">
            <span className="font-mono text-xs text-fg-tertiary">{file}</span>
            {fileChecks.map((check, index) => {
              const { note } = splitCheckDetail(check.detail);
              return (
                <span
                  key={index}
                  className={`pl-3 text-xs ${check.passed ? 'text-fg-tertiary' : 'text-attention'}`}
                >
                  {check.passed ? '✓' : '✗'} {check.name}
                  {note && <span className="text-fg-tertiary"> · {note}</span>}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function PatchAttemptArtifact({ attempt }: { attempt: PatchAttempt }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {attempt.diff && <DiffView diff={attempt.diff} />}
      {attempt.postconditionResult && attempt.postconditionResult.length > 0 && (
        <StaticValidation checks={attempt.postconditionResult} />
      )}
    </div>
  );
}

/** Findings grouped by source file -- file identity is the primary key
 * (matching the diff's own per-file grouping), with each matched location
 * rendered as a small two-line evidence unit: the exact location, then the
 * matched code fragment beneath it, mono throughout. */
function FindingsEvidence({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return null;
  const byFile = new Map<string, Finding[]>();
  for (const finding of findings) {
    const list = byFile.get(finding.sourceFile) ?? [];
    list.push(finding);
    byFile.set(finding.sourceFile, list);
  }

  return (
    <div className="flex flex-col divide-y divide-rule rounded-md border border-rule bg-evidence">
      {[...byFile.entries()].map(([sourceFile, fileFindings]) => (
        <div key={sourceFile} className="flex flex-col gap-1.5 px-3 py-2">
          <span className="font-mono text-xs font-medium text-fg-secondary">{sourceFile}</span>
          {fileFindings.map((finding) => (
            <div
              key={`${finding.sourceFile}:${finding.line}`}
              className="flex items-baseline gap-2 pl-3"
            >
              <span className="w-8 shrink-0 font-mono text-xs text-fg-faint">:{finding.line}</span>
              <span className="font-mono text-xs text-fg-tertiary">{finding.matchedSymbol}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

interface AssessmentSummary {
  countLabel: string | null;
  reason: string;
}

/**
 * The backend's `reason` string is real, correct evidence, but its prose
 * is analyzer output, not product copy: it always starts with an internal
 * `[workspace] STATUS: ` disambiguation prefix, and for AFFECTED it
 * restates the provider-change title (already the heading right above)
 * before the actual reason clause. Reconstructs the same underlying facts
 * -- a real usage count from `findings`, the real per-workspace
 * `applicabilityReason` already used by CoverageDetail -- into product
 * copy, changing presentation only. Falls back to the raw reason (prefix
 * stripped) whenever the structured data doesn't confidently match, so
 * this can never show something false, only occasionally less polished.
 */
function summarizeAssessment(assessment: AssessmentDetail): AssessmentSummary {
  const strippedReason = assessment.reason.replace(
    /^\[.*?\]\s*(AFFECTED|UNCERTAIN|NOT_AFFECTED):\s*/,
    '',
  );
  const workspaces = assessment.coverage?.workspaces ?? [];

  if (assessment.status === 'AFFECTED') {
    const applicable = workspaces.find((w) => w.applicability === 'APPLICABLE');
    const count = assessment.findings.length;
    const countLabel = count > 0 ? `${count} confirmed usage${count === 1 ? '' : 's'}` : null;
    return { countLabel, reason: applicable ? applicable.applicabilityReason : strippedReason };
  }
  if (assessment.status === 'UNCERTAIN') {
    const unknown = workspaces.find((w) => w.applicability === 'UNKNOWN');
    return { countLabel: null, reason: unknown ? unknown.applicabilityReason : strippedReason };
  }
  const notApplicable = workspaces.find((w) => w.applicability === 'NOT_APPLICABLE');
  return {
    countLabel: null,
    reason: notApplicable ? notApplicable.applicabilityReason : strippedReason,
  };
}

function AssessmentBlock({
  assessment,
  analysisRunId,
  commitSha,
}: {
  assessment: AssessmentDetail;
  analysisRunId: string;
  commitSha: string;
}) {
  const style = STATUS_STYLE[assessment.status];
  const latestAttempt = assessment.patchAttempts[0];
  const isAffected = assessment.status === 'AFFECTED';
  const isGenerated = latestAttempt?.status === 'GENERATED';
  const summary = summarizeAssessment(assessment);

  return (
    <div className={`min-w-0 ${isAffected ? 'rounded-md bg-surface p-5' : 'py-5'}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
        <span className={`shrink-0 text-xs font-medium ${style.text}`}>
          {STATUS_LABEL[assessment.status]}
        </span>
        <span
          className={`min-w-0 text-fg ${
            isAffected ? 'text-base font-semibold tracking-tight' : 'text-sm font-medium'
          }`}
        >
          {assessment.providerChangeTitle}
        </span>
        <a
          href={assessment.providerChangeSourceUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-fg-tertiary hover:text-fg"
          aria-label="View source"
        >
          <ExternalLinkIcon />
        </a>
      </div>

      <div className="mt-2 flex flex-col gap-0.5">
        {summary.countLabel && (
          <span className="text-xs font-medium text-fg-secondary">{summary.countLabel}</span>
        )}
        <p className="text-xs leading-relaxed text-fg-tertiary">{summary.reason}</p>
      </div>

      {assessment.findings.length > 0 && (
        <div className="mt-3">
          <FindingsEvidence findings={assessment.findings} />
        </div>
      )}

      <div className="mt-2">
        {assessment.coverage ? (
          <CoverageDetail workspaces={assessment.coverage.workspaces} />
        ) : (
          <span className="text-xs text-fg-tertiary">
            Coverage detail unavailable for this assessment.
          </span>
        )}
      </div>

      {isAffected && (
        <div className="mt-4 flex flex-col gap-1 border-l-2 border-rule-strong pl-3">
          <span className="text-xs font-medium text-fg-tertiary">Migration required</span>
          <p className="font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg-secondary">
            {assessment.migrationRequirement}
          </p>
        </div>
      )}

      {isAffected &&
        (!assessment.remediationSupported ? (
          <div className="mt-5 flex items-center gap-2 border-l-2 border-rule-strong pl-5">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-mark-neutral"
              aria-hidden="true"
            />
            <span className="text-2xs font-semibold tracking-wide text-fg-tertiary uppercase">
              Fix
            </span>
            <span className="text-xs text-fg-tertiary">
              Automatic fix not available for this change.
            </span>
          </div>
        ) : (
          <Pipeline>
            <Stage label="Fix" tone={fixStageTone(latestAttempt)}>
              <FixStageContent
                assessment={assessment}
                analysisRunId={analysisRunId}
                latestAttempt={latestAttempt}
              />
            </Stage>
            <Stage
              label="Verification"
              tone={verificationStageTone(latestAttempt?.verificationRuns[0])}
              muted={!isGenerated}
            >
              {isGenerated && latestAttempt ? (
                <VerificationSection
                  patchAttemptId={latestAttempt.id}
                  analysisRunId={analysisRunId}
                  commitSha={commitSha}
                  verificationRuns={latestAttempt.verificationRuns}
                />
              ) : (
                <Blocked reason="Requires a candidate fix" />
              )}
            </Stage>
            <Stage
              label="Pull request"
              tone={pullRequestStageTone(latestAttempt?.pullRequestAttempts[0])}
              muted={!isGenerated}
            >
              {isGenerated && latestAttempt ? (
                <PullRequestSection
                  analysisRunId={analysisRunId}
                  latestVerificationRun={latestAttempt.verificationRuns[0]}
                  pullRequestAttempts={latestAttempt.pullRequestAttempts}
                />
              ) : (
                <Blocked reason="Requires a candidate fix" />
              )}
            </Stage>
          </Pipeline>
        ))}
    </div>
  );
}

function NotAffectedGroup({
  assessments,
  analysisRunId,
  commitSha,
}: {
  assessments: AssessmentDetail[];
  analysisRunId: string;
  commitSha: string;
}) {
  if (assessments.length === 0) return null;
  return (
    <details className="group py-3">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-fg-tertiary hover:text-fg-secondary">
        <ChevronIcon />
        {assessments.length} check{assessments.length === 1 ? '' : 's'} with no impact
      </summary>
      <div className="mt-3 flex flex-col divide-y divide-rule border-l border-rule pl-4">
        {assessments.map((assessment) => (
          <AssessmentBlock
            key={assessment.id}
            assessment={assessment}
            analysisRunId={analysisRunId}
            commitSha={commitSha}
          />
        ))}
      </div>
    </details>
  );
}

function countByStatus(
  assessments: AssessmentDetail[],
): Record<AssessmentDetail['status'], number> {
  const counts: Record<AssessmentDetail['status'], number> = {
    AFFECTED: 0,
    UNCERTAIN: 0,
    NOT_AFFECTED: 0,
  };
  for (const assessment of assessments) counts[assessment.status] += 1;
  return counts;
}

function impactHeadline(counts: Record<AssessmentDetail['status'], number>): string {
  if (counts.AFFECTED > 0) {
    return `${counts.AFFECTED} change${counts.AFFECTED === 1 ? '' : 's'} affect${counts.AFFECTED === 1 ? 's' : ''} this repository`;
  }
  if (counts.UNCERTAIN > 0) {
    return `${counts.UNCERTAIN} change${counts.UNCERTAIN === 1 ? '' : 's'} could not be confirmed`;
  }
  return 'No changes affect this repository';
}

function ImpactSummary({ assessments }: { assessments: AssessmentDetail[] }) {
  const counts = countByStatus(assessments);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-base font-semibold tracking-tight text-fg">
        {impactHeadline(counts)}
      </span>
      <div className="flex flex-wrap items-center gap-4 text-xs">
        {(['AFFECTED', 'UNCERTAIN', 'NOT_AFFECTED'] as const)
          .filter((status) => counts[status] > 0)
          .map((status) => (
            <span
              key={status}
              className={`inline-flex items-center gap-1.5 ${STATUS_STYLE[status].text}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${STATUS_STYLE[status].dot}`}
                aria-hidden="true"
              />
              {counts[status]} {STATUS_LABEL[status].toLowerCase()}
            </span>
          ))}
      </div>
    </div>
  );
}

export default async function AnalysisRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const runResponse = await apiFetch(`/analysis-runs/${id}`);
  if (runResponse.status === 404) notFound();
  if (!runResponse.ok) {
    throw new Error(`Failed to load analysis run (${runResponse.status})`);
  }
  const { analysisRun } = (await runResponse.json()) as { analysisRun: AnalysisRunDetail };

  const assessments = [...analysisRun.assessments].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  );
  const visibleAssessments = assessments.filter((a) => a.status !== 'NOT_AFFECTED');
  const notAffectedAssessments = assessments.filter((a) => a.status === 'NOT_AFFECTED');
  const installedSdks = analysisRun.evidence?.installedSdks ?? [];

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-4xl flex-1 flex-col gap-6 px-6 pt-8 pb-16">
      <div className="flex flex-col gap-3">
        <Link href="/repositories" className="text-xs text-fg-tertiary hover:text-fg-secondary">
          ← Repositories
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">
            {analysisRun.repositoryFullName}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-tertiary">
            <span className="font-mono">{analysisRun.commitSha.slice(0, 7)}</span>
            <span>·</span>
            <span>{analysisRun.status}</span>
            {installedSdks.length === 1 && (
              <>
                <span>·</span>
                <span>{formatSdkEvidence(installedSdks[0])}</span>
              </>
            )}
          </div>
          {installedSdks.length > 1 && (
            <div className="flex flex-col gap-0.5">
              {installedSdks.map((sdk) => (
                <span
                  key={`${sdk.workspacePath}:${sdk.packageName}`}
                  className="font-mono text-xs text-fg-tertiary"
                >
                  {formatSdkEvidence(sdk)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {assessments.length > 0 && (
        <div className="border-t border-rule pt-6">
          <ImpactSummary assessments={assessments} />
        </div>
      )}

      <div className="flex min-w-0 flex-col divide-y divide-rule border-t border-rule">
        {assessments.length === 0 ? (
          <p className="py-6 text-sm text-fg-tertiary">
            No impact assessments yet for this analysis run.
          </p>
        ) : (
          <>
            {visibleAssessments.map((assessment) => (
              <AssessmentBlock
                key={assessment.id}
                assessment={assessment}
                analysisRunId={analysisRun.id}
                commitSha={analysisRun.commitSha}
              />
            ))}
            <NotAffectedGroup
              assessments={notAffectedAssessments}
              analysisRunId={analysisRun.id}
              commitSha={analysisRun.commitSha}
            />
          </>
        )}
      </div>
    </main>
  );
}

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
  AFFECTED: { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400' },
  UNCERTAIN: { dot: 'bg-slate-500', text: 'text-slate-600 dark:text-slate-400' },
  NOT_AFFECTED: { dot: 'bg-zinc-400 dark:bg-zinc-600', text: 'text-zinc-500 dark:text-zinc-400' },
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
    <details className="group mt-2">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
        <ChevronIcon />
        Coverage detail
      </summary>
      <div className="mt-2 flex flex-col gap-3 border-l border-zinc-200 pl-3 dark:border-zinc-800">
        {workspaces.map((workspace) => (
          <div key={workspace.workspacePath} className="flex flex-col gap-0.5 text-xs">
            <span className="font-mono text-zinc-600 dark:text-zinc-400">
              {workspace.workspacePath || '.'} · {workspace.applicability}
            </span>
            <span className="text-zinc-500 dark:text-zinc-500">
              {workspace.applicabilityReason}
            </span>
            <span className="text-zinc-500 dark:text-zinc-500">
              {workspace.sourceFilesScanned} file(s) scanned
              {workspace.filesFailedToLoad.length > 0 &&
                ` · ${workspace.filesFailedToLoad.length} failed to load`}
              {workspace.ambiguousReferences.length > 0 &&
                ` · ${workspace.ambiguousReferences.length} ambiguous reference(s)`}
            </span>
            {workspace.ambiguousReferences.map((ref) => (
              <span
                key={`${ref.sourceFile}:${ref.line}`}
                className="font-mono text-zinc-500 dark:text-zinc-500"
              >
                Unresolved: {ref.sourceFile}:{ref.line}
              </span>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}

function diffLineClassName(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-zinc-500 dark:text-zinc-500';
  if (line.startsWith('+')) return 'text-emerald-700 dark:text-emerald-400';
  if (line.startsWith('-')) return 'text-rose-700 dark:text-rose-400';
  if (line.startsWith('@@')) return 'text-zinc-500 dark:text-zinc-500';
  return 'text-zinc-600 dark:text-zinc-400';
}

function DiffBlock({ diff }: { diff: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-xs leading-relaxed dark:border-zinc-800 dark:bg-zinc-900">
      {diff
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line, index) => (
          <div key={index} className={diffLineClassName(line)}>
            {line}
          </div>
        ))}
    </pre>
  );
}

const STEP_LABEL: Record<string, string> = {
  patch_apply: 'Patch apply',
  install: 'Install dependencies',
  typecheck: 'Typecheck',
  test: 'Tests',
};

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const VERIFICATION_STATUS_STYLE: Record<VerificationRunStatus, { dot: string; text: string }> = {
  PENDING: { dot: 'bg-zinc-400 dark:bg-zinc-600', text: 'text-zinc-500 dark:text-zinc-400' },
  RUNNING: { dot: 'animate-pulse bg-slate-500', text: 'text-slate-600 dark:text-slate-400' },
  PASSED: { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400' },
  FAILED: { dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-400' },
  REFUSED: { dot: 'bg-zinc-400 dark:bg-zinc-600', text: 'text-zinc-500 dark:text-zinc-400' },
  TIMED_OUT: { dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-400' },
  INFRA_ERROR: { dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-400' },
};

const ACTIVE_VERIFICATION_STATUSES = new Set<VerificationRunStatus>(['PENDING', 'RUNNING']);

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
  PENDING: { dot: 'bg-zinc-400 dark:bg-zinc-600', text: 'text-zinc-500 dark:text-zinc-400' },
  RUNNING: { dot: 'animate-pulse bg-slate-500', text: 'text-slate-600 dark:text-slate-400' },
  OPENED: { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400' },
  REFUSED: { dot: 'bg-zinc-400 dark:bg-zinc-600', text: 'text-zinc-500 dark:text-zinc-400' },
  FAILED: { dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-400' },
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
  if (pullRequestAttempts.length === 0 && !passedVerificationRunId) return null;

  const [latest, ...earlier] = pullRequestAttempts;
  const isActive = latest !== undefined && ACTIVE_PULL_REQUEST_STATUSES.has(latest.status);
  const canCreate =
    passedVerificationRunId !== null && (!latest || (!isActive && latest.status !== 'OPENED'));

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-900">
      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Pull request</span>

      {!latest ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Not yet published</span>
          {passedVerificationRunId && (
            <form action={createPullRequest.bind(null, passedVerificationRunId, analysisRunId)}>
              <FormSubmitButton label="Create pull request" pendingLabel="Publishing…" />
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
              className={`text-xs font-medium ${PULL_REQUEST_STATUS_STYLE[latest.status].text}`}
            >
              {latest.status === 'OPENED' && latest.githubPrUrl ? (
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
                <FormSubmitButton label="Create pull request" pendingLabel="Publishing…" />
              </form>
            )}
          </div>

          {latest.failureReason && (
            <span className="text-xs text-zinc-500 dark:text-zinc-500">{latest.failureReason}</span>
          )}

          {latest.status === 'OPENED' && latest.branchName && (
            <span className="font-mono text-xs text-zinc-500 dark:text-zinc-500">
              {latest.branchName}
              {latest.commitSha && ` @ ${latest.commitSha.slice(0, 7)}`}
            </span>
          )}
        </>
      )}

      {earlier.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
            <ChevronIcon />
            {earlier.length} earlier attempt{earlier.length === 1 ? '' : 's'}
          </summary>
          <div className="mt-2 flex flex-col gap-1.5 border-l border-zinc-200 pl-3 dark:border-zinc-800">
            {earlier.map((attempt) => (
              <div key={attempt.id} className="flex items-center gap-2 text-xs">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${PULL_REQUEST_STATUS_STYLE[attempt.status].dot}`}
                  aria-hidden="true"
                />
                <span className={PULL_REQUEST_STATUS_STYLE[attempt.status].text}>
                  {pullRequestStatusLabel(attempt)}
                </span>
                <span className="text-zinc-400 dark:text-zinc-600">
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
      <span className="font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      <pre className="overflow-x-auto rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        {text}
      </pre>
    </div>
  );
}

function VerificationStepRow({ step }: { step: VerificationStep }) {
  const icon = step.status === 'PASSED' ? '✓' : step.status === 'SKIPPED' ? '–' : '✗';
  const color =
    step.status === 'PASSED'
      ? 'text-emerald-700 dark:text-emerald-400'
      : step.status === 'SKIPPED'
        ? 'text-zinc-400 dark:text-zinc-600'
        : 'text-rose-700 dark:text-rose-400';
  const hasOutput = step.status !== 'SKIPPED';

  return (
    <div className="flex flex-col gap-1 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className={`w-3 shrink-0 font-mono ${color}`} aria-hidden="true">
          {icon}
        </span>
        <span className="text-zinc-700 dark:text-zinc-300">
          {STEP_LABEL[step.kind] ?? step.kind}
        </span>
        <span className="text-zinc-400 dark:text-zinc-600">
          {step.status === 'SKIPPED' ? 'Skipped' : step.status === 'PASSED' ? 'Passed' : 'Failed'}
        </span>
        {step.durationMs != null && (
          <span className="text-zinc-400 dark:text-zinc-600">
            {formatDuration(step.durationMs)}
          </span>
        )}
        {step.exitCode != null && step.exitCode !== 0 && (
          <span className="text-zinc-400 dark:text-zinc-600">exit {step.exitCode}</span>
        )}
        {step.timedOut && <span className="text-zinc-400 dark:text-zinc-600">timed out</span>}
      </div>
      {hasOutput && (step.stdoutExcerpt || step.stderrExcerpt) && (
        <details className="group ml-5">
          <summary className="cursor-pointer list-none text-zinc-400 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300">
            View output
          </summary>
          <div className="mt-1.5 flex flex-col gap-2">
            {step.truncated && (
              <span className="text-zinc-400 dark:text-zinc-600">
                Output truncated by Patchwork.
              </span>
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
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
        <ChevronIcon />
        Environment
      </summary>
      <div className="mt-2 flex flex-col gap-0.5 border-l border-zinc-200 pl-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
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

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-900">
      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        Runtime verification
      </span>

      {!latest ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Not yet verified</span>
          <form action={verifyInSandbox.bind(null, patchAttemptId, analysisRunId)}>
            <FormSubmitButton label="Verify in sandbox" pendingLabel="Starting verification…" />
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
              className={`text-xs font-medium ${VERIFICATION_STATUS_STYLE[latest.status].text}`}
            >
              {verificationStatusLabel(latest)}
            </span>
            {!isActive && (
              <form action={verifyInSandbox.bind(null, patchAttemptId, analysisRunId)}>
                <FormSubmitButton label="Verify again" pendingLabel="Starting verification…" />
              </form>
            )}
          </div>

          {latest.failureReason && (
            <span className="text-xs text-zinc-500 dark:text-zinc-500">{latest.failureReason}</span>
          )}

          {latest.steps.length > 0 && (
            <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-900">
              {latest.steps.map((step) => (
                <VerificationStepRow key={step.sequence} step={step} />
              ))}
            </div>
          )}

          <EnvironmentDetail run={latest} commitSha={commitSha} />
        </>
      )}

      {earlier.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
            <ChevronIcon />
            {earlier.length} earlier run{earlier.length === 1 ? '' : 's'}
          </summary>
          <div className="mt-2 flex flex-col gap-1.5 border-l border-zinc-200 pl-3 dark:border-zinc-800">
            {earlier.map((run) => (
              <div key={run.id} className="flex items-center gap-2 text-xs">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${VERIFICATION_STATUS_STYLE[run.status].dot}`}
                  aria-hidden="true"
                />
                <span className={VERIFICATION_STATUS_STYLE[run.status].text}>
                  {verificationStatusLabel(run)}
                </span>
                <span className="text-zinc-400 dark:text-zinc-600">
                  {new Date(run.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function PatchAttemptResult({
  attempt,
  analysisRunId,
  commitSha,
}: {
  attempt: PatchAttempt;
  analysisRunId: string;
  commitSha: string;
}) {
  if (attempt.status === 'REFUSED') {
    return (
      <div className="mt-2 flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Automatic fix not supported for this usage.
        </span>
        {attempt.refusalReason && (
          <span className="text-xs text-zinc-500 dark:text-zinc-500">{attempt.refusalReason}</span>
        )}
      </div>
    );
  }

  if (attempt.status === 'FAILED') {
    return (
      <div className="mt-2 flex flex-col gap-1">
        <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
          Could not generate a safe candidate fix.
        </span>
        {attempt.failureReason && (
          <span className="text-xs text-zinc-500 dark:text-zinc-500">{attempt.failureReason}</span>
        )}
      </div>
    );
  }

  const staticChecksPassed = attempt.postconditionResult?.every((check) => check.passed) ?? true;

  return (
    <div className="mt-2 flex flex-col gap-2">
      <span className="text-xs font-medium text-zinc-950 dark:text-zinc-50">Candidate fix</span>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">
        Changed: {attempt.changedFiles.join(', ')}
      </span>
      {attempt.diff && <DiffBlock diff={attempt.diff} />}
      {attempt.postconditionResult && attempt.postconditionResult.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span
            className={`text-xs font-medium ${
              staticChecksPassed
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-amber-700 dark:text-amber-400'
            }`}
          >
            Static checks: {staticChecksPassed ? 'Passed' : 'Failed'}
          </span>
          {attempt.postconditionResult.map((check, index) => (
            <span
              key={`${index}-${check.name}`}
              className={`text-xs ${
                check.passed
                  ? 'text-zinc-500 dark:text-zinc-400'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              {check.passed ? '✓' : '✗'} {check.name}
            </span>
          ))}
        </div>
      )}
      <VerificationSection
        patchAttemptId={attempt.id}
        analysisRunId={analysisRunId}
        commitSha={commitSha}
        verificationRuns={attempt.verificationRuns}
      />
      <PullRequestSection
        analysisRunId={analysisRunId}
        latestVerificationRun={attempt.verificationRuns[0]}
        pullRequestAttempts={attempt.pullRequestAttempts}
      />
    </div>
  );
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

  return (
    <div className="flex flex-col gap-2 py-4">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
        <span className={`shrink-0 text-xs font-medium ${style.text}`}>
          {STATUS_LABEL[assessment.status]}
        </span>
        <span className="min-w-0 text-sm font-medium text-zinc-950 dark:text-zinc-50">
          {assessment.providerChangeTitle}
        </span>
        <a
          href={assessment.providerChangeSourceUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-zinc-400 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300"
          aria-label="View source"
        >
          <ExternalLinkIcon />
        </a>
      </div>

      <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        {assessment.reason}
      </p>

      {assessment.findings.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {assessment.findings.map((finding) => (
            <span
              key={`${finding.sourceFile}:${finding.line}`}
              className="font-mono text-xs text-zinc-600 dark:text-zinc-400"
            >
              {finding.sourceFile}:{finding.line}
              <span className="text-zinc-400 dark:text-zinc-600"> · </span>
              {finding.matchedSymbol}
            </span>
          ))}
        </div>
      )}

      {assessment.coverage ? (
        <CoverageDetail workspaces={assessment.coverage.workspaces} />
      ) : (
        <span className="mt-2 block text-xs text-zinc-500 dark:text-zinc-500">
          Coverage detail unavailable for this assessment.
        </span>
      )}

      {assessment.status === 'AFFECTED' && (
        <div className="mt-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
          <span className="block text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Migration requirement
          </span>
          <p className="mt-1 font-mono text-xs leading-relaxed whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
            {assessment.migrationRequirement}
          </p>
        </div>
      )}

      {assessment.status === 'AFFECTED' && assessment.remediationSupported && (
        <div className="mt-1">
          <form action={prepareFix.bind(null, assessment.id, analysisRunId)}>
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Prepare fix
            </button>
          </form>
          {latestAttempt && (
            <PatchAttemptResult
              attempt={latestAttempt}
              analysisRunId={analysisRunId}
              commitSha={commitSha}
            />
          )}
        </div>
      )}
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

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 pt-8 pb-16">
      <div className="flex flex-col gap-1">
        <Link
          href="/repositories"
          className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          ← Repositories
        </Link>
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-zinc-950 dark:text-zinc-50">
            {analysisRun.repositoryFullName}
          </span>
          <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {analysisRun.commitSha.slice(0, 7)}
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{analysisRun.status}</span>
        </div>
      </div>

      {analysisRun.evidence && analysisRun.evidence.installedSdks.length > 0 && (
        <div className="flex flex-col gap-0.5 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          {analysisRun.evidence.installedSdks.map((sdk) => (
            <span
              key={`${sdk.workspacePath}:${sdk.packageName}`}
              className="font-mono text-xs text-zinc-500 dark:text-zinc-400"
            >
              {sdk.workspacePath || '.'} · {sdk.packageName}@{sdk.resolvedVersion ?? 'unresolved'}{' '}
              (declared {sdk.declaredRange})
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-col divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {assessments.length === 0 ? (
          <p className="py-6 text-sm text-zinc-500 dark:text-zinc-400">
            No impact assessments yet for this analysis run.
          </p>
        ) : (
          assessments.map((assessment) => (
            <AssessmentBlock
              key={assessment.id}
              assessment={assessment}
              analysisRunId={analysisRun.id}
              commitSha={analysisRun.commitSha}
            />
          ))
        )}
      </div>
    </main>
  );
}

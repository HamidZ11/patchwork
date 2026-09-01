import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';

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

interface PatchAttempt {
  id: string;
  status: 'GENERATED' | 'REFUSED' | 'FAILED';
  refusalReason: string | null;
  failureReason: string | null;
  changedFiles: string[];
  diff: string | null;
  postconditionResult: PostconditionCheck[] | null;
  createdAt: string;
}

interface AssessmentDetail {
  id: string;
  status: 'AFFECTED' | 'NOT_AFFECTED' | 'UNCERTAIN';
  reason: string;
  coverage: { workspaces: WorkspaceCoverage[] };
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

function PatchAttemptResult({ attempt }: { attempt: PatchAttempt }) {
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
          Could not generate a verified fix.
        </span>
        {attempt.failureReason && (
          <span className="text-xs text-zinc-500 dark:text-zinc-500">{attempt.failureReason}</span>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
        Verified candidate fix
      </span>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">
        Changed: {attempt.changedFiles.join(', ')}
      </span>
      {attempt.diff && <DiffBlock diff={attempt.diff} />}
      {attempt.postconditionResult && attempt.postconditionResult.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {attempt.postconditionResult.map((check) => (
            <span
              key={check.name}
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
    </div>
  );
}

function AssessmentBlock({
  assessment,
  analysisRunId,
}: {
  assessment: AssessmentDetail;
  analysisRunId: string;
}) {
  const style = STATUS_STYLE[assessment.status];
  const latestAttempt = assessment.patchAttempts[0];

  return (
    <div className="flex flex-col gap-2 py-4">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
        <span className={`text-xs font-medium ${style.text}`}>
          {STATUS_LABEL[assessment.status]}
        </span>
        <span className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
          {assessment.providerChangeTitle}
        </span>
        <a
          href={assessment.providerChangeSourceUrl}
          target="_blank"
          rel="noreferrer"
          className="text-zinc-400 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300"
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

      <CoverageDetail workspaces={assessment.coverage.workspaces} />

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
          {latestAttempt && <PatchAttemptResult attempt={latestAttempt} />}
        </div>
      )}
    </div>
  );
}

export default async function AnalysisRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const me = await apiFetch('/auth/me');
  if (!me.ok) redirect('/');

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
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-16">
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
            />
          ))
        )}
      </div>
    </main>
  );
}

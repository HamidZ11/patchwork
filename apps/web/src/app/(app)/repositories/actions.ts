'use server';

import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';

/**
 * Analysis creation and impact assessment stay separate backend
 * capabilities (POST /repositories/:id/analyses, then POST
 * /analysis-runs/:id/impact-assessments) -- this only sequences the two
 * existing calls behind one button so the user sees a single coherent
 * action. If the second call fails, the AnalysisRun from the first call
 * is already persisted and stays; we redirect with an honest error
 * rather than implying the whole thing succeeded.
 *
 * Shared by the index and a repository's overview. Both arguments arrive
 * from the client as bound values, so neither is trusted: the API enforces
 * repository ownership, the id is encoded wherever it becomes a path, and
 * `returnTo` only selects between two server-built destinations -- it is
 * never itself a URL, so it cannot become an open redirect.
 */
export async function analyseRepository(repositoryId: string, returnTo: 'index' | 'repository') {
  const encodedId = encodeURIComponent(repositoryId);
  const destination = returnTo === 'repository' ? `/repositories/${encodedId}` : '/repositories';

  const analyseResponse = await apiFetch(`/repositories/${encodedId}/analyses`, {
    method: 'POST',
  });
  if (!analyseResponse.ok) {
    redirect(`${destination}?error=analysis_failed`);
  }
  const { analysisRun } = (await analyseResponse.json()) as { analysisRun: { id: string } };

  const impactResponse = await apiFetch(
    `/analysis-runs/${encodeURIComponent(analysisRun.id)}/impact-assessments`,
    { method: 'POST' },
  );
  if (!impactResponse.ok) {
    redirect(`${destination}?error=impact_assessment_failed`);
  }

  redirect(destination);
}

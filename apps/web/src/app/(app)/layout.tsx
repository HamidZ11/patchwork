import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { AppShell } from '@/components/app-shell';

/**
 * Every authenticated route lives under this route group and shares one
 * auth check + one shell (DESIGN.md Section 5) -- the signed-out landing
 * page (`app/page.tsx`) sits outside it and stays shell-less on purpose
 * (Section 6). Fetching the user here, once, also replaces the identical
 * `/auth/me` check each page used to run for itself.
 */
export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const meResponse = await apiFetch('/auth/me');
  if (!meResponse.ok) redirect('/');
  const { user } = (await meResponse.json()) as {
    user: { githubLogin: string; avatarUrl: string | null };
  };

  return <AppShell user={user}>{children}</AppShell>;
}

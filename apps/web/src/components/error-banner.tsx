const ERROR_MESSAGES: Record<string, string> = {
  oauth_denied: 'GitHub sign-in was cancelled.',
  oauth_failed: 'Something went wrong signing in with GitHub. Please try again.',
  install_failed: 'Something went wrong connecting your GitHub account. Please try again.',
  install_state_invalid: 'That connection link expired or was already used. Please try again.',
  install_pending_approval:
    'Your GitHub organization requires admin approval before Patchwork can access repositories. Ask an admin to approve the request.',
  analysis_failed: 'Something went wrong analysing that repository. Please try again.',
  impact_assessment_failed:
    'The repository was analysed, but checking Stripe impact failed. Try analysing again.',
};

const DEFAULT_MESSAGE = 'Something went wrong. Please try again.';

export function ErrorBanner({ code }: { code?: string }) {
  if (!code) return null;

  return (
    <div className="border-warning-rule bg-warning-surface text-warning-fg w-full max-w-md rounded-md border px-4 py-3 text-sm">
      {ERROR_MESSAGES[code] ?? DEFAULT_MESSAGE}
    </div>
  );
}

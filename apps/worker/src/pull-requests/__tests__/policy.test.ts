import { describe, expect, it } from 'vitest';
import { deriveBranchName, deriveCommitMessage, derivePrBody, derivePrTitle } from '../policy.js';
import type { PublishContext } from '../types.js';

function fixtureContext(overrides: Partial<PublishContext> = {}): PublishContext {
  return {
    patchAttemptId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    impactAssessmentId: 'assess-1',
    patchAttemptStatus: 'GENERATED',
    diff: '--- a\n+++ b\n',
    changedFiles: ['src/services/invoiceService.ts'],
    transformationKind: 'stripe_invoice_subscription_to_parent',
    postconditionChecks: [
      { name: 'old affected pattern absent', passed: true },
      { name: 'replacement pattern present', passed: true },
    ],
    verificationRunId: 'run-1',
    verificationRunStatus: 'PASSED',
    verificationDiffSha256: 'deadbeef',
    verificationSteps: [
      { kind: 'patch_apply', status: 'PASSED', exitCode: 0 },
      { kind: 'install', status: 'PASSED', exitCode: 0 },
      { kind: 'typecheck', status: 'PASSED', exitCode: 0 },
      { kind: 'test', status: 'PASSED', exitCode: 0 },
    ],
    nodeVersion: '20',
    nodeVersionSource: 'patchwork_default',
    packageManager: 'npm',
    sandboxRuntime: 'patchwork-verification-node20',
    repositoryOwner: 'octocat',
    repositoryName: 'hello-world',
    repositoryFullName: 'octocat/hello-world',
    githubInstallationId: 123,
    defaultBranch: 'main',
    analysedCommitSha: 'a'.repeat(40),
    providerChangeTitle:
      'Removes Invoice.subscription in favor of Invoice.parent.subscription_details.subscription',
    providerChangeSourceUrl:
      'https://docs.stripe.com/changelog/basil/2025-03-31/adds-new-parent-field-to-invoicing-objects',
    providerChangeExternalId: 'basil-2025-03-31-adds-new-parent-field-to-invoicing-objects',
    migrationRequirement: 'Use invoice.parent.subscription_details.subscription instead.',
    ...overrides,
  };
}

describe('deriveBranchName', () => {
  it('is deterministic and safe-Git-ref-characters', () => {
    const name = deriveBranchName(
      'stripe_invoice_subscription_to_parent',
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    );
    expect(name).toBe('patchwork/stripe-invoice-subscription-to-parent/a1b2c3d4');
    expect(name).toMatch(/^[a-zA-Z0-9/_-]+$/);
  });

  it('produces the same name for the same inputs every time', () => {
    const a = deriveBranchName(
      'stripe_invoice_subscription_to_parent',
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    );
    const b = deriveBranchName(
      'stripe_invoice_subscription_to_parent',
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    );
    expect(a).toBe(b);
  });

  it('produces different names for different patch attempts (collision resistance)', () => {
    const a = deriveBranchName(
      'stripe_invoice_subscription_to_parent',
      'a1b2c3d4-0000-0000-0000-000000000000',
    );
    const b = deriveBranchName(
      'stripe_invoice_subscription_to_parent',
      'ffffffff-0000-0000-0000-000000000000',
    );
    expect(a).not.toBe(b);
  });

  it('sanitizes unsafe characters and bounds length', () => {
    const name = deriveBranchName(
      'Weird!! Kind//Of Value..',
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    );
    expect(name).toMatch(/^patchwork\/[a-z0-9-]+\/[0-9a-f]{8}$/);
  });

  it('never leaves a trailing/leading dash in the slug', () => {
    const name = deriveBranchName(
      '___leading_and_trailing___',
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    );
    const slug = name.split('/')[1];
    expect(slug?.startsWith('-')).toBe(false);
    expect(slug?.endsWith('-')).toBe(false);
  });
});

describe('derivePrTitle', () => {
  it('is specific, not generic', () => {
    const title = derivePrTitle(fixtureContext());
    expect(title).toContain('Invoice.subscription');
    expect(title.toLowerCase()).not.toContain('automated fix');
  });
});

describe('derivePrBody', () => {
  it('includes real changed files, source URL, and safety note', () => {
    const body = derivePrBody(fixtureContext(), {
      branchName: 'patchwork/stripe-invoice-subscription-to-parent/a1b2c3d4',
      commitSha: 'b'.repeat(40),
    });
    expect(body).toContain('src/services/invoiceService.ts');
    expect(body).toContain('https://docs.stripe.com/changelog');
    expect(body).toContain('No code was auto-merged or deployed');
    expect(body).toContain('Patchwork-Patch: a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  });

  it('states exact exit-code evidence, never a blanket "all tests passed"', () => {
    const body = derivePrBody(fixtureContext(), {
      branchName: 'patchwork/x/y',
      commitSha: 'b'.repeat(40),
    });
    expect(body).toContain('Repository script `install` exited 0.');
    expect(body).toContain('Repository script `typecheck` exited 0.');
    expect(body).toContain('Repository script `test` exited 0.');
    expect(body.toLowerCase()).not.toContain('all tests passed');
  });

  it('reflects a failed step honestly rather than claiming success', () => {
    const context = fixtureContext({
      verificationSteps: [
        { kind: 'patch_apply', status: 'PASSED', exitCode: 0 },
        { kind: 'install', status: 'PASSED', exitCode: 0 },
        { kind: 'typecheck', status: 'PASSED', exitCode: 0 },
        { kind: 'test', status: 'FAILED', exitCode: 1 },
      ],
    });
    const body = derivePrBody(context, { branchName: 'patchwork/x/y', commitSha: 'b'.repeat(40) });
    expect(body).toContain('✗ Repository script `test` exited 1.');
  });

  it('labels a Patchwork-default Node version distinctly from a repository-declared one', () => {
    const body = derivePrBody(fixtureContext(), {
      branchName: 'patchwork/x/y',
      commitSha: 'b'.repeat(40),
    });
    expect(body).toContain('Node 20 (Patchwork default)');
  });

  it('never includes raw sandbox log content', () => {
    const context = fixtureContext();
    const body = derivePrBody(context, { branchName: 'patchwork/x/y', commitSha: 'b'.repeat(40) });
    // Only step-level pass/fail + exit code appear -- no stdout/stderr field exists on PublishContext at all.
    expect(body).not.toContain('stdout');
    expect(body).not.toContain('stderr');
  });
});

describe('deriveCommitMessage', () => {
  it('includes the provider-change and patch-attempt trailers', () => {
    const message = deriveCommitMessage(fixtureContext());
    expect(message).toContain(
      'Patchwork-Change: basil-2025-03-31-adds-new-parent-field-to-invoicing-objects',
    );
    expect(message).toContain('Patchwork-Patch: a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  });
});

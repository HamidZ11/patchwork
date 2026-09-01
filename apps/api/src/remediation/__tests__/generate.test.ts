import { describe, expect, it } from 'vitest';
import { fakeGitHubAppAuth, fakeGitHubClientWithArchive } from '../../__tests__/fixtures.js';
import { generatePatchAttempt, type AssessmentForRemediation } from '../generate.js';

const STRIPE_IMPORT = "import Stripe from 'stripe';";
const PREDICATE_KIND = 'stripe_invoice_subscription_property';

function baseAssessment(
  overrides: Partial<AssessmentForRemediation> = {},
): AssessmentForRemediation {
  return {
    status: 'AFFECTED',
    predicateKind: PREDICATE_KIND,
    repositoryOwner: 'octocat',
    repositoryName: 'hello-world',
    githubInstallationId: 1,
    commitSha: 'a'.repeat(40),
    findings: [
      {
        workspacePath: '',
        sourceFile: 'src/billing.ts',
        line: 5,
        matchedSymbol: 'invoice.subscription',
      },
    ],
    ...overrides,
  };
}

function billingFile(bodyLine: string): Record<string, string> {
  return {
    'package.json': JSON.stringify({ dependencies: { stripe: '^18.0.0' } }),
    'src/billing.ts': [
      STRIPE_IMPORT,
      "const stripe = new Stripe('sk_test');",
      'async function run(id: string) {',
      '  const invoice = await stripe.invoices.retrieve(id);',
      `  ${bodyLine}`,
      '}',
    ].join('\n'),
  };
}

describe('generatePatchAttempt', () => {
  it('refuses a non-AFFECTED assessment before touching the archive', async () => {
    const client = fakeGitHubClientWithArchive({});
    const result = await generatePatchAttempt(baseAssessment({ status: 'UNCERTAIN' }), {
      client,
      appAuth: fakeGitHubAppAuth(),
    });
    expect(result.status).toBe('REFUSED');
    expect(result.refusalReason).toMatch(/not AFFECTED/i);
  });

  it('refuses an assessment for an unsupported rule', async () => {
    const client = fakeGitHubClientWithArchive({});
    const result = await generatePatchAttempt(
      baseAssessment({ predicateKind: 'some_other_rule' }),
      {
        client,
        appAuth: fakeGitHubAppAuth(),
      },
    );
    expect(result.status).toBe('REFUSED');
    expect(result.refusalReason).toMatch(/no supported deterministic remediation/i);
  });

  it('refuses an assessment with no findings', async () => {
    const client = fakeGitHubClientWithArchive({});
    const result = await generatePatchAttempt(baseAssessment({ findings: [] }), {
      client,
      appAuth: fakeGitHubAppAuth(),
    });
    expect(result.status).toBe('REFUSED');
    expect(result.refusalReason).toMatch(/no findings/i);
  });

  it('refuses a forbidden path without downloading anything', async () => {
    const result = await generatePatchAttempt(
      baseAssessment({
        findings: [{ workspacePath: '', sourceFile: 'package.json', line: 1, matchedSymbol: 'x' }],
      }),
      {
        client: fakeGitHubClientWithArchive({}),
        appAuth: fakeGitHubAppAuth(),
      },
    );
    expect(result.status).toBe('REFUSED');
    expect(result.refusalReason).toMatch(/forbidden path/i);
  });

  it('fails (not refuses) when archive acquisition throws', async () => {
    const client = fakeGitHubClientWithArchive(
      {},
      {
        downloadRepositoryArchive: async () => {
          throw new Error('network error');
        },
      },
    );
    const result = await generatePatchAttempt(baseAssessment(), {
      client,
      appAuth: fakeGitHubAppAuth(),
    });
    expect(result.status).toBe('FAILED');
    expect(result.failureReason).toMatch(/could not acquire/i);
  });

  it("refuses when the finding's source file is missing from the snapshot", async () => {
    const client = fakeGitHubClientWithArchive({
      'package.json': JSON.stringify({ dependencies: { stripe: '^18.0.0' } }),
      // src/billing.ts intentionally absent
    });
    const result = await generatePatchAttempt(baseAssessment(), {
      client,
      appAuth: fakeGitHubAppAuth(),
    });
    expect(result.status).toBe('REFUSED');
    expect(result.refusalReason).toMatch(/not found in the analysed snapshot/i);
  });

  it('generates a verified patch end to end for a supported, single-file assessment', async () => {
    const client = fakeGitHubClientWithArchive(billingFile('return invoice.subscription;'));
    const result = await generatePatchAttempt(baseAssessment(), {
      client,
      appAuth: fakeGitHubAppAuth(),
    });
    expect(result.status).toBe('GENERATED');
    expect(result.changedFiles).toEqual(['src/billing.ts']);
    expect(result.diff).toContain(
      '+  return (invoice.parent?.subscription_details?.subscription ?? null);',
    );
    expect(result.postconditionResult?.every((c) => c.passed)).toBe(true);
  });

  it('generates a verified patch spanning multiple files for one assessment', async () => {
    const client = fakeGitHubClientWithArchive({
      'package.json': JSON.stringify({ dependencies: { stripe: '^18.0.0' } }),
      'src/billing.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'async function run(id: string) {',
        '  const invoice = await stripe.invoices.retrieve(id);',
        '  return invoice.subscription;',
        '}',
      ].join('\n'),
      'src/reports.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'async function reportOn(id: string) {',
        '  const invoice = await stripe.invoices.retrieve(id);',
        '  return invoice.subscription;',
        '}',
      ].join('\n'),
    });

    const result = await generatePatchAttempt(
      baseAssessment({
        findings: [
          {
            workspacePath: '',
            sourceFile: 'src/billing.ts',
            line: 5,
            matchedSymbol: 'invoice.subscription',
          },
          {
            workspacePath: '',
            sourceFile: 'src/reports.ts',
            line: 5,
            matchedSymbol: 'invoice.subscription',
          },
        ],
      }),
      { client, appAuth: fakeGitHubAppAuth() },
    );

    expect(result.status).toBe('GENERATED');
    expect(result.changedFiles.sort()).toEqual(['src/billing.ts', 'src/reports.ts']);
    expect(result.diff).toContain('src/billing.ts');
    expect(result.diff).toContain('src/reports.ts');
  });

  it('refuses the whole attempt if one of several findings is unsafe -- never a partial patch', async () => {
    const client = fakeGitHubClientWithArchive({
      'package.json': JSON.stringify({ dependencies: { stripe: '^18.0.0' } }),
      'src/billing.ts': [
        STRIPE_IMPORT,
        "const stripe = new Stripe('sk_test');",
        'async function run(id: string) {',
        '  const invoice = await stripe.invoices.retrieve(id);',
        '  const a = invoice.subscription;',
        "  invoice.subscription = 'oops';",
        '  return a;',
        '}',
      ].join('\n'),
    });

    const result = await generatePatchAttempt(
      baseAssessment({
        findings: [
          {
            workspacePath: '',
            sourceFile: 'src/billing.ts',
            line: 5,
            matchedSymbol: 'invoice.subscription',
          },
          {
            workspacePath: '',
            sourceFile: 'src/billing.ts',
            line: 6,
            matchedSymbol: 'invoice.subscription',
          },
        ],
      }),
      { client, appAuth: fakeGitHubAppAuth() },
    );

    expect(result.status).toBe('REFUSED');
    expect(result.refusalReason).toMatch(/write target/i);
    expect(result.changedFiles).toEqual([]);
  });
});

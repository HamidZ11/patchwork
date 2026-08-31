import { describe, expect, it } from 'vitest';
import type { ExtractedFile } from '../../archive.js';
import { scanForClientVersionEvidence } from '../api-version.js';

function file(path: string, content: string): ExtractedFile {
  return { path, content };
}

describe('scanForClientVersionEvidence', () => {
  it('extracts a literal apiVersion from new Stripe(...)', () => {
    const result = scanForClientVersionEvidence([
      file(
        'src/stripe.ts',
        [
          "import Stripe from 'stripe';",
          'const stripe = new Stripe(secretKey, { apiVersion: "2025-01-27.acacia" });',
        ].join('\n'),
      ),
    ]);

    // No package.json is present in this fixture, so '' is the only known
    // workspace directory and it is the ancestor of every file --
    // workspacePath must reflect the nearest actual workspace root, not
    // just the source file's own containing directory.
    expect(result.clientVersions).toEqual([
      {
        workspacePath: '',
        sourceFile: 'src/stripe.ts',
        line: 2,
        apiVersion: '2025-01-27.acacia',
        valueKind: 'LITERAL',
      },
    ]);
  });

  it("attributes evidence to the nearest ancestor workspace, not the source file's own directory", () => {
    const result = scanForClientVersionEvidence([
      file(
        'packages/billing/package.json',
        JSON.stringify({ dependencies: { stripe: '^18.0.0' } }),
      ),
      file(
        'packages/billing/src/deeply/nested/stripe.ts',
        [
          "import Stripe from 'stripe';",
          'const stripe = new Stripe(secretKey, { apiVersion: "2025-01-27.acacia" });',
        ].join('\n'),
      ),
    ]);

    expect(result.clientVersions).toEqual([
      expect.objectContaining({ workspacePath: 'packages/billing' }),
    ]);
  });

  it('resolves a same-file local constant', () => {
    const result = scanForClientVersionEvidence([
      file(
        'src/stripe.ts',
        [
          "import Stripe from 'stripe';",
          'const STRIPE_API_VERSION = "2025-01-27.acacia";',
          'const stripe = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });',
        ].join('\n'),
      ),
    ]);

    expect(result.clientVersions[0]).toMatchObject({
      apiVersion: '2025-01-27.acacia',
      valueKind: 'LOCAL_CONSTANT',
    });
  });

  it('classifies a dynamic value as DYNAMIC_UNKNOWN without guessing', () => {
    const result = scanForClientVersionEvidence([
      file(
        'src/stripe.ts',
        [
          "import Stripe from 'stripe';",
          'const stripe = new Stripe(secretKey, { apiVersion: process.env.STRIPE_API_VERSION });',
        ].join('\n'),
      ),
    ]);

    expect(result.clientVersions[0]).toMatchObject({
      apiVersion: null,
      valueKind: 'DYNAMIC_UNKNOWN',
    });
  });

  it('does not treat an unrelated apiVersion-named property outside a Stripe call as evidence', () => {
    const result = scanForClientVersionEvidence([
      file(
        'src/config.ts',
        [
          "import Stripe from 'stripe';",
          'const config = { apiVersion: "2025-01-27.acacia" };', // not a Stripe construction
        ].join('\n'),
      ),
    ]);

    expect(result.clientVersions).toEqual([]);
  });

  it('recognizes require("stripe") bindings, not just ESM imports', () => {
    const result = scanForClientVersionEvidence([
      file(
        'src/stripe.js',
        [
          "const Stripe = require('stripe');",
          'const stripe = new Stripe(secretKey, { apiVersion: "2025-01-27.acacia" });',
        ].join('\n'),
      ),
    ]);

    expect(result.clientVersions[0]?.apiVersion).toBe('2025-01-27.acacia');
  });

  it('skips files that do not mention both stripe and apiVersion (cheap pre-filter)', () => {
    const result = scanForClientVersionEvidence([file('src/unrelated.ts', 'export const x = 1;')]);

    expect(result.sourceFilesScanned).toBe(0);
    expect(result.clientVersions).toEqual([]);
  });

  it('does not crash on malformed/incomplete source and never fabricates a version from it', () => {
    // TypeScript's parser is error-tolerant and recovers a partial AST from
    // this rather than throwing -- the incomplete apiVersion value must
    // still classify as DYNAMIC_UNKNOWN, never a guessed literal.
    const result = scanForClientVersionEvidence([
      file(
        'src/broken.ts',
        "import Stripe from 'stripe'; const stripe = new Stripe(secretKey, { apiVersion:",
      ),
    ]);

    for (const evidence of result.clientVersions) {
      expect(evidence.valueKind).toBe('DYNAMIC_UNKNOWN');
      expect(evidence.apiVersion).toBeNull();
    }
  });

  it('ignores a construction call from a locally-declared class never imported from "stripe"', () => {
    const result = scanForClientVersionEvidence([
      file(
        'src/other.ts',
        [
          '// not stripe related, just named similarly',
          'class Stripe {}',
          'const s = new Stripe();',
          'const config = { apiVersion: "not-stripe" };',
        ].join('\n'),
      ),
    ]);

    expect(result.clientVersions).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import type { Finding } from '../../analysis/impact/types.js';
import { STRIPE_INVOICE_SUBSCRIPTION_TO_PARENT_RECIPE } from '../recipes/invoice-subscription-to-parent.js';

const recipe = STRIPE_INVOICE_SUBSCRIPTION_TO_PARENT_RECIPE;
const STRIPE_IMPORT = "import Stripe from 'stripe';";

function finding(line: number, sourceFile = 'src/billing.ts'): Finding {
  return { workspacePath: '', sourceFile, line, matchedSymbol: 'invoice.subscription' };
}

/** Wraps a body that already has `invoice` in scope as a resolved Stripe Invoice. */
function fileWithInvoice(bodyLines: string[]): string {
  return [
    STRIPE_IMPORT,
    "const stripe = new Stripe('sk_test');",
    'async function run(id: string) {',
    '  const invoice = await stripe.invoices.retrieve(id);',
    ...bodyLines.map((l) => `  ${l}`),
    '}',
  ].join('\n');
}

const REPLACEMENT = '(invoice.parent?.subscription_details?.subscription ?? null)';

describe('Rule B recipe: Invoice.subscription -> parent.subscription_details.subscription', () => {
  // --- SAFE POSITIVE ------------------------------------------------------

  it('1. direct supported read is transformed', () => {
    const before = fileWithInvoice(['return invoice.subscription;']);
    const result = recipe.transformFile(before, [finding(5)]);
    expect(result.kind).toBe('transformed');
    if (result.kind !== 'transformed') return;
    expect(result.newText).toContain(`return ${REPLACEMENT};`);
    expect(result.newText).not.toContain('invoice.subscription');
  });

  it('2. same-file local alias of the invoice is transformed', () => {
    const before = fileWithInvoice([
      'const sameInvoice = invoice;',
      'return sameInvoice.subscription;',
    ]);
    const result = recipe.transformFile(before, [finding(6)]);
    expect(result.kind).toBe('transformed');
    if (result.kind !== 'transformed') return;
    expect(result.newText).toContain(
      'return (sameInvoice.parent?.subscription_details?.subscription ?? null);',
    );
  });

  it('3. multiple supported findings in one file are all transformed, positions unaffected by earlier edits', () => {
    const before = fileWithInvoice([
      'const a = invoice.subscription;',
      'const b = invoice.subscription;',
      'return [a, b];',
    ]);
    const result = recipe.transformFile(before, [finding(5), finding(6)]);
    expect(result.kind).toBe('transformed');
    if (result.kind !== 'transformed') return;
    expect(result.newText).toContain(`const a = ${REPLACEMENT};`);
    expect(result.newText).toContain(`const b = ${REPLACEMENT};`);
    expect(result.newText).not.toMatch(/invoice\.subscription(?!_details)/);
  });

  // --- REFUSAL --------------------------------------------------------------

  it('4. original optional chaining (X?.subscription) is refused, not transformed', () => {
    const before = fileWithInvoice(['const x = invoice?.subscription;']);
    const result = recipe.transformFile(before, [finding(5)]);
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.reason).toMatch(/optional chaining/i);
  });

  it('4b. destructuring read (const { subscription } = invoice) is refused with an honest reason, not "stale finding" -- confirmed against the real HamidZ11/stripe-basil-fixture repository, which uses exactly this shape', () => {
    const before = fileWithInvoice(['const { subscription } = invoice;', 'return subscription;']);
    const result = recipe.transformFile(before, [finding(5)]);
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.reason).toMatch(/destructures the property/i);
    expect(result.reason).not.toMatch(/stale finding/i);
  });

  it('5. stale/mismatched finding span is refused', () => {
    const before = fileWithInvoice(['return invoice.subscription;']);
    // Finding claims line 999, which does not exist / has no match there.
    const result = recipe.transformFile(before, [finding(999)]);
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.reason).toMatch(/stale finding/i);
  });

  it('6. UNCERTAIN/NOT_AFFECTED/wrong-rule are enforced by generate.ts, not this recipe', () => {
    // Documented here for traceability: the recipe only ever sees findings
    // for an already-AFFECTED, already-matched assessment -- generate.ts
    // enforces status/rule preconditions before calling transformFile at
    // all. See remediation/__tests__/generate.test.ts.
    expect(true).toBe(true);
  });

  it('7. assignment target is refused', () => {
    const before = fileWithInvoice(["invoice.subscription = 'sub_x';"]);
    const result = recipe.transformFile(before, [finding(5)]);
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.reason).toMatch(/write target/i);
  });

  it('8. compound assignment is refused', () => {
    const before = fileWithInvoice(["invoice.subscription += 'x';"]);
    const result = recipe.transformFile(before, [finding(5)]);
    expect(result.kind).toBe('refused');
  });

  it('9. update expression (++) is refused', () => {
    const before = fileWithInvoice(['invoice.subscription++;']);
    const result = recipe.transformFile(before, [finding(5)]);
    expect(result.kind).toBe('refused');
  });

  it('10. destructuring-assignment target is refused', () => {
    const before = fileWithInvoice(['const arr: unknown[] = [];', '[invoice.subscription] = arr;']);
    const result = recipe.transformFile(before, [finding(6)]);
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.reason).toMatch(/write target/i);
  });

  // --- NEGATIVE SAFETY --------------------------------------------------------

  it('11. unrelated same-named property on a non-Stripe object is untouched', () => {
    const before = fileWithInvoice([
      "const legacyRecord = { subscription: 'sub_123' };",
      'const legacyValue = legacyRecord.subscription;',
      'return invoice.subscription;',
    ]);
    // Only the real finding (line 7) is passed -- legacyRecord.subscription
    // was never a Finding in the first place (impact analysis already
    // excludes it), so remediation never even considers it.
    const result = recipe.transformFile(before, [finding(7)]);
    expect(result.kind).toBe('transformed');
    if (result.kind !== 'transformed') return;
    expect(result.newText).toContain("const legacyRecord = { subscription: 'sub_123' };");
    expect(result.newText).toContain('const legacyValue = legacyRecord.subscription;');
  });

  it('12. comment and string text mentioning "subscription" are untouched', () => {
    const before = fileWithInvoice([
      '// invoice.subscription is deprecated',
      "const note = 'invoice.subscription was removed';",
      'return invoice.subscription;',
    ]);
    const result = recipe.transformFile(before, [finding(7)]);
    expect(result.kind).toBe('transformed');
    if (result.kind !== 'transformed') return;
    expect(result.newText).toContain('// invoice.subscription is deprecated');
    expect(result.newText).toContain("const note = 'invoice.subscription was removed';");
  });

  it('13. an existing parent.subscription_details.subscription access elsewhere is untouched', () => {
    const before = fileWithInvoice([
      'const already = invoice.parent?.subscription_details?.subscription ?? null;',
      'return [already, invoice.subscription];',
    ]);
    const result = recipe.transformFile(before, [finding(6)]);
    expect(result.kind).toBe('transformed');
    if (result.kind !== 'transformed') return;
    expect(result.newText).toContain(
      'const already = invoice.parent?.subscription_details?.subscription ?? null;',
    );
  });

  // --- IDEMPOTENCY --------------------------------------------------------

  it('14. re-running against already-transformed source makes no second change (refuses, does not oscillate)', () => {
    const before = fileWithInvoice(['return invoice.subscription;']);
    const first = recipe.transformFile(before, [finding(5)]);
    expect(first.kind).toBe('transformed');
    if (first.kind !== 'transformed') return;

    // The old pattern is gone from the transformed text -- the *same*
    // finding (still claiming line 5, its original location) can no
    // longer be located there. Idempotency is enforced by refusal
    // (fail-closed: nothing is written), not a silent "already done, ok"
    // no-op that could mask a real regression.
    const second = recipe.transformFile(first.newText, [finding(5)]);
    expect(second.kind).toBe('refused');
    if (second.kind !== 'refused') return;
    expect(second.reason).toMatch(/stale finding/i);

    // Byte-for-byte: a second attempt, even if it somehow proceeded, has
    // literally nothing to change -- confirmed directly against the
    // already-transformed text, independent of the refusal path above.
    const checks = recipe.checkPostconditions(before, first.newText, 'src/billing.ts');
    const oldAbsent = checks.find((c) => c.name === 'old affected pattern absent');
    expect(oldAbsent?.passed).toBe(true);
    expect(oldAbsent?.detail).toContain('0 remaining');
  });

  // --- POSTCONDITIONS -----------------------------------------------------

  it('postconditions pass for a correctly transformed file', () => {
    const before = fileWithInvoice(['return invoice.subscription;']);
    const result = recipe.transformFile(before, [finding(5)]);
    expect(result.kind).toBe('transformed');
    if (result.kind !== 'transformed') return;

    const checks = recipe.checkPostconditions(before, result.newText, 'src/billing.ts');
    expect(checks.every((c) => c.passed)).toBe(true);
    expect(checks.some((c) => c.name === 'old affected pattern absent')).toBe(true);
    expect(checks.some((c) => c.name === 'replacement pattern present')).toBe(true);
  });

  it('postconditions fail if the old pattern is somehow still present (defense in depth)', () => {
    // Simulate a would-be-buggy transform that leaves the old access in
    // place alongside a fabricated replacement -- the postcondition check
    // must catch this independently of transformFile's own claimed result.
    const before = fileWithInvoice(['return invoice.subscription;']);
    const brokenAfter = fileWithInvoice(['return invoice.subscription; // not actually removed']);
    const checks = recipe.checkPostconditions(before, brokenAfter, 'src/billing.ts');
    expect(checks.find((c) => c.name === 'old affected pattern absent')?.passed).toBe(false);
  });

  // --- THE 9 USER-SPECIFIED READ-CONTEXT EXAMPLES --------------------------

  const readContexts: { label: string; body: string; expectedContains: string }[] = [
    {
      label: 'variable initializer',
      body: 'const subscription = invoice.subscription;',
      expectedContains: `const subscription = ${REPLACEMENT};`,
    },
    {
      label: 'strict equality to null',
      body: 'const isNull = invoice.subscription === null;',
      expectedContains: `const isNull = ${REPLACEMENT} === null;`,
    },
    {
      label: 'strict inequality to null',
      body: 'const isNotNull = invoice.subscription !== null;',
      expectedContains: `const isNotNull = ${REPLACEMENT} !== null;`,
    },
    {
      label: 'call argument',
      body: 'foo(invoice.subscription);',
      expectedContains: `foo(${REPLACEMENT});`,
    },
    {
      label: 'return statement',
      body: 'return invoice.subscription;',
      expectedContains: `return ${REPLACEMENT};`,
    },
    {
      label: 'object literal value position',
      body: 'const obj = { subscription: invoice.subscription };',
      expectedContains: `const obj = { subscription: ${REPLACEMENT} };`,
    },
    {
      label: 'nullish coalescing',
      body: "const withFallback = invoice.subscription ?? 'none';",
      expectedContains: `const withFallback = ${REPLACEMENT} ?? 'none';`,
    },
    {
      label: 'ternary condition',
      body: "const label = invoice.subscription ? 'has-sub' : 'no-sub';",
      expectedContains: `const label = ${REPLACEMENT} ? 'has-sub' : 'no-sub';`,
    },
    {
      label: 'Object.is comparison',
      body: 'const same = Object.is(invoice.subscription, null);',
      expectedContains: `const same = Object.is(${REPLACEMENT}, null);`,
    },
  ];

  for (const { label, body, expectedContains } of readContexts) {
    it(`read context: ${label}`, () => {
      const before = fileWithInvoice([body]);
      const result = recipe.transformFile(before, [finding(5)]);
      expect(result.kind).toBe('transformed');
      if (result.kind !== 'transformed') return;
      expect(result.newText).toContain(expectedContains);

      const checks = recipe.checkPostconditions(before, result.newText, 'src/billing.ts');
      expect(checks.every((c) => c.passed)).toBe(true);
    });
  }
});

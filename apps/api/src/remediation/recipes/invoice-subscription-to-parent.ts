import ts from 'typescript';
import type { ExtractedFile } from '../../analysis/archive.js';
import { buildProgramForFile } from '../../analysis/impact/predicates/engine.js';
import { STRIPE_TYPE_STUB_PATH } from '../../analysis/impact/stripe-type-stub.js';
import type { PostconditionCheck, RemediationRecipe } from '../types.js';

const OLD_INTERFACE = 'StripeInvoice';
const NEW_INTERFACE = 'StripeInvoiceSubscriptionDetails';
const PROPERTY_NAME = 'subscription';

/**
 * Stricter than member-access.ts's `isDeclaredInStub` (which only checks
 * "declared somewhere in the stub file"): the stub now declares TWO
 * distinct `.subscription` properties (StripeInvoice.subscription, the
 * old field, and StripeInvoiceSubscriptionDetails.subscription, the
 * replacement) -- see stripe-type-stub.ts. A postcondition check that
 * only asked "is this declared in the stub" would find our OWN inserted
 * `.subscription_details.subscription` text and misreport the old
 * pattern as still present. Checking the specific declaring interface
 * disambiguates the two.
 */
function isDeclaredOnInterface(symbol: ts.Symbol, interfaceName: string): boolean {
  return (symbol.declarations ?? []).some((declaration) => {
    if (!ts.isPropertySignature(declaration)) return false;
    const parent = declaration.parent;
    return (
      declaration.getSourceFile().fileName === STRIPE_TYPE_STUB_PATH &&
      ts.isInterfaceDeclaration(parent) &&
      parent.name.text === interfaceName
    );
  });
}

const ASSIGNMENT_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/** Wrapper node kinds our node may sit inside on the way to a destructuring-assignment target. Any other parent kind is a definitive read position. */
const WRAPPER_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.ParenthesizedExpression,
  ts.SyntaxKind.ArrayLiteralExpression,
  ts.SyntaxKind.ObjectLiteralExpression,
  ts.SyntaxKind.PropertyAssignment,
  ts.SyntaxKind.SpreadElement,
  ts.SyntaxKind.SpreadAssignment,
]);

/**
 * Is `node` in a write position: the (possibly destructured) target of an
 * assignment/compound assignment, or the operand of ++/--? Walks up
 * through destructuring wrapper shapes only -- reaching any other node
 * kind means we've hit a genuine read position and can stop. Covers
 * direct assignment, compound assignment, update expressions, and
 * destructuring-to-member-expression (`[invoice.subscription] = arr`) in
 * one unified check, since the pattern being destructured is itself the
 * `.left` of the assignment our node is nested inside.
 */
function isWritePosition(node: ts.Node): boolean {
  let current: ts.Node = node;
  let parent: ts.Node | undefined = current.parent;

  while (parent) {
    if (ts.isBinaryExpression(parent) && ASSIGNMENT_OPERATORS.has(parent.operatorToken.kind)) {
      return parent.left === current;
    }
    if (
      (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
      (parent.operator === ts.SyntaxKind.PlusPlusToken ||
        parent.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      return parent.operand === current;
    }
    if (
      (ts.isForOfStatement(parent) || ts.isForInStatement(parent)) &&
      parent.initializer === current
    ) {
      return true;
    }
    if (!WRAPPER_KINDS.has(parent.kind)) return false;

    current = parent;
    parent = parent.parent;
  }
  return false;
}

interface Candidate {
  node: ts.PropertyAccessExpression;
  line: number;
}

function findOldPatternCandidates(sourceFile: ts.SourceFile, checker: ts.TypeChecker): Candidate[] {
  const candidates: Candidate[] = [];

  function visit(node: ts.Node): void {
    if (ts.isPropertyAccessExpression(node) && node.name.text === PROPERTY_NAME) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol && isDeclaredOnInterface(symbol, OLD_INTERFACE)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        candidates.push({ node, line });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return candidates;
}

/**
 * Detects the OTHER shape member-access.ts's own predicate also matches
 * as AFFECTED -- `const { subscription } = invoice` -- purely so a
 * refusal at this line can say "destructuring is unsupported" instead of
 * the misleading "stale finding" when the source hasn't actually changed
 * at all, just used a shape outside this recipe's approved scope (only
 * direct `X.subscription` property-access reads). Confirmed against the
 * real HamidZ11/stripe-basil-fixture repository, which uses exactly this
 * shape.
 */
function isDestructuredAtLine(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  targetLine: number,
): boolean {
  let found = false;
  function visit(node: ts.Node): void {
    if (found) return;
    if (
      ts.isBindingElement(node) &&
      !ts.isArrayBindingPattern(node.parent) &&
      ts.isIdentifier(node.propertyName ?? node.name) &&
      (node.propertyName ?? node.name).getText() === PROPERTY_NAME &&
      ts.isVariableDeclaration(node.parent.parent) &&
      node.parent.parent.initializer
    ) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      if (line === targetLine) {
        const sourceType = checker.getTypeAtLocation(node.parent.parent.initializer);
        const propertySymbol = checker.getPropertyOfType(sourceType, PROPERTY_NAME);
        if (propertySymbol && isDeclaredOnInterface(propertySymbol, OLD_INTERFACE)) found = true;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

function countNewPatternMatches(sourceFile: ts.SourceFile, checker: ts.TypeChecker): number {
  let count = 0;
  function visit(node: ts.Node): void {
    if (ts.isPropertyAccessExpression(node) && node.name.text === PROPERTY_NAME) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol && isDeclaredOnInterface(symbol, NEW_INTERFACE)) count += 1;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return count;
}

/**
 * Rule B: `X.subscription` (StripeInvoice.subscription, removed at SDK
 * v18.0.0) -> `(X.parent?.subscription_details?.subscription ?? null)`.
 * Verified against the real stripe-node type declarations at both SDK
 * boundary tags (not just the changelog prose): old field
 * `string | Stripe.Subscription | null`; new
 * `Parent.SubscriptionDetails.subscription` is `string | Stripe.Subscription`
 * (not itself nullable), reachable only when `parent` and
 * `subscription_details` are both non-null. So `?? null` produces the
 * exact same observable value as the old field in every case: the same
 * underlying value when subscription-generated, `null` (not `undefined`)
 * otherwise -- restoring old-field null semantics for strict equality,
 * Object.is, serialization, switch/case, and every other value-comparison
 * context, not merely truthiness.
 *
 * Deliberately UNSUPPORTED (refused, not best-effort): an originally
 * optional access `X?.subscription`. If X itself is null/undefined,
 * `X?.subscription` short-circuits to `undefined`, but
 * `(X?.parent?.subscription_details?.subscription ?? null)` would
 * evaluate to `null` -- changing the *receiver's* existing optional-chain
 * semantics, not just the removed field's. See the module's own test
 * suite for the regression case this rules out.
 */
export const STRIPE_INVOICE_SUBSCRIPTION_TO_PARENT_RECIPE: RemediationRecipe = {
  predicateKind: 'stripe_invoice_subscription_property',
  transformationKind: 'stripe_invoice_subscription_to_parent',
  transformationVersion: 'v1',

  transformFile(fileText, findingsInFile, tsconfigFiles: ExtractedFile[] = []) {
    const file: ExtractedFile = { path: '/patchwork/target.ts', content: fileText };
    const built = buildProgramForFile(file, tsconfigFiles);
    if (!built) return { kind: 'refused', reason: 'source file could not be parsed' };
    const { sourceFile, program } = built;
    const checker = program.getTypeChecker();

    const candidates = findOldPatternCandidates(sourceFile, checker);
    const edits: { start: number; end: number; replacement: string }[] = [];

    for (const finding of findingsInFile) {
      const atLine = candidates.filter((candidate) => candidate.line === finding.line);
      if (atLine.length === 0) {
        if (isDestructuredAtLine(sourceFile, checker, finding.line)) {
          return {
            kind: 'refused',
            reason: `${finding.sourceFile}:${finding.line} destructures the property (const { subscription } = invoice) -- only a direct X.subscription property-access read is supported, not destructuring`,
          };
        }
        return {
          kind: 'refused',
          reason: `no matching Invoice.subscription access found at ${finding.sourceFile}:${finding.line} (stale finding -- source no longer matches the analysed snapshot)`,
        };
      }
      if (atLine.length > 1) {
        return {
          kind: 'refused',
          reason: `ambiguous: multiple candidate accesses at ${finding.sourceFile}:${finding.line}`,
        };
      }
      const node = atLine[0]!.node;

      if (node.questionDotToken) {
        return {
          kind: 'refused',
          reason: `${finding.sourceFile}:${finding.line} uses optional chaining (X?.subscription) on the receiver -- unsupported, see recipe notes`,
        };
      }
      if (isWritePosition(node)) {
        return {
          kind: 'refused',
          reason: `${finding.sourceFile}:${finding.line} is a write target (assignment, compound assignment, update expression, or destructuring target), not a read`,
        };
      }

      const receiverText = node.expression.getText(sourceFile);
      const replacement = `(${receiverText}.parent?.subscription_details?.subscription ?? null)`;
      edits.push({ start: node.getStart(sourceFile), end: node.getEnd(), replacement });
    }

    edits.sort((a, b) => b.start - a.start);
    let newText = fileText;
    for (const edit of edits) {
      newText = newText.slice(0, edit.start) + edit.replacement + newText.slice(edit.end);
    }
    return { kind: 'transformed', newText };
  },

  checkPostconditions(before, after, filePath, tsconfigFiles: ExtractedFile[] = []) {
    const checks: PostconditionCheck[] = [];

    const beforeBuilt = buildProgramForFile(
      { path: '/patchwork/before.ts', content: before },
      tsconfigFiles,
    );
    const afterBuilt = buildProgramForFile(
      { path: '/patchwork/after.ts', content: after },
      tsconfigFiles,
    );

    if (!afterBuilt) {
      return [
        {
          name: 'rewritten source parses',
          passed: false,
          detail: `${filePath}: could not parse rewritten source`,
        },
      ];
    }
    checks.push({ name: 'rewritten source parses', passed: true, detail: filePath });

    const afterChecker = afterBuilt.program.getTypeChecker();
    const oldRemaining = findOldPatternCandidates(afterBuilt.sourceFile, afterChecker).length;
    checks.push({
      name: 'old affected pattern absent',
      passed: oldRemaining === 0,
      detail: `${filePath}: ${oldRemaining} remaining Invoice.subscription access(es)`,
    });

    const expectedNew = beforeBuilt
      ? findOldPatternCandidates(beforeBuilt.sourceFile, beforeBuilt.program.getTypeChecker())
          .length
      : 0;
    const newPresent = countNewPatternMatches(afterBuilt.sourceFile, afterChecker);
    checks.push({
      name: 'replacement pattern present',
      passed: newPresent >= expectedNew && newPresent > 0,
      detail: `${filePath}: ${newPresent} parent.subscription_details.subscription access(es) found (expected >= ${expectedNew})`,
    });

    return checks;
  },
};

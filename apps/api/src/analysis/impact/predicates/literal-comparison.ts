import ts from 'typescript';
import type { ExtractedFile } from '../../archive.js';
import { STRIPE_TYPE_STUB_PATH } from '../stripe-type-stub.js';
import type { Finding } from '../types.js';
import {
  scanFilesWithVisitor,
  UNRESOLVABLE_TYPE_FLAGS,
  type PredicateScanResult,
} from './engine.js';

function asPropertyAndLiteral(
  left: ts.Expression,
  right: ts.Expression,
): { property: ts.Expression; literal: ts.StringLiteral } | undefined {
  if (ts.isStringLiteral(right)) return { property: left, literal: right };
  if (ts.isStringLiteral(left)) return { property: right, literal: left };
  return undefined;
}

function isDeclaredInStub(symbol: ts.Symbol): boolean {
  return (symbol.declarations ?? []).some(
    (declaration) => declaration.getSourceFile().fileName === STRIPE_TYPE_STUB_PATH,
  );
}

/**
 * Same-file destructuring case: `const { propertyName } = sourceExpr;
 * ... x === literal` -- the comparison operand is a plain Identifier
 * bound by a destructuring BindingElement, never a
 * PropertyAccessExpression, so it's invisible to the direct-access path
 * below (a confirmed real gap found via slice 5's realistic validation).
 * Resolved the same way as member-access.ts's destructuring support:
 * via the source expression's type, not the local variable's symbol.
 * Returns undefined (not "no match") when the identifier isn't bound
 * this way at all -- the caller treats that as "not this shape."
 */
type DestructuredResolution =
  { kind: 'MATCH' | 'NON_MATCH'; propertySymbol: ts.Symbol } | { kind: 'AMBIGUOUS' };

function resolveDestructuredPropertySymbol(
  identifier: ts.Identifier,
  propertyName: string,
  checker: ts.TypeChecker,
): DestructuredResolution | undefined {
  const localSymbol = checker.getSymbolAtLocation(identifier);
  const declaration = localSymbol?.declarations?.[0];
  if (!declaration || !ts.isBindingElement(declaration)) return undefined;

  const sourceName = declaration.propertyName ?? declaration.name;
  if (!ts.isIdentifier(sourceName) || sourceName.text !== propertyName) return undefined;

  const pattern = declaration.parent;
  if (ts.isArrayBindingPattern(pattern) || !ts.isVariableDeclaration(pattern.parent)) {
    return undefined;
  }
  const initializer = pattern.parent.initializer;
  if (!initializer) return undefined;

  const sourceType = checker.getTypeAtLocation(initializer);
  const propertySymbol = checker.getPropertyOfType(sourceType, propertyName);
  if (propertySymbol)
    return { kind: isDeclaredInStub(propertySymbol) ? 'MATCH' : 'NON_MATCH', propertySymbol };
  if ((sourceType.flags & UNRESOLVABLE_TYPE_FLAGS) !== 0) return { kind: 'AMBIGUOUS' };
  return undefined;
}

/**
 * Reusable predicate primitive: does a `BinaryExpression` (`===`/`==`)
 * compare a property named `propertyName` (whose type resolves, via the
 * TypeChecker, to a declaration in the trusted stub) against the specific
 * string literal `literalValue`? Models "legacy code that special-cases
 * one enum value now misses a newly-split-out one" -- a literal-domain
 * predicate, distinct from member-access (no method/property is removed,
 * just a comparison that's now semantically incomplete). Covers both a
 * direct `x.propertyName === literal` and a same-file destructured
 * `const { propertyName } = x; propertyName === literal`.
 *
 * Three-way outcome: property confirmed non-Stripe -> skipped entirely,
 * never a match, never ambiguous, regardless of the literal compared.
 * Property confirmed Stripe + literal matches -> match. Property
 * confirmed Stripe + literal doesn't match -> irrelevant, no finding
 * (comparing a different value is not this rule's concern). Property
 * unresolved (`any`/dynamic) + literal matches -> ambiguous, never
 * silently dropped to a negative.
 */
export function scanForLiteralComparison(
  files: ExtractedFile[],
  params: { propertyName: string; literalValue: string; matchedSymbol: string },
): Map<string, PredicateScanResult> {
  return scanFilesWithVisitor(
    files,
    (content) => content.includes(params.propertyName) && content.includes(params.literalValue),
    (sourceFile, checker, workspacePath) => {
      const matches: Finding[] = [];
      const ambiguous: { sourceFile: string; line: number }[] = [];

      function visit(node: ts.Node): void {
        if (
          ts.isBinaryExpression(node) &&
          (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
            node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)
        ) {
          const pair = asPropertyAndLiteral(node.left, node.right);
          if (pair && pair.literal.text === params.literalValue) {
            const line =
              sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

            if (
              ts.isPropertyAccessExpression(pair.property) &&
              pair.property.name.text === params.propertyName
            ) {
              const symbol = checker.getSymbolAtLocation(pair.property);
              if (!symbol) {
                ambiguous.push({ sourceFile: sourceFile.fileName, line });
              } else if (isDeclaredInStub(symbol)) {
                matches.push({
                  workspacePath,
                  sourceFile: sourceFile.fileName,
                  line,
                  matchedSymbol: params.matchedSymbol,
                });
              }
              // Resolves to a non-Stripe declaration -- confirmed
              // non-match, not ambiguous, no finding.
            } else if (ts.isIdentifier(pair.property)) {
              const resolved = resolveDestructuredPropertySymbol(
                pair.property,
                params.propertyName,
                checker,
              );
              if (resolved?.kind === 'AMBIGUOUS') {
                ambiguous.push({ sourceFile: sourceFile.fileName, line });
              } else if (resolved?.kind === 'MATCH') {
                matches.push({
                  workspacePath,
                  sourceFile: sourceFile.fileName,
                  line,
                  matchedSymbol: params.matchedSymbol,
                });
              }
              // resolved?.kind === 'NON_MATCH', or resolved undefined
              // (not this shape at all) -- no finding, no ambiguity.
            }
          }
        }
        ts.forEachChild(node, visit);
      }

      visit(sourceFile);
      return { matches, ambiguous };
    },
  );
}

import ts from 'typescript';
import type { ExtractedFile } from '../../archive.js';
import { STRIPE_TYPE_STUB_PATH } from '../stripe-type-stub.js';
import type { Finding } from '../types.js';
import { scanFilesWithVisitor, type PredicateScanResult } from './engine.js';

function asPropertyAndLiteral(
  left: ts.Expression,
  right: ts.Expression,
): { property: ts.Expression; literal: ts.StringLiteral } | undefined {
  if (ts.isStringLiteral(right)) return { property: left, literal: right };
  if (ts.isStringLiteral(left)) return { property: right, literal: left };
  return undefined;
}

/**
 * Reusable predicate primitive: does a `BinaryExpression` (`===`/`==`)
 * compare a `PropertyAccessExpression` named `propertyName` (whose type
 * resolves, via the TypeChecker, to a declaration in the trusted stub)
 * against the specific string literal `literalValue`? Models "legacy code
 * that special-cases one enum value now misses a newly-split-out one" --
 * a literal-domain predicate, distinct from member-access (no method/
 * property is removed, just a comparison that's now semantically
 * incomplete).
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
          if (
            pair &&
            pair.literal.text === params.literalValue &&
            ts.isPropertyAccessExpression(pair.property) &&
            pair.property.name.text === params.propertyName
          ) {
            const line =
              sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
            const symbol = checker.getSymbolAtLocation(pair.property);

            if (!symbol) {
              ambiguous.push({ sourceFile: sourceFile.fileName, line });
            } else {
              const declaredInStub = (symbol.declarations ?? []).some(
                (declaration) => declaration.getSourceFile().fileName === STRIPE_TYPE_STUB_PATH,
              );
              if (declaredInStub) {
                matches.push({
                  workspacePath,
                  sourceFile: sourceFile.fileName,
                  line,
                  matchedSymbol: params.matchedSymbol,
                });
              }
              // Resolves to a non-Stripe declaration -- confirmed
              // non-match, not ambiguous, no finding.
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

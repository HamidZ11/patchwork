import ts from 'typescript';
import type { ExtractedFile } from '../../archive.js';
import { STRIPE_TYPE_STUB_PATH } from '../stripe-type-stub.js';
import type { Finding } from '../types.js';
import {
  scanFilesWithVisitor,
  UNRESOLVABLE_TYPE_FLAGS,
  type PredicateScanResult,
} from './engine.js';

function isDeclaredInStub(symbol: ts.Symbol): boolean {
  return (symbol.declarations ?? []).some(
    (declaration) => declaration.getSourceFile().fileName === STRIPE_TYPE_STUB_PATH,
  );
}

/**
 * Reusable predicate primitive: does source contain a
 * `PropertyAccessExpression` named `propertyName` whose object
 * expression's type resolves (via the real TypeChecker, against the
 * trusted stub) to a declaration in the stub? Covers direct access,
 * same-file aliases, and bare references in one mechanism -- ordinary
 * type inference handles aliasing for free, no special-casing needed.
 * Confirmed non-matches (resolves to a distinguishable declaration
 * elsewhere) are silently excluded; unresolved (`any`) references are
 * ambiguous, never silently dropped to a negative.
 *
 * Also covers the same-file destructuring shape `const { propertyName } =
 * sourceExpr;` -- a destructured binding never produces a
 * PropertyAccessExpression at all, so it was previously invisible to this
 * predicate (a confirmed real gap found via slice 5's realistic
 * validation, not hypothesized). Resolved via `checker.getPropertyOfType`
 * on the source expression's type rather than `getSymbolAtLocation` on the
 * binding name, since the latter resolves to the newly-declared local
 * variable, not the source property being destructured. Deliberately
 * narrow: only a top-level `const`/`let` destructuring with an inline
 * initializer in the same file -- destructured function parameters and
 * nested patterns are out of scope (same as any other cross-file/
 * unsupported indirection, left unhandled rather than guessed at).
 */
export function scanForMemberAccess(
  files: ExtractedFile[],
  params: { propertyName: string; matchedSymbol: string },
): Map<string, PredicateScanResult> {
  return scanFilesWithVisitor(
    files,
    (content) => content.includes(params.propertyName),
    (sourceFile, checker, workspacePath) => {
      const matches: Finding[] = [];
      const ambiguous: { sourceFile: string; line: number }[] = [];

      function visit(node: ts.Node): void {
        if (ts.isPropertyAccessExpression(node) && node.name.text === params.propertyName) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          const symbol = checker.getSymbolAtLocation(node);

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
          // Symbol resolved to something else entirely (a local
          // interface, an unrelated object literal, ...) -- confirmed
          // non-match, not ambiguous, no finding.
        } else if (
          ts.isBindingElement(node) &&
          !ts.isArrayBindingPattern(node.parent) &&
          ts.isIdentifier(node.propertyName ?? node.name) &&
          (node.propertyName ?? node.name).getText() === params.propertyName &&
          ts.isVariableDeclaration(node.parent.parent) &&
          node.parent.parent.initializer
        ) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          const sourceType = checker.getTypeAtLocation(node.parent.parent.initializer);
          const propertySymbol = checker.getPropertyOfType(sourceType, params.propertyName);

          if (propertySymbol) {
            if (isDeclaredInStub(propertySymbol)) {
              matches.push({
                workspacePath,
                sourceFile: sourceFile.fileName,
                line,
                matchedSymbol: params.matchedSymbol,
              });
            }
            // Resolves to a concrete, non-stub property -- confirmed
            // non-match, same as the PropertyAccessExpression case.
          } else if ((sourceType.flags & UNRESOLVABLE_TYPE_FLAGS) !== 0) {
            // The source expression's type couldn't be resolved (dynamic
            // construction, unresolved import, an explicit `unknown`
            // annotation, ...) -- ambiguous, never a silent negative, same
            // contract as an unresolved symbol above.
            ambiguous.push({ sourceFile: sourceFile.fileName, line });
          }
          // A concrete, resolved type that genuinely lacks this property
          // is a user-code error unrelated to our detection -- no-op.
        }
        ts.forEachChild(node, visit);
      }

      visit(sourceFile);
      return { matches, ambiguous };
    },
  );
}

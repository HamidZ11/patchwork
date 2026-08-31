import ts from 'typescript';
import type { ExtractedFile } from '../../archive.js';
import { STRIPE_TYPE_STUB_PATH } from '../stripe-type-stub.js';
import type { Finding } from '../types.js';
import { scanFilesWithVisitor, type PredicateScanResult } from './engine.js';

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
            // Symbol resolved to something else entirely (a local
            // interface, an unrelated object literal, ...) -- confirmed
            // non-match, not ambiguous, no finding.
          }
        }
        ts.forEachChild(node, visit);
      }

      visit(sourceFile);
      return { matches, ambiguous };
    },
  );
}

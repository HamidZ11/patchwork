import ts from 'typescript';
import type { ExtractedFile } from '../../archive.js';
import { STRIPE_TYPE_STUB_PATH } from '../stripe-type-stub.js';
import type { Finding } from '../types.js';
import { scanFilesWithVisitor, type PredicateScanResult } from './engine.js';

function findPropertyInArgs(
  args: readonly ts.Expression[],
  propertyName: string,
): ts.PropertyAssignment | ts.ShorthandPropertyAssignment | undefined {
  let found: ts.PropertyAssignment | ts.ShorthandPropertyAssignment | undefined;

  function visit(node: ts.Node): void {
    if (found) return;
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      ts.isIdentifier(node.name) &&
      node.name.text === propertyName
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  }

  for (const arg of args) visit(arg);
  return found;
}

/**
 * Reusable predicate primitive: does a `CallExpression` whose callee (the
 * final property in a `foo.bar.baz(...)` chain) resolves to a trusted stub
 * method contain, anywhere in its argument list, an object-literal
 * property named `argumentPropertyName`? Deliberately shallow -- it
 * doesn't validate the full nested argument shape (e.g. that the property
 * sits inside a specific `phases[]` array); the provenance-proving part
 * (the call target must resolve to the stub) is what matters.
 *
 * Three-way outcome: callee confirmed non-Stripe -> the call (and its
 * arguments) is skipped entirely, never a match, never ambiguous. Callee
 * confirmed Stripe + property present -> match. Callee confirmed Stripe +
 * property absent -> the feature is genuinely unused, no finding (a
 * legitimate negative). Callee unresolved (`any`/dynamic) -> ambiguous
 * only if the suspicious property is actually present in the arguments
 * (an unrelated dynamic call with no matching property isn't interesting
 * at all).
 */
export function scanForCallArgumentProperty(
  files: ExtractedFile[],
  params: { methodNames: string[]; argumentPropertyName: string; matchedSymbol: string },
): Map<string, PredicateScanResult> {
  return scanFilesWithVisitor(
    files,
    (content) => content.includes(params.argumentPropertyName),
    (sourceFile, checker, workspacePath) => {
      const matches: Finding[] = [];
      const ambiguous: { sourceFile: string; line: number }[] = [];

      function visit(node: ts.Node): void {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          params.methodNames.includes(node.expression.name.text)
        ) {
          const calleeSymbol = checker.getSymbolAtLocation(node.expression);
          const propertyNode = findPropertyInArgs(node.arguments, params.argumentPropertyName);

          if (calleeSymbol) {
            const declaredInStub = (calleeSymbol.declarations ?? []).some(
              (declaration) => declaration.getSourceFile().fileName === STRIPE_TYPE_STUB_PATH,
            );
            if (declaredInStub && propertyNode) {
              const line =
                sourceFile.getLineAndCharacterOfPosition(propertyNode.getStart(sourceFile)).line +
                1;
              matches.push({
                workspacePath,
                sourceFile: sourceFile.fileName,
                line,
                matchedSymbol: params.matchedSymbol,
              });
            }
            // declaredInStub but no matching property -> the feature is
            // genuinely unused, a legitimate negative, no finding.
            // !declaredInStub -> confirmed non-Stripe call, skip its
            // arguments entirely regardless of what they contain.
          } else if (propertyNode) {
            // Callee couldn't be resolved (dynamic construction, unresolved
            // import) but the suspicious property is present -- ambiguous,
            // never silently dropped to a negative.
            const line =
              sourceFile.getLineAndCharacterOfPosition(node.expression.getStart(sourceFile)).line +
              1;
            ambiguous.push({ sourceFile: sourceFile.fileName, line });
          }
        }
        ts.forEachChild(node, visit);
      }

      visit(sourceFile);
      return { matches, ambiguous };
    },
  );
}

import ts from 'typescript';
import type { ExtractedFile } from '../../archive.js';
import { STRIPE_TYPE_STUB_PATH } from '../stripe-type-stub.js';
import type { Finding } from '../types.js';
import {
  scanFilesWithVisitor,
  UNRESOLVABLE_TYPE_FLAGS,
  type PredicateScanResult,
} from './engine.js';

function findPropertyAssignment(
  node: ts.Node,
  propertyName: string,
): ts.PropertyAssignment | ts.ShorthandPropertyAssignment | undefined {
  let found: ts.PropertyAssignment | ts.ShorthandPropertyAssignment | undefined;

  function visit(n: ts.Node): void {
    if (found) return;
    if (
      (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) &&
      ts.isIdentifier(n.name) &&
      n.name.text === propertyName
    ) {
      found = n;
      return;
    }
    ts.forEachChild(n, visit);
  }

  visit(node);
  return found;
}

type IdentifierInspection = 'MATCH' | 'AMBIGUOUS' | 'CONFIRMED_NON_MATCH';

/**
 * A same-file `const phase = { iterations: 3 }; create({ phases: [phase]
 * });` style indirection means the target property never appears inline
 * in the call's own AST -- a confirmed real gap found via slice 5's
 * realistic validation (this predicate had no same-file resolution at
 * all, unlike member-access.ts). Resolved by one bounded hop: if the
 * identifier's same-file declaration is a `const` initialized with an
 * object/array literal, search *that* literal directly (AST-only, no
 * further indirection -- exactly the confirmed shape, nothing deeper).
 *
 * If the identifier isn't resolvable to an inspectable literal this way,
 * fall back to the identifier's checker-resolved type: a concrete,
 * non-`any` type (a string parameter, an unrelated typed value, ...)
 * definitively can't be hiding the property -- confirmed non-match, not
 * ambiguous. Only a genuinely unresolvable (`any`) type is ambiguous --
 * this is what keeps `create({ customer: customerId, phases: [...] })`
 * from becoming noisy UNCERTAIN just because `customerId` can't be
 * inspected: its type is known and concrete, just not our property.
 */
function inspectIdentifier(
  identifier: ts.Identifier,
  propertyName: string,
  checker: ts.TypeChecker,
): IdentifierInspection {
  const symbol = checker.getSymbolAtLocation(identifier);
  const declaration = symbol?.declarations?.[0];
  if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
    const initializer = declaration.initializer;
    if (ts.isObjectLiteralExpression(initializer) || ts.isArrayLiteralExpression(initializer)) {
      return findPropertyAssignment(initializer, propertyName) ? 'MATCH' : 'CONFIRMED_NON_MATCH';
    }
  }

  const type = checker.getTypeAtLocation(identifier);
  return (type.flags & UNRESOLVABLE_TYPE_FLAGS) !== 0 ? 'AMBIGUOUS' : 'CONFIRMED_NON_MATCH';
}

/**
 * Walks a call's arguments looking for the target property, either
 * inline or via one same-file hop through an identifier (see
 * `inspectIdentifier`). Returns the real AST node for a MATCH found
 * inline or inside a resolved literal (giving a genuine line number);
 * `ambiguous` is set if any identifier along the way was genuinely
 * unresolvable, even if a definitive match/non-match was found elsewhere
 * in the same argument list.
 */
function searchArgsForProperty(
  args: readonly ts.Expression[],
  propertyName: string,
  checker: ts.TypeChecker,
): { found: ts.Node | undefined; ambiguous: boolean } {
  let found: ts.Node | undefined;
  let ambiguous = false;

  // Deliberately does not use a blind ts.forEachChild for every node --
  // that would also walk into PropertyAssignment/ShorthandPropertyAssignment
  // *name* identifiers (e.g. the `phases` key itself) and misinterpret a
  // property key as if it were a value reference needing inspection.
  // Only identifiers in genuine value positions (array elements, a
  // PropertyAssignment's initializer, ...) are ever passed to
  // inspectIdentifier.
  function visit(node: ts.Node): void {
    if (found) return;
    if (ts.isPropertyAssignment(node)) {
      if (ts.isIdentifier(node.name) && node.name.text === propertyName) {
        found = node;
        return;
      }
      visit(node.initializer);
      return;
    }
    if (ts.isShorthandPropertyAssignment(node)) {
      // The "value" of a shorthand property IS the name identifier, and
      // it always refers to a local variable of that exact name -- if it
      // doesn't match propertyName by name, it can't be our property.
      if (node.name.text === propertyName) found = node;
      return;
    }
    if (ts.isIdentifier(node)) {
      switch (inspectIdentifier(node, propertyName, checker)) {
        case 'MATCH':
          found = node;
          return;
        case 'AMBIGUOUS':
          ambiguous = true;
          return;
        case 'CONFIRMED_NON_MATCH':
          return;
      }
    }
    ts.forEachChild(node, visit);
  }

  for (const arg of args) visit(arg);
  return { found, ambiguous };
}

/**
 * Reusable predicate primitive: does a `CallExpression` whose callee (the
 * final property in a `foo.bar.baz(...)` chain) resolves to a trusted stub
 * method contain, anywhere in its argument list (inline, or one same-file
 * hop through a local variable), an object-literal property named
 * `argumentPropertyName`? Deliberately shallow -- it doesn't validate the
 * full nested argument shape (e.g. that the property sits inside a
 * specific `phases[]` array); the provenance-proving part (the call
 * target must resolve to the stub) is what matters.
 *
 * Three-way outcome: callee confirmed non-Stripe -> the call (and its
 * arguments) is skipped entirely, never a match, never ambiguous. Callee
 * confirmed Stripe + property present (inline or via one same-file hop)
 * -> match. Callee confirmed Stripe + property confirmed absent -> the
 * feature is genuinely unused, no finding (a legitimate negative).
 * Callee confirmed Stripe + an argument identifier is genuinely
 * unresolvable (dynamic/cross-file) -> ambiguous, never silently dropped
 * to a negative. Callee unresolved (`any`/dynamic) -> ambiguous only if
 * the suspicious property is actually present in the arguments (an
 * unrelated dynamic call with no matching property isn't interesting at
 * all).
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
          const search = searchArgsForProperty(
            node.arguments,
            params.argumentPropertyName,
            checker,
          );

          if (calleeSymbol) {
            const declaredInStub = (calleeSymbol.declarations ?? []).some(
              (declaration) => declaration.getSourceFile().fileName === STRIPE_TYPE_STUB_PATH,
            );
            if (declaredInStub && search.found) {
              const line =
                sourceFile.getLineAndCharacterOfPosition(search.found.getStart(sourceFile)).line +
                1;
              matches.push({
                workspacePath,
                sourceFile: sourceFile.fileName,
                line,
                matchedSymbol: params.matchedSymbol,
              });
            } else if (declaredInStub && search.ambiguous) {
              // Property not found inline or via same-file resolution,
              // but an argument identifier was genuinely unresolvable --
              // never silently concluded "unused" when we can't actually
              // see what it contains.
              const line =
                sourceFile.getLineAndCharacterOfPosition(node.expression.getStart(sourceFile))
                  .line + 1;
              ambiguous.push({ sourceFile: sourceFile.fileName, line });
            }
            // declaredInStub, property confirmed absent, not ambiguous ->
            // the feature is genuinely unused, a legitimate negative.
            // !declaredInStub -> confirmed non-Stripe call, skip its
            // arguments entirely regardless of what they contain.
          } else if (search.found || search.ambiguous) {
            // Callee couldn't be resolved (dynamic construction, unresolved
            // import) but the suspicious property is present or an
            // argument was unresolvable -- ambiguous, never silently
            // dropped to a negative.
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

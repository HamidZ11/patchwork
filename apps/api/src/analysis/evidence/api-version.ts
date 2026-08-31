import ts from 'typescript';
import type { ExtractedFile } from '../archive.js';
import { discoverWorkspaceDirs, nearestWorkspaceFor } from './manifests.js';
import type { ApiVersionValueKind, ClientVersionEvidence } from './types.js';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

export interface ApiVersionScanResult {
  clientVersions: ClientVersionEvidence[];
  sourceFilesScanned: number;
  parseFailures: string[];
}

function isSourceFile(path: string): boolean {
  const dotIndex = path.lastIndexOf('.');
  return dotIndex !== -1 && SOURCE_EXTENSIONS.has(path.slice(dotIndex));
}

/** Local identifiers bound to the `stripe` package via import or require. */
function collectStripeLocalNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (node.moduleSpecifier.text === 'stripe' && node.importClause) {
        if (node.importClause.name) names.add(node.importClause.name.text);
        const bindings = node.importClause.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) names.add(element.name.text);
        }
      }
    }

    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === 'require' &&
      node.initializer.arguments.length === 1 &&
      ts.isStringLiteral(node.initializer.arguments[0]!) &&
      node.initializer.arguments[0]!.text === 'stripe' &&
      ts.isIdentifier(node.name)
    ) {
      names.add(node.name.text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return names;
}

/** Same-file `const NAME = "literal"` declarations, for local-constant resolution. */
function collectLocalStringConstants(sourceFile: ts.SourceFile): Map<string, string> {
  const constants = new Map<string, string>();

  function visit(node: ts.Node): void {
    if (
      ts.isVariableStatement(node) &&
      node.declarationList.flags & ts.NodeFlags.Const &&
      node.declarationList.declarations.length > 0
    ) {
      for (const declaration of node.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          ts.isStringLiteral(declaration.initializer)
        ) {
          constants.set(declaration.name.text, declaration.initializer.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return constants;
}

function classifyApiVersionValue(
  valueNode: ts.Expression,
  localConstants: Map<string, string>,
): { valueKind: ApiVersionValueKind; apiVersion: string | null } {
  if (ts.isStringLiteral(valueNode)) {
    return { valueKind: 'LITERAL', apiVersion: valueNode.text };
  }
  if (ts.isIdentifier(valueNode) && localConstants.has(valueNode.text)) {
    return { valueKind: 'LOCAL_CONSTANT', apiVersion: localConstants.get(valueNode.text) ?? null };
  }
  return { valueKind: 'DYNAMIC_UNKNOWN', apiVersion: null };
}

/**
 * Finds `new Stripe(secret, { apiVersion: ... })` construction and
 * classifies the apiVersion value. AST-only (`ts.createSourceFile`), never
 * a type-checked Program/TypeChecker -- the callee is confirmed
 * syntactically against locally-imported/required Stripe bindings, not via
 * symbol resolution. A same-file `const` with a string-literal initializer
 * is the only indirection resolved; anything else (env vars, imports,
 * calls, ternaries) is DYNAMIC_UNKNOWN, never guessed.
 */
function scanFileForClientVersions(
  file: ExtractedFile,
  workspaceDirs: string[],
): ClientVersionEvidence[] {
  const sourceFile = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
  const stripeLocalNames = collectStripeLocalNames(sourceFile);
  const localConstants = collectLocalStringConstants(sourceFile);
  const workspacePath = nearestWorkspaceFor(file.path, workspaceDirs);
  const results: ClientVersionEvidence[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      stripeLocalNames.has(node.expression.text) &&
      node.arguments &&
      node.arguments.length >= 2
    ) {
      const optionsArg = node.arguments[1]!;
      if (ts.isObjectLiteralExpression(optionsArg)) {
        for (const property of optionsArg.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            ((ts.isIdentifier(property.name) && property.name.text === 'apiVersion') ||
              (ts.isStringLiteral(property.name) && property.name.text === 'apiVersion'))
          ) {
            const { valueKind, apiVersion } = classifyApiVersionValue(
              property.initializer,
              localConstants,
            );
            const line =
              sourceFile.getLineAndCharacterOfPosition(property.getStart(sourceFile)).line + 1;
            results.push({ workspacePath, sourceFile: file.path, line, apiVersion, valueKind });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}

/**
 * Cheap lexical pre-filter (skip files that couldn't possibly contain a
 * Stripe apiVersion configuration) followed by real AST parsing for
 * candidates only -- most files in a repository won't mention Stripe at
 * all, so this avoids parsing every source file found.
 */
export function scanForClientVersionEvidence(files: ExtractedFile[]): ApiVersionScanResult {
  const workspaceDirs = discoverWorkspaceDirs(files);
  const candidates = files.filter(
    (file) =>
      isSourceFile(file.path) &&
      file.content.includes('stripe') &&
      file.content.includes('apiVersion'),
  );

  const clientVersions: ClientVersionEvidence[] = [];
  const parseFailures: string[] = [];

  for (const file of candidates) {
    try {
      clientVersions.push(...scanFileForClientVersions(file, workspaceDirs));
    } catch {
      parseFailures.push(file.path);
    }
  }

  return {
    clientVersions,
    sourceFilesScanned: candidates.length,
    parseFailures,
  };
}

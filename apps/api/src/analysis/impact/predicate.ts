import ts from 'typescript';
import type { ExtractedFile } from '../archive.js';
import { workspacePathOf } from '../evidence/manifests.js';
import { STRIPE_TYPE_STUB_CONTENT, STRIPE_TYPE_STUB_PATH } from './stripe-type-stub.js';
import type { Finding } from './types.js';

const TARGET_PROPERTY_NAME = 'retrieveUpcoming';
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const TSCONFIG_BASENAME_PATTERN = /^tsconfig(\.[\w-]+)?\.json$/;

export interface AmbiguousReference {
  sourceFile: string;
  line: number;
}

export interface PredicateScanResult {
  matches: Finding[];
  ambiguousReferences: AmbiguousReference[];
  filesFailedToLoad: string[];
  sourceFilesScanned: number;
}

function isSourceFile(path: string): boolean {
  const dotIndex = path.lastIndexOf('.');
  return dotIndex !== -1 && SOURCE_EXTENSIONS.has(path.slice(dotIndex));
}

function directoryOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

/** The workspace directory (one containing a package.json) that is the closest ancestor of filePath. */
function nearestWorkspaceFor(filePath: string, workspaceDirs: string[]): string {
  let best = '';
  let bestLength = -1;
  for (const dir of workspaceDirs) {
    const isAncestor = dir === '' || filePath.startsWith(`${dir}/`);
    if (isAncestor && dir.length > bestLength) {
      best = dir;
      bestLength = dir.length;
    }
  }
  return best;
}

function jsxForPath(path: string): ts.JsxEmit | undefined {
  return path.endsWith('.tsx') || path.endsWith('.jsx') ? ts.JsxEmit.Preserve : undefined;
}

/**
 * Compiler options from the nearest enclosing tsconfig.json, if one was
 * extracted -- a bounded fallback (this repository's own defaults if none
 * is found), not full `extends`/`references`/`include` resolution.
 */
function nearestTsconfigCompilerOptions(
  candidatePath: string,
  tsconfigFiles: ExtractedFile[],
): ts.CompilerOptions {
  let best: ExtractedFile | undefined;
  let bestDirLength = -1;
  for (const file of tsconfigFiles) {
    const dir = directoryOf(file.path);
    const isAncestor = dir === '' || candidatePath === dir || candidatePath.startsWith(`${dir}/`);
    if (isAncestor && dir.length > bestDirLength) {
      best = file;
      bestDirLength = dir.length;
    }
  }
  if (!best) return {};

  const parsed = ts.parseConfigFileTextToJson(best.path, best.content);
  if (parsed.error || !parsed.config) return {};

  const converted = ts.convertCompilerOptionsFromJson(parsed.config.compilerOptions, '', best.path);
  return converted.options;
}

function buildCompilerOptions(
  candidatePath: string,
  tsconfigFiles: ExtractedFile[],
): ts.CompilerOptions {
  const fromTsconfig = nearestTsconfigCompilerOptions(candidatePath, tsconfigFiles);
  const jsx = jsxForPath(candidatePath) ?? fromTsconfig.jsx;

  return {
    ...fromTsconfig,
    // This analysis only needs to resolve the import chain to the trusted
    // `stripe` stub -- it never needs global lib types (Array, Promise,
    // ...), so skip bundling/reading TypeScript's own lib .d.ts files.
    noLib: true,
    skipLibCheck: true,
    types: [],
    esModuleInterop: true,
    allowJs: true,
    checkJs: false,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    module: fromTsconfig.module ?? ts.ModuleKind.ESNext,
    target: fromTsconfig.target ?? ts.ScriptTarget.ES2020,
    ...(jsx !== undefined ? { jsx } : {}),
  };
}

/** In-memory CompilerHost backed by a fixed file map -- no real disk I/O. */
function createInMemoryCompilerHost(files: Map<string, string>): ts.CompilerHost {
  return {
    getSourceFile: (fileName, languageVersion) => {
      const content = files.get(fileName);
      return content === undefined
        ? undefined
        : ts.createSourceFile(fileName, content, languageVersion, true);
    },
    getDefaultLibFileName: () => 'lib.d.ts', // never read: noLib is always set
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (fileName) => files.has(fileName),
    readFile: (fileName) => files.get(fileName),
    directoryExists: () => true,
    getDirectories: () => [],
  };
}

/**
 * Finds `retrieveUpcoming` property accesses whose object expression's
 * type resolves (via the real TypeChecker, against the trusted stub) to
 * Stripe's Invoices resource. Same-file aliases and bare method
 * references are covered for free by ordinary type inference -- no
 * special-casing. Three-way outcome per reference: confirmed match
 * (declaration traces to the stub), confirmed non-match (resolves to a
 * distinguishable declaration elsewhere -- excluded, not ambiguous), or
 * ambiguous (`any`/unresolved -- ends up UNCERTAIN upstream, never
 * silently dropped to a negative).
 */
function scanSourceFileForMatches(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  workspacePath: string,
): { matches: Finding[]; ambiguous: AmbiguousReference[] } {
  const matches: Finding[] = [];
  const ambiguous: AmbiguousReference[] = [];

  function visit(node: ts.Node): void {
    if (ts.isPropertyAccessExpression(node) && node.name.text === TARGET_PROPERTY_NAME) {
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
            matchedSymbol: 'stripe.invoices.retrieveUpcoming',
          });
        }
        // Symbol resolved to something else entirely (a local interface,
        // an unrelated object literal, ...) -- confirmed non-match, not
        // ambiguous, no finding.
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { matches, ambiguous };
}

/**
 * Scans every extracted source file for `retrieveUpcoming` usage,
 * grouped by workspace. A cheap lexical prefilter (file text must contain
 * the literal property name) avoids building a Program for files that
 * couldn't possibly match -- most files in a repository won't. Building
 * a Program is a bounded, in-memory, per-file operation (see
 * buildCompilerOptions/createInMemoryCompilerHost) -- never real disk
 * I/O, never node_modules, never `ts.createProgram` over the whole repo.
 */
export function scanForRetrieveUpcomingUsage(
  files: ExtractedFile[],
): Map<string, PredicateScanResult> {
  const tsconfigFiles = files.filter((file) =>
    TSCONFIG_BASENAME_PATTERN.test(file.path.split('/').pop() ?? ''),
  );
  const workspaceDirs = files
    .filter((file) => file.path === 'package.json' || file.path.endsWith('/package.json'))
    .map((file) => workspacePathOf(file.path));
  if (workspaceDirs.length === 0) workspaceDirs.push('');

  const results = new Map<string, PredicateScanResult>();
  function ensureWorkspace(workspacePath: string): PredicateScanResult {
    let existing = results.get(workspacePath);
    if (!existing) {
      existing = {
        matches: [],
        ambiguousReferences: [],
        filesFailedToLoad: [],
        sourceFilesScanned: 0,
      };
      results.set(workspacePath, existing);
    }
    return existing;
  }
  for (const dir of workspaceDirs) ensureWorkspace(dir);

  const candidates = files.filter(
    (file) => isSourceFile(file.path) && file.content.includes(TARGET_PROPERTY_NAME),
  );

  for (const file of candidates) {
    const workspacePath = nearestWorkspaceFor(file.path, workspaceDirs);
    const bucket = ensureWorkspace(workspacePath);
    bucket.sourceFilesScanned += 1;

    try {
      const compilerOptions = buildCompilerOptions(file.path, tsconfigFiles);
      const fileMap = new Map<string, string>([
        [STRIPE_TYPE_STUB_PATH, STRIPE_TYPE_STUB_CONTENT],
        [file.path, file.content],
      ]);
      const program = ts.createProgram({
        rootNames: [STRIPE_TYPE_STUB_PATH, file.path],
        options: compilerOptions,
        host: createInMemoryCompilerHost(fileMap),
      });

      const sourceFile = program.getSourceFile(file.path);
      if (!sourceFile) {
        bucket.filesFailedToLoad.push(file.path);
        continue;
      }

      const { matches, ambiguous } = scanSourceFileForMatches(
        sourceFile,
        program.getTypeChecker(),
        workspacePath,
      );
      bucket.matches.push(...matches);
      bucket.ambiguousReferences.push(...ambiguous);
    } catch {
      bucket.filesFailedToLoad.push(file.path);
    }
  }

  return results;
}

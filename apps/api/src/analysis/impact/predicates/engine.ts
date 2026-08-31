import ts from 'typescript';
import type { ExtractedFile } from '../../archive.js';
import { nearestWorkspaceFor, workspacePathOf } from '../../evidence/manifests.js';
import { STRIPE_TYPE_STUB_CONTENT, STRIPE_TYPE_STUB_PATH } from '../stripe-type-stub.js';
import type { Finding } from '../types.js';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const TSCONFIG_BASENAME_PATTERN = /^tsconfig(\.[\w-]+)?\.json$/;

/**
 * Type flags treated as "genuinely can't be resolved either way" by every
 * predicate's type-based fallback checks: `any` (unresolved imports,
 * dynamic construction) and `unknown` (an explicit annotation meaning
 * "could be anything," semantically the same abstention signal as `any`
 * for provenance purposes). Shared so all three predicates apply the same
 * ambiguity contract.
 */
export const UNRESOLVABLE_TYPE_FLAGS = ts.TypeFlags.Any | ts.TypeFlags.Unknown;

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

/**
 * A rule-specific AST visitor: given a real bounded Program's SourceFile
 * and TypeChecker (built against the trusted stripe stub -- see
 * stripe-type-stub.ts), find matches/ambiguous references for one
 * predicate. Shared three-way contract across every predicate primitive:
 * confirmed match, confirmed non-match (silently excluded, not returned
 * at all), or ambiguous (never silently dropped to a negative).
 */
export type PredicateVisitor = (
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  workspacePath: string,
) => { matches: Finding[]; ambiguous: AmbiguousReference[] };

function isSourceFile(path: string): boolean {
  const dotIndex = path.lastIndexOf('.');
  return dotIndex !== -1 && SOURCE_EXTENSIONS.has(path.slice(dotIndex));
}

function directoryOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
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
 * Scans every extracted source file matching `prefilter` (a cheap lexical
 * check on raw file text, applied before ever building a Program --
 * candidate discovery only, never decisive) with `visitor` (the real
 * TypeChecker-based semantic proof for one predicate), grouped by
 * workspace. Building a Program is a bounded, in-memory, per-file
 * operation -- never real disk I/O, never node_modules, never
 * `ts.createProgram` over the whole repo. Shared by every predicate
 * primitive; rule-specific logic lives entirely in `prefilter`/`visitor`.
 */
export function scanFilesWithVisitor(
  files: ExtractedFile[],
  prefilter: (fileContent: string) => boolean,
  visitor: PredicateVisitor,
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

  const candidates = files.filter((file) => isSourceFile(file.path) && prefilter(file.content));

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

      const { matches, ambiguous } = visitor(sourceFile, program.getTypeChecker(), workspacePath);
      bucket.matches.push(...matches);
      bucket.ambiguousReferences.push(...ambiguous);
    } catch {
      bucket.filesFailedToLoad.push(file.path);
    }
  }

  return results;
}

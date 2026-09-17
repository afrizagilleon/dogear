/**
 * extension/project/linker.ts
 * Module linker for disk/OPFS notebook projects (D-3, D-4, D-6, RQ-04, RQ-05, RQ-06, RQ-07).
 *
 * Resolves local relative import graph from ProjectStore bottom-up and bundles them into
 * a single executable source string with embedded V3 Source Map for error stack trace fidelity.
 * Prohibits blob-based URLs (INV-10), bare imports (INV-8), and cyclic dependencies.
 */

import type { ProjectStore } from '../platform/interface';
import type { ModuleLineMapEntry } from '../kernel/errors';
import { normalizeProjectPath } from './memory';

export interface LinkedModuleResult {
  source: string;
  entryPath: string;
  dependencies: string[];
  durationMs: number;
  lineMap: ModuleLineMapEntry[];
}

export function encodeVLQ(value: number): string {
  const VLQ_BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let vlq = value < 0 ? (-value << 1) | 1 : value << 1;
  let encoded = '';
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) {
      digit |= 32;
    }
    encoded += VLQ_BASE64[digit];
  } while (vlq > 0);
  return encoded;
}

export function resolveRelativePath(fromPath: string, relativeSpecifier: string): string {
  const fromDir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
  const combined = fromDir ? `${fromDir}/${relativeSpecifier}` : relativeSpecifier;

  const parts = combined.split('/');
  const stack: string[] = [];

  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (stack.length > 0) stack.pop();
    } else {
      stack.push(part);
    }
  }

  return stack.join('/');
}

interface ParsedImport {
  raw: string;
  specifier: string;
  defaultImport?: string;
  namedImports?: Array<{ imported: string; local: string }>;
  namespaceImport?: string;
  sideEffectOnly?: boolean;
}

export function parseImports(code: string, importerPath: string): ParsedImport[] {
  const imports: ParsedImport[] = [];
  const importRegex = /(?:^|\n)\s*import\s+(?:(?:(?:\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*,)?\s*\{([^}]+)\})|(?:\*\s+as\s+([a-zA-Z_$][a-zA-Z0-9_$]*))|([a-zA-Z_$][a-zA-Z0-9_$]*)|)\s*(?:from\s*)?['"]([^'"]+)['"]\s*;?/g;

  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(code)) !== null) {
    const raw = match[0].trim();
    const specifier = match[5];
    const namedGroup = match[2];
    const namespaceGroup = match[3];
    const defaultGroup = match[4] || match[1];

    // Check bare import
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      throw new Error(
        `✖ ModuleResolutionError: Bare import specifier '${specifier}' di '${importerPath}' tidak didukung.\n` +
          `  Sebab: Notebook di disk hanya mendukung modul lokal dengan path relatif (./ atau ../).\n` +
          `  Tindakan: Gunakan path relatif atau definisikan helper lokal.`
      );
    }

    const item: ParsedImport = {
      raw,
      specifier,
    };

    if (defaultGroup) {
      item.defaultImport = defaultGroup.trim();
    }

    if (namespaceGroup) {
      item.namespaceImport = namespaceGroup.trim();
    }

    if (namedGroup) {
      item.namedImports = namedGroup.split(',').map((part) => {
        const trimmed = part.trim();
        const asMatch = trimmed.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s+as\s+([a-zA-Z_$][a-zA-Z0-9_$]*)$/);
        if (asMatch) {
          return { imported: asMatch[1], local: asMatch[2] };
        }
        return { imported: trimmed, local: trimmed };
      }).filter(p => p.imported.length > 0);
    }

    if (!defaultGroup && !namespaceGroup && !namedGroup) {
      item.sideEffectOnly = true;
    }

    imports.push(item);
  }

  return imports;
}

export function transformModuleCode(
  code: string,
  importerPath: string,
  importVarMap: Map<string, string> // specifier -> moduleVarName
): { transformedCode: string; lineCount: number } {
  let transformed = code;

  // 1. Replace imports with local const assignments from dependency module objects
  const parsed = parseImports(code, importerPath);
  for (const imp of parsed) {
    const modVar = importVarMap.get(imp.specifier);
    if (!modVar) continue;

    const assignments: string[] = [];
    if (imp.defaultImport) {
      assignments.push(`const ${imp.defaultImport} = (${modVar}.default !== undefined ? ${modVar}.default : ${modVar});`);
    }
    if (imp.namespaceImport) {
      assignments.push(`const ${imp.namespaceImport} = ${modVar};`);
    }
    if (imp.namedImports && imp.namedImports.length > 0) {
      const destruct = imp.namedImports
        .map((n) => (n.imported === n.local ? n.local : `${n.imported}: ${n.local}`))
        .join(', ');
      assignments.push(`const { ${destruct} } = ${modVar};`);
    }
    if (imp.sideEffectOnly) {
      assignments.push(`${modVar};`);
    }

    const replacement = assignments.join(' ');
    transformed = transformed.replace(imp.raw, replacement);
  }

  // 2. Transform named and default exports into `__exports.xxx = ...`
  transformed = transformed.replace(/(?:^|\n)\s*export\s+default\s+(?:function\s*([a-zA-Z0-9_$]*)\s*\(([^)]*)\)\s*\{|class\s*([a-zA-Z0-9_$]*)|([^;]+);?)/g, (m, fnName, fnParams, clsName, expr) => {
    if (fnName || fnParams !== undefined) {
      const name = fnName || '__anon_default_fn';
      return `\nfunction ${name}(${fnParams || ''}) {\n__exports.default = ${name};\n`;
    }
    if (clsName) {
      return `\nclass ${clsName} {\n__exports.default = ${clsName};\n`;
    }
    return `\n__exports.default = ${expr};`;
  });

  // Transform export function / class / const / let / var
  transformed = transformed.replace(/(?:^|\n)\s*export\s+function\s+([a-zA-Z0-9_$]+)/g, '\nfunction $1');
  transformed = transformed.replace(/(?:^|\n)\s*export\s+class\s+([a-zA-Z0-9_$]+)/g, '\nclass $1');
  transformed = transformed.replace(/(?:^|\n)\s*export\s+(const|let|var)\s+([^;]+);/g, '\n$1 $2;');

  // Append export assignments for function, class, const/let/var declarations
  const exportedDecls = code.matchAll(/(?:^|\n)\s*export\s+(?:function\s+([a-zA-Z0-9_$]+)|class\s+([a-zA-Z0-9_$]+)|(?:const|let|var)\s+([a-zA-Z0-9_$]+))/g);
  const trailingExports: string[] = [];
  for (const match of exportedDecls) {
    const ident = match[1] || match[2] || match[3];
    if (ident) {
      trailingExports.push(`__exports.${ident} = ${ident};`);
    }
  }

  // Transform export { a, b as c }
  transformed = transformed.replace(/(?:^|\n)\s*export\s*\{([^}]+)\}\s*;?/g, (m, group) => {
    const parts = group.split(',').map((p: string) => p.trim());
    const assignments = parts.map((part: string) => {
      const asMatch = part.match(/^([a-zA-Z0-9_$]+)\s+as\s+([a-zA-Z0-9_$]+)$/);
      if (asMatch) {
        return `__exports.${asMatch[2]} = ${asMatch[1]};`;
      }
      return `__exports.${part} = ${part};`;
    });
    return `\n${assignments.join(' ')}`;
  });

  if (trailingExports.length > 0) {
    transformed += `\n${trailingExports.join(' ')}`;
  }

  const lineCount = transformed.split('\n').length;
  return { transformedCode: transformed, lineCount };
}

export class NotebookModuleLinker {
  constructor(private store: ProjectStore) {}

  async link(entryPath: string, entrySourceOverride?: string): Promise<LinkedModuleResult> {
    const startTime = performance.now();
    const normEntry = normalizeProjectPath(entryPath);

    // 1. Dependency discovery & cycle check via DFS
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const order: string[] = []; // Bottom-up execution order
    const moduleSources = new Map<string, string>();

    const dfs = async (currentPath: string, trace: string[]): Promise<void> => {
      if (recursionStack.has(currentPath)) {
        const cycle = [...trace, currentPath].join(' -> ');
        throw new Error(
          `✖ CyclicDependencyError: Terdeteksi dependensi siklis modul: '${cycle}'.\n` +
            `  Sebab: Eksekusi cell berurutan memerlukan graf asiklis (DAG).\n` +
            `  Tindakan: Pisahkan modul bersama atau refactor dependensi agar tidak membentuk siklus.`
        );
      }

      if (visited.has(currentPath)) return;

      recursionStack.add(currentPath);
      trace.push(currentPath);

      // Load code
      let code: string;
      if (currentPath === normEntry && entrySourceOverride !== undefined) {
        code = entrySourceOverride;
      } else {
        const exists = await this.store.exists(currentPath);
        if (!exists) {
          const parent = trace.length > 1 ? trace[trace.length - 2] : 'entry';
          throw new Error(
            `✖ ModuleResolutionError: Modul '${currentPath}' yang diimpor oleh '${parent}' tidak ditemukan.\n` +
              `  Sebab: Berkas '${currentPath}' tidak ada di project store.\n` +
              `  Tindakan: Periksa jalur impor atau buat berkas tersebut di direktori project.`
          );
        }
        code = await this.store.readFile(currentPath);
      }

      moduleSources.set(currentPath, code);

      // Parse imports
      const imports = parseImports(code, currentPath);
      for (const imp of imports) {
        const resolvedPath = resolveRelativePath(currentPath, imp.specifier);
        await dfs(resolvedPath, trace);
      }

      trace.pop();
      recursionStack.delete(currentPath);
      visited.add(currentPath);
      order.push(currentPath);
    };

    await dfs(normEntry, []);

    // 2. Assemble bundled source
    // Dependencies come first, entry file is last in order
    const dependencyPaths = order.filter((p) => p !== normEntry);
    const moduleVarMap = new Map<string, string>(); // path -> varName
    let varIndex = 0;

    for (const depPath of dependencyPaths) {
      moduleVarMap.set(depPath, `__nb_mod_${varIndex++}`);
    }

    const outputChunks: string[] = [];
    const sourceMapSources: string[] = [];
    const sourceMapMappings: string[] = [];
    const lineMap: ModuleLineMapEntry[] = [];
    let currentCombinedLine = 1;

    // Bundle dependencies
    for (const depPath of dependencyPaths) {
      const code = moduleSources.get(depPath)!;
      const varName = moduleVarMap.get(depPath)!;

      const importVarMap = new Map<string, string>();
      const parsed = parseImports(code, depPath);
      for (const imp of parsed) {
        const target = resolveRelativePath(depPath, imp.specifier);
        const targetVar = moduleVarMap.get(target);
        if (targetVar) importVarMap.set(imp.specifier, targetVar);
      }

      const { transformedCode } = transformModuleCode(code, depPath, importVarMap);
      const chunkHeader = `// [Module: ${depPath}]\nconst ${varName} = (() => {\n  const __exports = {};\n`;
      const headerLines = chunkHeader.split('\n').length - 1;
      const codeLines = transformedCode.split('\n').length;
      const chunkFooter = `\n  return __exports;\n})();`;
      const fullChunk = `${chunkHeader}${transformedCode}${chunkFooter}`;

      const startLine = currentCombinedLine + headerLines;
      const endLine = startLine + codeLines - 1;
      lineMap.push({
        filePath: depPath,
        startLine,
        endLine,
        originalContent: code,
      });

      outputChunks.push(fullChunk);
      sourceMapSources.push(depPath);

      currentCombinedLine += fullChunk.split('\n').length + 1; // +1 for \n\n chunk join
    }

    // Transform entry step
    const entryCode = moduleSources.get(normEntry)!;
    const entryImportVarMap = new Map<string, string>();
    const entryImports = parseImports(entryCode, normEntry);
    for (const imp of entryImports) {
      const target = resolveRelativePath(normEntry, imp.specifier);
      const targetVar = moduleVarMap.get(target);
      if (targetVar) entryImportVarMap.set(imp.specifier, targetVar);
    }

    const { transformedCode: finalEntryCode } = transformModuleCode(entryCode, normEntry, entryImportVarMap);
    const entryHeader = `// [Step Entry: ${normEntry}]\n`;
    const entryHeaderLines = entryHeader.split('\n').length - 1;
    const entryCodeLines = finalEntryCode.split('\n').length;
    const fullEntryChunk = `${entryHeader}${finalEntryCode}`;

    const entryStartLine = currentCombinedLine + entryHeaderLines;
    const entryEndLine = entryStartLine + entryCodeLines - 1;
    lineMap.push({
      filePath: normEntry,
      startLine: entryStartLine,
      endLine: entryEndLine,
      originalContent: entryCode,
    });

    outputChunks.push(fullEntryChunk);
    sourceMapSources.push(normEntry);

    const bundledSource = outputChunks.join('\n\n');

    // 3. Generate embedded V3 Source Map for error stack trace accuracy (D-4, RQ-06)
    // Simple line-by-line source mapping
    let _generatedLine = 0;
    let prevSourceIndex = 0;
    let prevSourceLine = 0;

    for (let i = 0; i < sourceMapSources.length; i++) {
      const sPath = sourceMapSources[i];
      const origLines = (moduleSources.get(sPath) || '').split('\n').length;
      for (let line = 0; line < origLines; line++) {
        const seg = encodeVLQ(0) + encodeVLQ(i - prevSourceIndex) + encodeVLQ(line - prevSourceLine) + encodeVLQ(0);
        sourceMapMappings.push(seg);
        prevSourceIndex = i;
        prevSourceLine = line;
      }
    }

    const v3Map = {
      version: 3,
      sources: sourceMapSources,
      mappings: sourceMapMappings.join(';'),
    };
    const jsonStr = JSON.stringify(v3Map);
    const base64Map = typeof Buffer !== 'undefined'
      ? Buffer.from(jsonStr, 'utf8').toString('base64')
      : btoa(unescape(encodeURIComponent(jsonStr)));
    const fullLinkedSource = `${bundledSource}\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64Map}`;

    const durationMs = performance.now() - startTime;

    return {
      source: fullLinkedSource,
      entryPath: normEntry,
      dependencies: dependencyPaths,
      durationMs,
      lineMap,
    };
  }
}

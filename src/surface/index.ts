import type { Config, Symbol } from "../types.js";
import { extractPython } from "./python.js";
import { extractRust } from "./rust.js";
import { extractRustdoc } from "./rustdoc.js";
import { extractGo } from "./go.js";
import { extractJava } from "./java.js";
import type { DocstringEntry, ExtractResult } from "./protocol.js";
import { extractTypescript } from "./typescript.js";

export function extractSurface(root: string, files: string[], config: Config): ExtractResult {
  const pythonFiles = files.filter((file) => file.endsWith(".py"));
  const rustFiles = files.filter((file) => file.endsWith(".rs"));
  const goFiles = files.filter((file) => file.endsWith(".go"));
  const javaFiles = files.filter((file) => file.endsWith(".java"));
  const scriptFiles = files.filter((file) => !/\.(?:py|rs|go)$/u.test(file));
  const results: ExtractResult[] = [];

  if (config.languages.typescript && scriptFiles.length > 0) {
    results.push(extractTypescript(root, scriptFiles));
  }
  if (config.languages.python && pythonFiles.length > 0) {
    results.push(extractPython(root, pythonFiles));
  }
  if (config.languages.rust && rustFiles.length > 0) {
    results.push(extractRust(root, rustFiles));
    if (config.languages.rustdoc) {
      results.push(extractRustdoc(root, rustFiles));
    }
  }
  if (config.languages.go && goFiles.length > 0) {
    results.push(extractGo(root, goFiles));
  }
  if (config.javadoc && javaFiles.length > 0) {
    results.push(extractJava(root, javaFiles, config.javaDefaults));
  }

  const symbols: Symbol[] = [];
  const docstrings: DocstringEntry[] = [];
  const javadocs: DocstringEntry[] = [];
  let parseFailures = 0;
  let filesScanned = 0;
  const errors: string[] = [];
  for (const result of results) {
    symbols.push(...result.symbols);
    docstrings.push(...(result.docstrings ?? []));
    javadocs.push(...(result.javadocs ?? []));
    parseFailures += result.parseFailures;
    filesScanned += result.filesScanned;
    if (result.error) errors.push(result.error);
  }

  const syntacticKeys = new Set(
    symbols
      .filter((symbol) => !symbol.id.includes("|rustdoc|"))
      .map((symbol) => `${symbol.name}|${symbol.kind}|${symbol.modulePath}`),
  );
  const deduped = new Map<string, Symbol>();
  for (const symbol of symbols) {
    if (
      symbol.id.includes("|rustdoc|") &&
      syntacticKeys.has(`${symbol.name}|${symbol.kind}|${symbol.modulePath}`)
    ) {
      continue;
    }
    deduped.set(symbol.id, symbol);
  }
  const finalSymbols = [...deduped.values()];
  finalSymbols.sort((left, right) => left.id.localeCompare(right.id));
  return {
    symbols: finalSymbols,
    docstrings,
    javadocs,
    parseFailures,
    filesScanned,
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
  };
}

export { extractTypescript, extractPython, extractRust, extractRustdoc, extractGo, extractJava };
export type { DocstringEntry, ExtractResult };

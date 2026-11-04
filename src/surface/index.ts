import type { Config, Symbol } from "../types.js";
import { BUILTIN_EXTRACTORS, filesFor } from "./plugins.js";
import type { DocstringEntry, ExtractResult } from "./protocol.js";

export function extractSurface(root: string, files: string[], config: Config): ExtractResult {
  const results: ExtractResult[] = [];
  for (const plugin of BUILTIN_EXTRACTORS) {
    if (!plugin.enabled(config)) {
      if (plugin.id === "rustdoc" && config.languages.rustdoc) {
        results.push({
          symbols: [],
          parseFailures: 0,
          filesScanned: 0,
          error: "rustdoc skipped: cargo execution is disabled; pass --allow-exec or set allowExec to true",
        });
      }
      continue;
    }
    const selected = filesFor(plugin, files);
    if (selected.length > 0) results.push(plugin.extract({ root, files: selected, config }));
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

export { extractTypescript } from "./typescript.js";
export { extractPython } from "./python.js";
export { extractRust } from "./rust.js";
export { extractRustdoc } from "./rustdoc.js";
export { extractGo } from "./go.js";
export { extractJava } from "./java.js";
export type { DocstringEntry, ExtractResult };

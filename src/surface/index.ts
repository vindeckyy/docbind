import type { Config, Symbol } from "../types.js";
import { extractPython } from "./python.js";
import { extractRust } from "./rust.js";
import { extractGo } from "./go.js";
import type { ExtractResult } from "./protocol.js";
import { extractTypescript } from "./typescript.js";

export function extractSurface(root: string, files: string[], config: Config): ExtractResult {
  const pythonFiles = files.filter((file) => file.endsWith(".py"));
  const rustFiles = files.filter((file) => file.endsWith(".rs"));
  const goFiles = files.filter((file) => file.endsWith(".go"));
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
  }
  if (config.languages.go && goFiles.length > 0) {
    results.push(extractGo(root, goFiles));
  }

  const symbols: Symbol[] = [];
  let parseFailures = 0;
  let filesScanned = 0;
  const errors: string[] = [];
  for (const result of results) {
    symbols.push(...result.symbols);
    parseFailures += result.parseFailures;
    filesScanned += result.filesScanned;
    if (result.error) errors.push(result.error);
  }

  symbols.sort((left, right) => left.id.localeCompare(right.id));
  return {
    symbols,
    parseFailures,
    filesScanned,
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
  };
}

export { extractTypescript, extractPython, extractRust, extractGo };
export type { ExtractResult };

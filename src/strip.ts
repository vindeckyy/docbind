import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverDocs } from "./discover.js";
import type { Config } from "./types.js";

export interface StripResult {
  files: string[];
  removed: number;
}

const ANNOTATION = /^\s*<!--\s*docbind:.*?-->\s*$/u;

export function stripAnnotations(root: string, config: Config, write: boolean): StripResult {
  const files: string[] = [];
  let removed = 0;
  for (const docPath of discoverDocs(root, config)) {
    const path = join(root, docPath);
    const original = readFileSync(path, "utf8");
    const lines = original.split(/\r?\n/u);
    const kept = lines.filter((line) => !ANNOTATION.test(line));
    const count = lines.length - kept.length;
    if (count === 0) continue;
    removed += count;
    files.push(docPath);
    if (write) writeFileSync(path, kept.join("\n"), "utf8");
  }
  return { files, removed };
}

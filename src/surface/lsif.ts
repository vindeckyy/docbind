import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashText } from "../hash.js";
import { shapeHash } from "../shape/canonical.js";
import type { Symbol } from "../types.js";

interface LsifElement {
  id?: number;
  type?: string;
  label?: string;
  uri?: string;
  kind?: string;
  identifier?: string;
  scheme?: string;
  outV?: number;
  inV?: number;
  inVs?: number[];
  start?: { line?: number; character?: number };
}

export interface LsifResult {
  symbols: Symbol[];
  error?: string;
}

function parseLines(text: string): LsifElement[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) return JSON.parse(trimmed) as LsifElement[];
  const elements: LsifElement[] = [];
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    elements.push(JSON.parse(line) as LsifElement);
  }
  return elements;
}

function filePathFor(uri: string, root: string): string {
  if (uri.startsWith("file://")) {
    return relative(root, fileURLToPath(uri)).split("\\").join("/");
  }
  const absolute = resolve(root, uri);
  return relative(root, absolute).split("\\").join("/");
}

function nameFor(identifier: string): string {
  const parts = identifier.split(/[#./:]+/u).filter(Boolean);
  return parts[parts.length - 1] ?? identifier;
}

export function extractLsif(root: string, paths: string[]): LsifResult {
  const symbols: Symbol[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    let elements: LsifElement[];
    try {
      elements = parseLines(readFileSync(isAbsolute(path) ? path : join(root, path), "utf8"));
    } catch (error) {
      return { symbols, error: `LSIF index unreadable: ${path} (${(error as Error).message})` };
    }
    const documents = new Map<number, string>();
    const ranges = new Map<number, { document: number; line: number }>();
    const monikers = new Map<number, LsifElement>();
    for (const element of elements) {
      if (element.type === "vertex" && element.label === "document" && element.id !== undefined && element.uri) {
        documents.set(element.id, filePathFor(element.uri, root));
      }
      if (element.type === "vertex" && element.label === "range" && element.id !== undefined) {
        ranges.set(element.id, { document: -1, line: (element.start?.line ?? 0) + 1 });
      }
      if (element.type === "vertex" && element.label === "moniker" && element.id !== undefined) {
        monikers.set(element.id, element);
      }
    }
    for (const element of elements) {
      if (element.type !== "edge" || element.label !== "contains" || element.outV === undefined) continue;
      for (const id of [element.inV, ...(element.inVs ?? [])]) {
        if (id === undefined) continue;
        const range = ranges.get(id);
        if (range) range.document = element.outV;
      }
    }
    for (const element of elements) {
      if (element.type !== "edge" || element.label !== "next" || element.outV === undefined || element.inV === undefined) continue;
      const range = ranges.get(element.outV);
      const moniker = monikers.get(element.inV);
      if (!range || !moniker || !moniker.identifier) continue;
      if (moniker.kind === "local" || moniker.kind === "import") continue;
      const document = documents.get(range.document);
      if (!document) continue;
      const key = `${document}\u0000${moniker.identifier}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const name = nameFor(moniker.identifier);
      const shape = { kind: "function" as const };
      const modulePath = moniker.identifier.slice(0, Math.max(0, moniker.identifier.length - name.length)).replace(/[#./:]+$/u, "");
      symbols.push({
        id: `lsif|${moniker.scheme ?? "unknown"}|${moniker.identifier}|${document}`,
        name,
        kind: "function",
        modulePath: modulePath || document,
        packageName: "lsif",
        packageRoot: root,
        qualifiedName: moniker.identifier,
        aliases: [],
        shape,
        shapeText: JSON.stringify(shape),
        shapeHash: shapeHash(shape),
        paramNamesHash: hashText(""),
        bodyHash: "",
        contractFlags: [],
        packageExport: true,
        indexOnly: true,
        line: range.line,
        filePath: document,
      });
    }
  }
  return { symbols };
}

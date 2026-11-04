import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { hashText } from "../hash.js";
import { shapeHash } from "../shape/canonical.js";
import type { Symbol, SymbolKind } from "../types.js";

interface Field {
  number: number;
  wire: number;
  value: Buffer | number;
}

export interface ScipResult {
  symbols: Symbol[];
  error?: string;
}

function readVarint(buffer: Buffer, start: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let position = start;
  while (position < buffer.length) {
    const byte = buffer[position] as number;
    position += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, next: position };
    shift += 7;
    if (shift > 63) break;
  }
  throw new Error("truncated varint");
}

function readFields(buffer: Buffer): Field[] {
  const fields: Field[] = [];
  let position = 0;
  while (position < buffer.length) {
    const key = readVarint(buffer, position);
    position = key.next;
    const number = key.value >> 3;
    const wire = key.value & 7;
    if (wire === 0) {
      const value = readVarint(buffer, position);
      position = value.next;
      fields.push({ number, wire, value: value.value });
    } else if (wire === 2) {
      const length = readVarint(buffer, position);
      position = length.next;
      const end = position + length.value;
      if (end > buffer.length) throw new Error("truncated length-delimited field");
      fields.push({ number, wire, value: buffer.subarray(position, end) });
      position = end;
    } else if (wire === 1) {
      position += 8;
    } else if (wire === 5) {
      position += 4;
    } else {
      throw new Error(`unsupported wire type ${wire}`);
    }
  }
  return fields;
}

function strings(fields: Field[], number: number): string[] {
  return fields
    .filter((field) => field.number === number && field.wire === 2)
    .map((field) => (field.value as Buffer).toString("utf8"));
}

function messages(fields: Field[], number: number): Buffer[] {
  return fields
    .filter((field) => field.number === number && field.wire === 2)
    .map((field) => field.value as Buffer);
}

function unsigned(fields: Field[], number: number): number | undefined {
  const field = fields.find((candidate) => candidate.number === number && candidate.wire === 0);
  return typeof field?.value === "number" ? field.value : undefined;
}

function packedInts(fields: Field[], number: number): number[] {
  const values: number[] = [];
  for (const field of fields) {
    if (field.number !== number) continue;
    if (field.wire === 0 && typeof field.value === "number") {
      values.push(field.value);
      continue;
    }
    if (field.wire !== 2) continue;
    const buffer = field.value as Buffer;
    let position = 0;
    while (position < buffer.length) {
      const value = readVarint(buffer, position);
      values.push(value.value);
      position = value.next;
    }
  }
  return values;
}

const KINDS: Record<number, SymbolKind> = {
  8: "const",
  11: "enum",
  12: "enumMember",
  15: "property",
  17: "function",
  21: "interface",
  26: "method",
  29: "module",
  41: "property",
  49: "class",
  54: "type",
  61: "const",
  7: "class",
};

export function nameFromSymbol(symbol: string): string {
  if (symbol.startsWith("local ")) return symbol.slice(6);
  const parts = symbol.split(" ");
  const descriptor = parts.slice(4).join(" ");
  const last = descriptor.split(/[/#]/u).filter(Boolean).pop() ?? descriptor;
  return last.replace(/\([^)]*\)\.?$/u, "").replace(/[.:!]+$/u, "");
}

export function extractScip(root: string, path: string): ScipResult {
  let buffer: Buffer;
  try {
    buffer = readFileSync(isAbsolute(path) ? path : join(root, path));
  } catch (error) {
    return { symbols: [], error: `SCIP index unreadable: ${path} (${(error as Error).message})` };
  }
  const symbols: Symbol[] = [];
  const seen = new Set<string>();
  try {
    const index = readFields(buffer);
    for (const document of messages(index, 2)) {
      const doc = readFields(document);
      const relativePath = strings(doc, 1)[0];
      if (!relativePath) continue;
      const info = new Map<string, { kind: SymbolKind; displayName?: string }>();
      for (const symbolInfo of messages(doc, 3)) {
        const fields = readFields(symbolInfo);
        const id = strings(fields, 1)[0];
        if (!id) continue;
        const kindNumber = unsigned(fields, 5);
        info.set(id, {
          kind: (kindNumber !== undefined ? KINDS[kindNumber] : undefined) ?? "function",
          displayName: strings(fields, 6)[0],
        });
      }
      for (const occurrence of messages(doc, 2)) {
        const fields = readFields(occurrence);
        const roles = unsigned(fields, 3) ?? 0;
        if ((roles & 1) === 0) continue;
        const id = strings(fields, 2)[0];
        if (!id || id.startsWith("local ")) continue;
        let range = packedInts(fields, 1);
        const single = messages(fields, 8)[0];
        if (single) {
          const typed = readFields(single);
          range = [unsigned(typed, 1) ?? 0, unsigned(typed, 2) ?? 0, unsigned(typed, 3) ?? 0];
        }
        const line = (range[0] ?? 0) + 1;
        const metadata = info.get(id);
        const kind = metadata?.kind ?? "function";
        const name = metadata?.displayName ?? nameFromSymbol(id);
        if (!name) continue;
        const key = `${relativePath}\u0000${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const shape = { kind };
        symbols.push({
          id: `scip|${id}|${relativePath}`,
          name,
          kind,
          modulePath: id,
          packageName: "scip",
          packageRoot: root,
          qualifiedName: id,
          aliases: [],
          shape,
          shapeText: JSON.stringify(shape),
          shapeHash: shapeHash(shape),
          paramNamesHash: hashText(""),
          bodyHash: "",
          contractFlags: [],
          packageExport: true,
          indexOnly: true,
          line,
          filePath: relativePath,
        });
      }
    }
  } catch (error) {
    return { symbols, error: `SCIP index invalid: ${path} (${(error as Error).message})` };
  }
  return { symbols };
}

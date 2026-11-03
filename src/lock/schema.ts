import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Binding, LockEntry, LockFile, Symbol, Tombstone } from "../types.js";
import { ENGINE_VERSION } from "../version.js";

const symbolKindSchema = z.enum([
  "function",
  "class",
  "method",
  "property",
  "interface",
  "type",
  "const",
  "enum",
  "enumMember",
  "module",
]);

const anchorSchema = z
  .object({
    docPath: z.string(),
    line: z.number().optional(),
    contextFp: z.string(),
    token: z.string(),
    occurrence: z.number().int().nonnegative(),
    symbolId: z.string(),
    name: z.string(),
    qualifiedName: z.string(),
    kind: symbolKindSchema,
    shapeHash: z.string(),
    shape: z.string(),
    paramNamesHash: z.string(),
    bodyHash: z.string(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const tombstoneSchema = z
  .object({
    symbolId: z.string(),
    name: z.string(),
    qualifiedName: z.string(),
    kind: symbolKindSchema,
    shapeHash: z.string(),
    shape: z.string(),
    bodyHash: z.string(),
    removedInGeneration: z.number().int().nonnegative(),
    renamedTo: z.string().optional(),
  })
  .strict();

const lockSchema = z
  .object({
    schema: z.literal(1),
    engine: z.string(),
    generation: z.number().int().nonnegative(),
    anchors: z.array(anchorSchema),
    tombstones: z.array(tombstoneSchema),
  })
  .strict();

export function lockPath(root: string): string {
  return join(root, "docbind.lock.json");
}

export function emptyLock(): LockFile {
  return {
    schema: 1,
    engine: ENGINE_VERSION,
    generation: 0,
    anchors: [],
    tombstones: [],
  };
}

export function sortLock(lock: LockFile): LockFile {
  return {
    ...lock,
    anchors: [...lock.anchors].sort((left, right) => {
      if (left.docPath !== right.docPath) return left.docPath.localeCompare(right.docPath);
      if (left.contextFp !== right.contextFp) return left.contextFp.localeCompare(right.contextFp);
      if (left.token !== right.token) return left.token.localeCompare(right.token);
      return left.occurrence - right.occurrence;
    }),
    tombstones: [...lock.tombstones].sort((left, right) => left.symbolId.localeCompare(right.symbolId)),
  };
}

export function serializeLock(lock: LockFile): string {
  return `${JSON.stringify(sortLock(lock), null, 2)}\n`;
}

export function parseLock(value: unknown): LockFile {
  return lockSchema.parse(value);
}

export function readLock(root: string): LockFile {
  let text: string;
  try {
    text = readFileSync(lockPath(root), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyLock();
    throw error;
  }
  return parseLock(JSON.parse(text));
}

export function writeLock(root: string, lock: LockFile): void {
  writeFileSync(lockPath(root), serializeLock(lock), "utf8");
}

export function entryFromBinding(binding: Binding): LockEntry {
  const { anchor, symbol } = binding;
  return {
    docPath: anchor.docPath,
    line: anchor.line,
    contextFp: anchor.contextFp,
    token: anchor.token,
    occurrence: anchor.occurrence,
    symbolId: symbol.id,
    name: symbol.name,
    qualifiedName: symbol.qualifiedName,
    kind: symbol.kind,
    shapeHash: symbol.shapeHash,
    shape: symbol.shapeText,
    paramNamesHash: symbol.paramNamesHash,
    bodyHash: symbol.bodyHash,
    confidence: binding.score,
  };
}

export function tombstoneFromSymbol(symbol: Symbol, generation: number, renamedTo?: string): Tombstone {
  return {
    symbolId: symbol.id,
    name: symbol.name,
    qualifiedName: symbol.qualifiedName,
    kind: symbol.kind,
    shapeHash: symbol.shapeHash,
    shape: symbol.shapeText,
    bodyHash: symbol.bodyHash,
    removedInGeneration: generation,
    ...(renamedTo ? { renamedTo } : {}),
  };
}

export function lockContentEqual(left: LockFile, right: LockFile): boolean {
  return serializeLock({ ...left, generation: 0, engine: "" }) ===
    serializeLock({ ...right, generation: 0, engine: "" });
}

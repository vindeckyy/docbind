import { LOCK_FORMAT, emptyLock, parseLock } from "./schema.js";
import type { LockFile } from "../types.js";

export interface MigrationResult {
  lock: LockFile;
  changed: boolean;
  actions: string[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const ANCHOR_KEYS = [
  "docPath", "line", "contextFp", "token", "occurrence", "symbolId", "name",
  "qualifiedName", "kind", "shapeHash", "shape", "paramNamesHash", "bodyHash", "confidence",
] as const;

const TOMBSTONE_KEYS = [
  "symbolId", "name", "qualifiedName", "kind", "shapeHash", "shape", "bodyHash",
  "removedInGeneration", "renamedTo",
] as const;

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
}

export function migrateLock(value: unknown): MigrationResult {
  const raw = record(value);
  if (!raw) throw new Error("lock file must be a JSON object");
  const schema = raw.schema ?? 1;
  if (typeof schema !== "number" || !Number.isInteger(schema) || schema < 1) {
    throw new Error(`unsupported lock schema: ${String(raw.schema)}`);
  }
  if (schema > 1) {
    throw new Error(`lock schema ${schema} is newer than this engine supports (1); upgrade docbind`);
  }
  const actions: string[] = [];
  if (raw.schema === undefined) actions.push("set schema 1");
  if (raw.format === undefined) actions.push(`set format ${LOCK_FORMAT}`);
  if (raw.anchors !== undefined && !Array.isArray(raw.anchors)) throw new Error("anchors must be an array");
  if (raw.tombstones !== undefined && !Array.isArray(raw.tombstones)) throw new Error("tombstones must be an array");
  if (raw.anchors === undefined) actions.push("add empty anchors");
  if (raw.tombstones === undefined) actions.push("add empty tombstones");
  const anchors = (raw.anchors ?? []).map((entry, index) => {
    const anchor = record(entry);
    if (!anchor) throw new Error(`anchor ${index} must be an object`);
    const picked = pick(anchor, ANCHOR_KEYS);
    if (Object.keys(anchor).some((key) => !ANCHOR_KEYS.includes(key as typeof ANCHOR_KEYS[number]))) {
      actions.push(`anchor ${index}: dropped unknown fields`);
    }
    if (picked.confidence === undefined) {
      actions.push(`anchor ${index}: default confidence 1`);
      picked.confidence = 1;
    }
    return picked;
  });
  const tombstones = (raw.tombstones ?? []).map((entry, index) => {
    const tombstone = record(entry);
    if (!tombstone) throw new Error(`tombstone ${index} must be an object`);
    if (Object.keys(tombstone).some((key) => !TOMBSTONE_KEYS.includes(key as typeof TOMBSTONE_KEYS[number]))) {
      actions.push(`tombstone ${index}: dropped unknown fields`);
    }
    return pick(tombstone, TOMBSTONE_KEYS);
  });
  if (raw.generation === undefined) actions.push("set generation 0");
  const lock = parseLock({
    schema: 1,
    format: raw.format ?? LOCK_FORMAT,
    engine: raw.engine ?? emptyLock().engine,
    generation: raw.generation ?? 0,
    anchors,
    tombstones,
  });
  return { lock, changed: actions.length > 0, actions };
}

export function lockNeedsMigration(value: unknown): boolean {
  return migrateLock(value).changed;
}

export function currentLock(): LockFile {
  return emptyLock();
}

import type { LockEntry, LockFile, Tombstone } from "../types.js";
import { entryFromBinding } from "./schema.js";
import type { Binding } from "../types.js";

export function entryKey(entry: Pick<LockEntry, "docPath" | "contextFp" | "token" | "occurrence">): string {
  return [entry.docPath, entry.contextFp, entry.token, String(entry.occurrence)].join("\u0000");
}

export function mergeEntries(existing: LockEntry[], pending: Binding[]): LockEntry[] {
  const byKey = new Map<string, LockEntry>();
  for (const entry of existing) byKey.set(entryKey(entry), entry);
  for (const binding of pending) {
    const entry = entryFromBinding(binding);
    byKey.set(entryKey(entry), entry);
  }
  return [...byKey.values()];
}

export function mergeTombstones(
  existing: Tombstone[],
  fresh: Tombstone[],
  referenced: Set<string>,
  generation: number,
  keepGenerations = 3,
): Tombstone[] {
  const byId = new Map<string, Tombstone>();
  for (const tombstone of existing) byId.set(tombstone.symbolId, tombstone);
  for (const tombstone of fresh) {
    const previous = byId.get(tombstone.symbolId);
    byId.set(tombstone.symbolId, previous
      ? {
          ...tombstone,
          removedInGeneration: previous.removedInGeneration,
          ...(previous.renamedTo ? { renamedTo: previous.renamedTo } : {}),
        }
      : tombstone);
  }
  return [...byId.values()].filter((tombstone) =>
    referenced.has(tombstone.symbolId) ||
    generation - tombstone.removedInGeneration <= keepGenerations
  );
}

export function nextGeneration(lock: LockFile): number {
  return lock.generation + 1;
}

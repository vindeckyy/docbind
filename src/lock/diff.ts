import { anchorKey } from "../docs/anchors.js";
import type { LockEntry, LockFile } from "../types.js";

export interface LockChange {
  before: LockEntry;
  after: LockEntry;
}

export interface LockDiff {
  added: LockEntry[];
  removed: LockEntry[];
  changed: LockChange[];
  tombstonesAdded: number;
  tombstonesRemoved: number;
}

export function diffLock(current: LockFile, expected: LockFile): LockDiff {
  const before = new Map(current.anchors.map((entry) => [anchorKey(entry), entry]));
  const after = new Map(expected.anchors.map((entry) => [anchorKey(entry), entry]));
  const added: LockEntry[] = [];
  const removed: LockEntry[] = [];
  const changed: LockChange[] = [];
  for (const [key, entry] of after) {
    const previous = before.get(key);
    if (!previous) {
      added.push(entry);
      continue;
    }
    if (previous.symbolId !== entry.symbolId || previous.shapeHash !== entry.shapeHash) {
      changed.push({ before: previous, after: entry });
    }
  }
  for (const [key, entry] of before) {
    if (!after.has(key)) removed.push(entry);
  }
  return {
    added,
    removed,
    changed,
    tombstonesAdded: expected.tombstones.length - current.tombstones.length,
    tombstonesRemoved: current.tombstones.length - expected.tombstones.length,
  };
}

export function describeLockDiff(diff: LockDiff): string[] {
  const lines: string[] = [];
  for (const entry of diff.added) {
    lines.push(`+ ${entry.docPath}:${entry.line ?? "?"} ${entry.token} -> ${entry.qualifiedName} (new anchor)`);
  }
  for (const entry of diff.removed) {
    lines.push(`- ${entry.docPath}:${entry.line ?? "?"} ${entry.token} (${entry.qualifiedName} no longer bound)`);
  }
  for (const change of diff.changed) {
    const location = `${change.after.docPath}:${change.after.line ?? "?"} ${change.after.token}`;
    if (change.before.symbolId !== change.after.symbolId) {
      lines.push(`~ ${location}: symbol moved`);
      lines.push(`    from ${change.before.qualifiedName} (${change.before.symbolId})`);
      lines.push(`    to   ${change.after.qualifiedName} (${change.after.symbolId})`);
    } else {
      lines.push(`~ ${location}: contract changed`);
      lines.push(`    from ${change.before.shapeHash}`);
      lines.push(`    to   ${change.after.shapeHash}`);
      lines.push(`    old: ${change.before.shape}`);
      lines.push(`    new: ${change.after.shape}`);
    }
  }
  if (diff.tombstonesAdded > 0) lines.push(`+ ${diff.tombstonesAdded} tombstone${diff.tombstonesAdded === 1 ? "" : "s"}`);
  if (diff.tombstonesRemoved > 0) lines.push(`- ${diff.tombstonesRemoved} tombstone${diff.tombstonesRemoved === 1 ? "" : "s"}`);
  if (lines.length === 0) lines.push("lock is up to date");
  return lines;
}

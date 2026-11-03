import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Content, Heading, Root, Table, TableRow } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { toString as mdastToString } from "mdast-util-to-string";
import { assignOccurrences } from "./anchors.js";
import { contextFingerprint, hasNegativeCue } from "./context.js";
import { fenceAnchors, isSupportedFence } from "./fences.js";
import type { PythonTypeHints } from "./infer.js";
import type { DocAnchor, ImportRef } from "../types.js";

interface WalkContext {
  heading: string;
  imports: Record<string, ImportRef>;
  tableHeader: string;
  inHeading: boolean;
  inTableCell: boolean;
  inBlockquote: boolean;
  pythonHints?: PythonTypeHints;
}

interface WalkState {
  anchors: DocAnchor[];
  ranges: Array<[number, number]>;
  inlineRanges: Array<[number, number]>;
}

function mergeImports(
  target: Record<string, ImportRef>,
  source: Record<string, ImportRef>,
): void {
  Object.assign(target, source);
}

function inlineStart(text: string, offset: number, fallbackColumn: number): number {
  let run = 0;
  while (text[offset + run] === "`") run += 1;
  return run > 0 ? fallbackColumn + run : fallbackColumn + 1;
}

function nodePosition(node: Content): { line: number; column: number; offset: number } {
  const position = node.position;
  return {
    line: position?.start.line ?? 1,
    column: position?.start.column ?? 1,
    offset: position?.start.offset ?? 0,
  };
}

function walk(
  node: Content,
  text: string,
  docPath: string,
  context: WalkContext,
  state: WalkState,
  blockText: string,
): void {
  if (node.type === "heading") {
    const heading = node as Heading;
    const previous = context.inHeading;
    context.heading = mdastToString(heading);
    context.imports = {};
    context.inHeading = true;
    for (const child of heading.children) {
      walk(child as Content, text, docPath, context, state, context.heading);
    }
    context.inHeading = previous;
    return;
  }
  if (node.type === "code") {
    const position = node.position;
    if (position?.start.offset !== undefined && position.end.offset !== undefined) {
      state.ranges.push([position.start.offset, position.end.offset]);
    }
    if (!isSupportedFence(node.lang)) return;
    const result = fenceAnchors(node, docPath, context.heading, context.pythonHints);
    state.anchors.push(...result.anchors);
    mergeImports(context.imports, result.imports);
    return;
  }
  if (node.type === "inlineCode") {
    const token = node.value;
    if (token.includes("\n") || token.trim().length === 0) return;
    const start = nodePosition(node);
    const inlineEnd = node.position?.end.offset ?? start.offset + token.length + 2;
    state.inlineRanges.push([start.offset, inlineEnd]);
    const surface = context.inHeading
      ? "headingCode"
      : context.inTableCell
        ? "tableCode"
        : "inlineCode";
    const parts = [context.heading, context.tableHeader, blockText];
    state.anchors.push({
      docPath,
      line: start.line,
      column: inlineStart(text, start.offset, start.column),
      length: token.length,
      token,
      occurrence: 0,
      surface,
      contextFp: contextFingerprint(parts, token),
      importTable: { ...context.imports },
      localDecls: [],
      fragment: false,
    });
    return;
  }
  if (node.type === "table") {
    const table = node as Table;
    const header = table.children[0] as TableRow | undefined;
    context.tableHeader = header ? mdastToString(header) : "";
    for (const child of table.children) {
      walk(child as Content, text, docPath, context, state, blockText);
    }
    context.tableHeader = "";
    return;
  }
  if (node.type === "blockquote") {
    const previous = context.inBlockquote;
    context.inBlockquote = true;
    for (const child of node.children) {
      walk(child as Content, text, docPath, context, state, blockText);
    }
    context.inBlockquote = previous;
    return;
  }

  const localBlock =
    node.type === "paragraph" ||
    node.type === "listItem" ||
    node.type === "tableCell" ||
    node.type === "definition"
      ? mdastToString(node)
      : blockText;
  const inTableCell = context.inTableCell || node.type === "tableCell";
  const previousCell = context.inTableCell;
  const previousHeading = context.inHeading;
  context.inTableCell = inTableCell;
  if (node.type === "tableCell") context.inHeading = false;
  if ("children" in node) {
    for (const child of node.children) {
      walk(child as Content, text, docPath, context, state, localBlock);
    }
  }
  context.inTableCell = previousCell;
  context.inHeading = previousHeading;
}

function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 };
}

function inRanges(offset: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => offset >= start && offset < end);
}

function explicitRefs(text: string, docPath: string, state: WalkState): void {
  const patterns: RegExp[] = [
    /\{@(?:link|linkcode)\s+([A-Za-z_$][\w$]*(?:(?:\.|::|#)[A-Za-z_$][\w$]*)*)\}/gu,
    /:(?:func|class|meth|attr|mod):`([^`\n]+)`/gu,
    /\bseealso\s*:?\s*`([^`\n]+)`/giu,
  ];
  for (const [patternIndex, pattern] of patterns.entries()) {
    for (const match of text.matchAll(pattern)) {
      const target = match[1]?.trim();
      if (!target || !/^[A-Za-z_$][\w$]*(?:(?:\.|::|#)[A-Za-z_$][\w$]*)*$/u.test(target)) continue;
      const offset = (match.index ?? 0) + match[0].indexOf(target);
      if (inRanges(offset, state.ranges)) continue;
      if (patternIndex === 0 && inRanges(offset, state.inlineRanges)) continue;
      const { line, column } = offsetToLineColumn(text, offset);
      const lines = text.split(/\r?\n/u);
      const context = [
        lines.slice(Math.max(0, line - 3), line + 2).join(" "),
      ];
      state.anchors.push({
        docPath,
        line,
        column,
        length: target.length,
        token: target,
        occurrence: 0,
        surface: "explicitRef",
        contextFp: contextFingerprint(context, target),
        importTable: {},
        localDecls: [],
        fragment: false,
      });
    }
  }
}

export interface DocParseResult {
  anchors: DocAnchor[];
  parseFailures: number;
}

export function parseDoc(
  docPath: string,
  text: string,
  pythonHints?: PythonTypeHints,
): DocParseResult {
  let root: Root;
  try {
    root = fromMarkdown(text, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    });
  } catch {
    return { anchors: [], parseFailures: 1 };
  }
  const context: WalkContext = {
    heading: "",
    imports: {},
    tableHeader: "",
    inHeading: false,
    inTableCell: false,
    inBlockquote: false,
    ...(pythonHints ? { pythonHints } : {}),
  };
  const state: WalkState = { anchors: [], ranges: [], inlineRanges: [] };
  for (const child of root.children) {
    walk(child as Content, text, docPath, context, state, "");
  }
  explicitRefs(text, docPath, state);

  const lines = text.split(/\r?\n/u);
  const kept = state.anchors.filter((anchor) => {
    const window = lines.slice(Math.max(0, anchor.line - 4), anchor.line + 3).join(" ");
    return !hasNegativeCue(window);
  });
  return { anchors: assignOccurrences(kept), parseFailures: 0 };
}

export interface DocsParseResult {
  anchors: DocAnchor[];
  parseFailures: number;
  docsScanned: number;
}

export function parseDocs(
  root: string,
  docs: string[],
  pythonHints?: PythonTypeHints,
): DocsParseResult {
  const anchors: DocAnchor[] = [];
  let parseFailures = 0;
  let docsScanned = 0;
  for (const doc of docs) {
    let text: string;
    try {
      text = readFileSync(join(root, doc), "utf8");
    } catch {
      parseFailures += 1;
      continue;
    }
    docsScanned += 1;
    const result = parseDoc(doc, text, pythonHints);
    anchors.push(...result.anchors);
    parseFailures += result.parseFailures;
  }
  return { anchors, parseFailures, docsScanned };
}

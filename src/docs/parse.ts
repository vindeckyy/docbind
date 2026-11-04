import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Code, Content, Heading, Root, Table, TableRow } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { toString as mdastToString } from "mdast-util-to-string";
import { assignOccurrences } from "./anchors.js";
import { contextFingerprint, hasNegativeCue } from "./context.js";
import { fenceAnchors, isSupportedFence } from "./fences.js";
import type { GoTypeHints, PythonTypeHints } from "./infer.js";
import type { DocAnchor, ImportRef } from "../types.js";

interface WalkContext {
  heading: string;
  imports: Record<string, ImportRef>;
  tableHeader: string;
  inHeading: boolean;
  inTableCell: boolean;
  inBlockquote: boolean;
  pythonHints?: PythonTypeHints;
  goHints?: GoTypeHints;
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
  if (node.type === "html") {
    const value = (node as { value: string }).value;
    const match = /docbind:\s*symbol=([^\s>]+)/u.exec(value);
    if (match?.[1]) {
      const contract = /contract=([0-9a-f]+)/u.exec(value)?.[1];
      const adopted = /\badopted\b/u.test(value);
      const confidence = /confidence=([0-9.]+)/u.exec(value)?.[1];
      const adoptConfidence = confidence ? Number(confidence) : undefined;
      const raw = match[1];
      const hash = raw.lastIndexOf("#");
      const token = (hash >= 0 ? raw.slice(hash + 1) : raw).trim();
      if (token.length > 0) {
        const start = nodePosition(node);
        state.anchors.push({
          docPath,
          line: start.line,
          column: start.column,
          length: token.length,
          token,
          occurrence: 0,
          surface: "explicitRef",
          contextFp: contextFingerprint([context.heading, blockText], token),
          importTable: {},
          localDecls: [],
          fragment: false,
          explicitSymbol: raw,
          contextText: blockText,
          ...(contract ? { explicitContract: contract } : {}),
          ...(adopted ? { adopted: true } : {}),
          ...(adoptConfidence !== undefined && Number.isFinite(adoptConfidence) ? { adoptConfidence } : {}),
        });
      }
    }
    return;
  }
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
    const result = fenceAnchors(node, docPath, context.heading, context.pythonHints, context.goHints);
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

const RST_ROLE_RE = /:(?:func|class|meth|attr|mod|data|exc|obj):`([^`\n]+)`/gu;
const RST_LITERAL_RE = /``([^`\n]+)``/gu;
const RST_DIRECTIVE_RE = /^\s*\.\.\s+(?:code-block|sourcecode)::\s*(\S*)\s*$/u;

function parseRstDoc(
  docPath: string,
  text: string,
  pythonHints?: PythonTypeHints,
  goHints?: GoTypeHints,
): DocParseResult {
  const lines = text.split(/\r?\n/u);
  const anchors: DocAnchor[] = [];
  const blockLines = new Set<number>();
  let heading = "";
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] as string;
    const underline = lines[index + 1] ?? "";
    if (line.trim().length > 0 && /^[=\-~^"'`#*+]{3,}\s*$/u.test(underline)) {
      heading = line.trim();
      index += 2;
      continue;
    }
    const directive = RST_DIRECTIVE_RE.exec(line);
    if (directive?.[1]) {
      let cursor = index + 1;
      while (cursor < lines.length && /^\s*:.*:\s*$/u.test((lines[cursor] as string).trim())) cursor += 1;
      while (cursor < lines.length && (lines[cursor] as string).trim().length === 0) cursor += 1;
      const start = cursor;
      while (cursor < lines.length) {
        const candidate = lines[cursor] as string;
        if (candidate.trim().length > 0 && !/^\s/u.test(candidate)) break;
        cursor += 1;
      }
      while (cursor > start && (lines[cursor - 1] as string).trim().length === 0) cursor -= 1;
      const indent = Math.min(
        ...lines.slice(start, cursor).filter((value) => value.trim().length > 0).map((value) => value.length - value.trimStart().length),
      );
      const value = lines
        .slice(start, cursor)
        .map((value) => value.slice(Number.isFinite(indent) ? indent : 0))
        .join("\n");
      for (let lineIndex = start; lineIndex < cursor; lineIndex += 1) blockLines.add(lineIndex);
      if (isSupportedFence(directive[1]) && value.trim().length > 0) {
        const node = {
          type: "code",
          lang: directive[1],
          value,
          position: {
            start: { line: start + 1, column: 1, offset: 0 },
            end: { line: cursor + 1, column: 1, offset: 0 },
          },
        } as Code;
        const result = fenceAnchors(node, docPath, heading, pythonHints, goHints);
        anchors.push(...result.anchors);
      }
      index = cursor;
      continue;
    }
    index += 1;
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (blockLines.has(lineIndex)) continue;
    const line = lines[lineIndex] as string;
    if (line.trim().length > 0 && /^[=\-~^"'`#*+]{3,}\s*$/u.test(lines[lineIndex + 1] ?? "")) {
      heading = line.trim();
      continue;
    }
    const addInline = (token: string, column: number, surface: DocAnchor["surface"]): void => {
      const target = token.trim().replace(/^~/u, "");
      if (target.length === 0) return;
      anchors.push({
        docPath,
        line: lineIndex + 1,
        column,
        length: target.length,
        token: target,
        occurrence: 0,
        surface,
        contextFp: contextFingerprint([heading, line], target),
        importTable: {},
        localDecls: [],
        fragment: false,
      });
    };
    for (const match of line.matchAll(RST_LITERAL_RE)) {
      /* v8 ignore next */
      if (match.index === undefined) continue;
      addInline(match[1] as string, match.index + 3, "inlineCode");
    }
    for (const match of line.matchAll(RST_ROLE_RE)) {
      /* v8 ignore next */
      if (match.index === undefined) continue;
      addInline(match[1] as string, match.index + 1, "explicitRef");
    }
  }

  const kept = anchors.filter((anchor) => {
    const window = lines.slice(Math.max(0, anchor.line - 4), anchor.line + 3).join(" ");
    return !hasNegativeCue(window);
  });
  return { anchors: assignOccurrences(kept), parseFailures: 0 };
}

const ADOC_SOURCE_RE = /^\[source(?:,\s*([A-Za-z0-9_+#-]+))?\]\s*$/u;
const ADOC_TOKEN_RE = /^[A-Za-z_$][\w$]*(?:(?:\.|::|#)[A-Za-z_$][\w$]*)*(?:\(\))?$/u;

function parseAdocDoc(
  docPath: string,
  text: string,
  pythonHints?: PythonTypeHints,
  goHints?: GoTypeHints,
): DocParseResult {
  const lines = text.split(/\r?\n/u);
  const anchors: DocAnchor[] = [];
  const blockLines = new Set<number>();
  let heading = "";
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] as string;
    const headingMatch = /^=+\s+(.+)$/u.exec(line);
    if (headingMatch?.[1]) {
      heading = headingMatch[1].trim();
      index += 1;
      continue;
    }
    const source = ADOC_SOURCE_RE.exec(line);
    if (!source) {
      index += 1;
      continue;
    }
    let cursor = index + 1;
    while (cursor < lines.length && (lines[cursor] as string).trim().length === 0) cursor += 1;
    const delimiter = (lines[cursor] as string | undefined)?.trim();
    if (delimiter !== "----" && delimiter !== "....") {
      index += 1;
      continue;
    }
    let end = cursor + 1;
    while (end < lines.length && (lines[end] as string).trim() !== delimiter) end += 1;
    for (let lineIndex = index; lineIndex <= Math.min(end, lines.length - 1); lineIndex += 1) {
      blockLines.add(lineIndex);
    }
    const value = lines.slice(cursor + 1, end).join("\n");
    const lang = source[1] ?? "";
    if (isSupportedFence(lang) && value.trim().length > 0) {
      const node = {
        type: "code",
        lang,
        value,
        position: {
          start: { line: cursor + 2, column: 1, offset: 0 },
          end: { line: end + 1, column: 1, offset: 0 },
        },
      } as Code;
      anchors.push(...fenceAnchors(node, docPath, heading, pythonHints, goHints).anchors);
    }
    index = end < lines.length ? end + 1 : end;
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (blockLines.has(lineIndex)) continue;
    const line = lines[lineIndex] as string;
    const inlineHeading = /^=+\s+(.+)$/u.exec(line);
    if (inlineHeading?.[1]) {
      heading = inlineHeading[1].trim();
      continue;
    }
    const addInline = (token: string, column: number): void => {
      const target = token.trim();
      /* v8 ignore next */
      if (target.length === 0) return;
      anchors.push({
        docPath,
        line: lineIndex + 1,
        column,
        length: target.length,
        token: target,
        occurrence: 0,
        surface: "inlineCode",
        contextFp: contextFingerprint([heading, line], target),
        importTable: {},
        localDecls: [],
        fragment: false,
      });
    };
    for (const match of line.matchAll(SINGLE_LITERAL_RE)) {
      addInline(match[1] as string, (match.index as number) + 2);
    }
    for (const match of line.matchAll(/\+([^+\n]+)\+/gu)) {
      const token = (match[1] as string).trim();
      if (!ADOC_TOKEN_RE.test(token)) continue;
      addInline(token, (match.index as number) + 2);
    }
  }

  const kept = anchors.filter((anchor) => {
    const window = lines.slice(Math.max(0, anchor.line - 4), anchor.line + 3).join(" ");
    return !hasNegativeCue(window);
  });
  return { anchors: assignOccurrences(kept), parseFailures: 0 };
}

const JAVADOC_LINK_RE = /\{@(?:link|linkplain)\s+([^}]+)\}/gu;

function javadocTarget(source: string): string {
  const text = source.trim();
  const open = text.indexOf("(");
  if (open >= 0) return text.slice(0, open).trim();
  const space = text.search(/\s/u);
  return (space < 0 ? text : text.slice(0, space)).trim();
}
const JAVADOC_CODE_RE = /\{@code\s+([^}]+)\}/gu;

export function parseJavadoc(
  docPath: string,
  text: string,
  startLine: number,
  owner?: string,
): DocParseResult {
  const lines = text.split(/\r?\n/u);
  const heading = lines.find((line) => line.trim().length > 0)?.trim() ?? "";
  const anchors: DocAnchor[] = [];
  const add = (token: string, lineIndex: number, column: number, surface: DocAnchor["surface"]): void => {
    const target = token.trim().replace(/^#/u, "");
    /* v8 ignore next */
    if (target.length === 0) return;
    anchors.push({
      docPath,
      line: startLine + lineIndex,
      column,
      length: target.length,
      token: target,
      occurrence: 0,
      surface,
      contextFp: contextFingerprint([heading, lines[lineIndex] as string], target),
      importTable: {},
      localDecls: [],
      fragment: false,
    });
  };
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] as string;
    const used: Array<[number, number]> = [];
    for (const match of line.matchAll(JAVADOC_LINK_RE)) {
      const index = match.index as number;
      used.push([index, index + match[0].length]);
      const link = javadocTarget(match[1] as string);
      add(owner && link.startsWith("#") ? `${owner}${link}` : link, lineIndex, index + 1, "explicitRef");
    }
    for (const match of line.matchAll(JAVADOC_CODE_RE)) {
      const index = match.index as number;
      used.push([index, index + match[0].length]);
      add(match[1] as string, lineIndex, index + 1, "inlineCode");
    }
    for (const match of line.matchAll(SINGLE_LITERAL_RE)) {
      const index = match.index as number;
      if (used.some(([from, to]) => index >= from && index < to)) continue;
      add(match[1] as string, lineIndex, index + 2, "inlineCode");
    }
  }
  const kept = anchors.filter((anchor) => {
    const window = lines.slice(Math.max(0, anchor.line - startLine - 4), anchor.line - startLine + 3).join(" ");
    return !hasNegativeCue(window);
  });
  return { anchors: assignOccurrences(kept), parseFailures: 0 };
}

const SINGLE_LITERAL_RE = /(?<!`)`(?!`)([^`\n]+)`(?!`)/gu;

export function parseDocstring(
  docPath: string,
  text: string,
  startLine: number,
  _pythonHints?: PythonTypeHints,
  _goHints?: GoTypeHints,
): DocParseResult {
  const lines = text.split(/\r?\n/u);
  const heading = lines.find((line) => line.trim().length > 0)?.trim() ?? "";
  const anchors: DocAnchor[] = [];
  const add = (token: string, lineIndex: number, column: number, surface: DocAnchor["surface"]): void => {
    const target = token.trim().replace(/^~/u, "");
    /* v8 ignore next */
    if (target.length === 0) return;
    anchors.push({
      docPath,
      line: startLine + lineIndex,
      column,
      length: target.length,
      token: target,
      occurrence: 0,
      surface,
      contextFp: contextFingerprint([heading, lines[lineIndex] as string], target),
      importTable: {},
      localDecls: [],
      fragment: false,
    });
  };
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] as string;
    const used: Array<[number, number]> = [];
    for (const match of line.matchAll(RST_ROLE_RE)) {
      const index = match.index as number;
      used.push([index, index + match[0].length]);
      add(match[1] as string, lineIndex, index + 1, "explicitRef");
    }
    for (const match of line.matchAll(RST_LITERAL_RE)) {
      const index = match.index as number;
      used.push([index, index + match[0].length]);
      add(match[1] as string, lineIndex, index + 3, "inlineCode");
    }
    for (const match of line.matchAll(SINGLE_LITERAL_RE)) {
      const index = match.index as number;
      if (used.some(([from, to]) => index >= from && index < to)) continue;
      add(match[1] as string, lineIndex, index + 2, "inlineCode");
    }
  }
  const kept = anchors.filter((anchor) => {
    const window = lines.slice(Math.max(0, anchor.line - startLine - 4), anchor.line - startLine + 3).join(" ");
    return !hasNegativeCue(window);
  });
  return { anchors: assignOccurrences(kept), parseFailures: 0 };
}

export function parseDoc(
  docPath: string,
  text: string,
  pythonHints?: PythonTypeHints,
  goHints?: GoTypeHints,
  asciidoc = false,
): DocParseResult {
  const lower = docPath.toLowerCase();
  if (lower.endsWith(".rst")) {
    return parseRstDoc(docPath, text, pythonHints, goHints);
  }
  if (lower.endsWith(".adoc") || lower.endsWith(".asciidoc")) {
    return asciidoc ? parseAdocDoc(docPath, text, pythonHints, goHints) : { anchors: [], parseFailures: 0 };
  }
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
    ...(goHints ? { goHints } : {}),
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
  goHints?: GoTypeHints,
  asciidoc = false,
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
    const result = parseDoc(doc, text, pythonHints, goHints, asciidoc);
    anchors.push(...result.anchors);
    parseFailures += result.parseFailures;
  }
  return { anchors, parseFailures, docsScanned };
}

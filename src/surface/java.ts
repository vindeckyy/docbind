import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findPackageRoot, modulePathFor } from "../discover.js";
import {
  bodyHash,
  canonicalShape,
  paramNamesHash,
  shapeHash,
} from "../shape/canonical.js";
import { findMatching } from "./syntax.js";
import { lex, type LexResult, type Token } from "./lex.js";
import type { DocstringEntry, ExtractResult } from "./protocol.js";
import type { ParamShape, Shape, Symbol } from "../types.js";

interface JavaDraft {
  name: string;
  kind: "class" | "interface" | "method" | "property";
  shape: Shape;
  start: number;
  body: string;
  parentName?: string;
}

interface JavaContext {
  source: string;
  lexed: LexResult;
  filePath: string;
  packageName: string;
  packageRoot: string;
  modulePath: string;
  packageClause: string;
  drafts: JavaDraft[];
  failures: number;
}

const MODIFIERS = new Set([
  "public", "protected", "private", "static", "final", "abstract", "native",
  "synchronized", "transient", "volatile", "strictfp", "default", "sealed",
  "non-sealed",
]);

function lineOf(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

function tokensText(source: string, tokens: Token[], start: number, end: number): string {
  /* v8 ignore next */
  if (end <= start) return "";
  const first = tokens[start] as Token;
  const last = tokens[end - 1] as Token;
  return source.slice(first.start, last.end);
}

function javaParams(tokens: Token[], start: number, end: number): ParamShape[] {
  const parts: Array<[number, number]> = [];
  let depth = 0;
  let segment = start;
  for (let index = start; index < end; index += 1) {
    const value = (tokens[index] as Token).value;
    if (["<", "(", "[", "{"].includes(value)) depth += 1;
    else if ([">", ")", "]", "}"].includes(value)) depth = Math.max(0, depth - 1);
    else if (value === "," && depth === 0) {
      /* v8 ignore next */
      if (index > segment) parts.push([segment, index]);
      segment = index + 1;
    }
  }
  if (end > segment) parts.push([segment, end]);
  return parts.map(([from, to]) => {
    let cursor = from;
    while (cursor < to && ["@", "final"].includes((tokens[cursor] as Token).value)) {
      cursor += 1;
      while (cursor < to && (tokens[cursor] as Token).value !== " " && (tokens[cursor] as Token).value !== ",") {
        /* v8 ignore next */
        if (/^[A-Za-z_]/u.test((tokens[cursor] as Token).value) && (tokens[cursor + 1] as Token | undefined)?.value === "(") {
          const close = findMatching(tokens, cursor + 1, "(", ")");
          /* v8 ignore next */
          cursor = close < 0 ? to : close + 1;
        } else {
          cursor += 1;
        }
      }
    }
    let nameIndex = to - 1;
    while (nameIndex >= cursor && !/^[A-Za-z_]/u.test((tokens[nameIndex] as Token).value)) nameIndex -= 1;
    const name = ((tokens[nameIndex] as Token | undefined)?.value ?? "") as string;
    const type = tokens
      .slice(cursor, Math.max(cursor, nameIndex))
      .map((token) => token.value)
      .join(" ")
      .replace(/\[\s*\]/gu, "[]")
      .replace(/\s*<\s*/gu, "<")
      .replace(/\s*>\s*/gu, ">")
      .trim();
    return {
      name,
      kind: "positional",
      type,
      optional: false,
      rest: tokens.slice(cursor, to).some((token) => token.value === "..."),
      hasDefault: false,
    };
  });
}

class JavaParser {
  constructor(private readonly context: JavaContext) {}

  parse(): void {
    const tokens = this.context.lexed.tokens;
    let index = 0;
    while (index < tokens.length) {
      const token = tokens[index] as Token;
      if (token.value === "package") {
        let cursor = index + 1;
        const parts: string[] = [];
        while (cursor < tokens.length && (tokens[cursor] as Token).value !== ";") {
          parts.push((tokens[cursor] as Token).value);
          cursor += 1;
        }
        this.context.packageClause = parts.join("");
        index = cursor + 1;
        continue;
      }
      if (token.value === "class" || token.value === "interface" || token.value === "enum" || token.value === "record") {
        const end = this.parseType(index);
        index = Math.max(end, index + 1);
        continue;
      }
      index += 1;
    }
  }

  private publicBefore(index: number): boolean {
    const tokens = this.context.lexed.tokens;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const value = (tokens[cursor] as Token).value;
      if (value === "public") return true;
      /* v8 ignore next */
      if ([";", "}", "{"].includes(value)) return false;
    }
    return false;
  }

  private parseType(index: number): number {
    const tokens = this.context.lexed.tokens;
    const keyword = (tokens[index] as Token).value;
    const nameToken = tokens[index + 1] as Token | undefined;
    if (!nameToken || !/^[A-Za-z_]/u.test(nameToken.value)) return index + 1;
    if (!this.publicBefore(index)) return index + 1;
    let cursor = index + 2;
    let brace = -1;
    while (cursor < tokens.length) {
      const value = (tokens[cursor] as Token).value;
      if (value === "{") {
        brace = cursor;
        break;
      }
      /* v8 ignore next */
      if (value === ";") return cursor + 1;
      cursor += 1;
    }
    if (brace < 0) return index + 1;
    const close = findMatching(tokens, brace, "{", "}");
    /* v8 ignore next */
    if (close < 0) {
      this.context.failures += 1;
      return tokens.length;
    }
    const kind = keyword === "interface" ? "interface" : "class";
    this.context.drafts.push({
      name: nameToken.value,
      kind,
      shape: {
        kind,
        extends: [],
        members: [],
        flags: [],
        visibility: "public",
      },
      start: nameToken.start,
      body: tokensText(this.context.source, tokens, brace, close + 1),
    });
    this.parseMembers(nameToken.value, brace + 1, close, kind === "interface");
    return close + 1;
  }

  private parseMembers(typeName: string, start: number, end: number, isInterface: boolean): void {
    const tokens = this.context.lexed.tokens;
    let index = start;
    while (index < end) {
      const token = tokens[index] as Token;
      /* v8 ignore next */
      if (token.value === ";" || token.value === "}") {
        index += 1;
        continue;
      }
      if (token.value === "@") {
        index += 1;
        /* v8 ignore next */
        if (tokens[index] && /^[A-Za-z_]/u.test((tokens[index] as Token).value)) index += 1;
        while (index < end && (tokens[index] as Token).value === ".") index += 2;
        /* v8 ignore next */
        if (index < end && (tokens[index] as Token).value === "(") {
          const close = findMatching(tokens, index, "(", ")");
          /* v8 ignore next */
          index = close < 0 ? end : close + 1;
        }
        continue;
      }
      if (token.value === "class" || token.value === "interface" || token.value === "enum" || token.value === "record") {
        const close = findMatching(tokens, index, "{", "}");
        /* v8 ignore next */
        index = close < 0 ? end : close + 1;
        continue;
      }
      let cursor = index;
      let isPublic = isInterface;
      while (cursor < end && MODIFIERS.has((tokens[cursor] as Token).value)) {
        if ((tokens[cursor] as Token).value === "public") isPublic = true;
        cursor += 1;
      }
      let scan = cursor;
      let depth = 0;
      let boundary = -1;
      let paren = -1;
      while (scan < end) {
        const value = (tokens[scan] as Token).value;
        if (["<", "[", "{"].includes(value)) depth += 1;
        else if ([">", "]"].includes(value)) depth = Math.max(0, depth - 1);
        /* v8 ignore next */
        else if (value === "}" && depth === 0) {
          boundary = scan;
          break;
        } else if (value === ";" && depth === 0) {
          boundary = scan;
          break;
        } else if (value === "(" && depth === 0) {
          paren = scan;
          break;
        }
        scan += 1;
      }
      if (paren >= 0 && (boundary < 0 || paren < boundary)) {
        index = this.parseMethod(typeName, index, cursor, paren, end, isPublic);
        continue;
      }
      /* v8 ignore next */
      if (boundary < 0) break;
      /* v8 ignore next */
      if ((tokens[boundary] as Token).value === ";") {
        this.parseField(typeName, cursor, boundary, isPublic);
        index = boundary + 1;
        continue;
      }
      index = boundary + 1;
    }
  }

  private parseMethod(
    typeName: string,
    start: number,
    bodyStart: number,
    paren: number,
    end: number,
    isPublic: boolean,
  ): number {
    const tokens = this.context.lexed.tokens;
    const close = findMatching(tokens, paren, "(", ")");
    /* v8 ignore next */
    if (close < 0) {
      this.context.failures += 1;
      return end;
    }
    let nameIndex = paren - 1;
    while (nameIndex >= bodyStart && !/^[A-Za-z_]/u.test((tokens[nameIndex] as Token).value)) nameIndex -= 1;
    const name = ((tokens[nameIndex] as Token | undefined)?.value ?? "") as string;
    /* v8 ignore next */
    if (!name) return close + 1;
    const constructor = name === typeName;
    const returnTokens = tokens.slice(bodyStart, Math.max(bodyStart, nameIndex));
    const returnType = constructor
      ? typeName
      : returnTokens.map((token) => token.value).join(" ").replace(/\s*<\s*/gu, "<").replace(/\s*>\s*/gu, ">").trim();
    let cursor = close + 1;
    if ((tokens[cursor] as Token | undefined)?.value === "throws") {
      while (cursor < end && !["{", ";"].includes((tokens[cursor] as Token).value)) cursor += 1;
    }
    let body = "";
    if ((tokens[cursor] as Token | undefined)?.value === "{") {
      const bodyClose = findMatching(tokens, cursor, "{", "}");
      /* v8 ignore next */
      body = tokensText(this.context.source, tokens, cursor, bodyClose < 0 ? end : bodyClose + 1);
      /* v8 ignore next */
      cursor = bodyClose < 0 ? end : bodyClose + 1;
    /* v8 ignore next */
    } else if ((tokens[cursor] as Token | undefined)?.value === ";") {
      cursor += 1;
    }
    if (isPublic) {
      this.context.drafts.push({
        name,
        kind: "method",
        parentName: typeName,
        start: (tokens[nameIndex] as Token).start,
        body,
        shape: {
          kind: "method",
          async: false,
          generator: false,
          params: javaParams(tokens, paren + 1, close),
          returnType,
          visibility: "public",
          flags: [],
        },
      });
    }
    return Math.max(cursor, start + 1);
  }

  private parseField(typeName: string, start: number, semicolon: number, isPublic: boolean): void {
    if (!isPublic) return;
    const tokens = this.context.lexed.tokens;
    let nameIndex = semicolon - 1;
    while (nameIndex >= start && !/^[A-Za-z_]/u.test((tokens[nameIndex] as Token).value)) nameIndex -= 1;
    const name = ((tokens[nameIndex] as Token | undefined)?.value ?? "") as string;
    /* v8 ignore next */
    if (!name) return;
    const type = tokens
      .slice(start, Math.max(start, nameIndex))
      .map((token) => token.value)
      .join(" ")
      .replace(/\[\s*\]/gu, "[]")
      .replace(/\s*<\s*/gu, "<")
      .replace(/\s*>\s*/gu, ">")
      .trim();
    this.context.drafts.push({
      name,
      kind: "property",
      parentName: typeName,
      start: (tokens[nameIndex] as Token).start,
      body: "",
      shape: { kind: "property", typeShape: type, visibility: "public", flags: [] },
    });
  }
}

function collectJavadocs(source: string): DocstringEntry[] {
  const entries: DocstringEntry[] = [];
  for (const match of source.matchAll(/\/\*\*([\s\S]*?)\*\//gu)) {
    const text = match[1] as string;
    entries.push({
      filePath: "",
      line: lineOf(source, match.index as number),
      text: text
        .split(/\r?\n/u)
        .map((line) => line.replace(/^\s*\*\s?/u, ""))
        .join("\n"),
    });
  }
  return entries;
}

export function extractJava(root: string, files: string[]): ExtractResult {
  const symbols: Symbol[] = [];
  const javadocs: DocstringEntry[] = [];
  let parseFailures = 0;
  let filesScanned = 0;
  for (const rel of files) {
    let source: string;
    try {
      source = readFileSync(join(root, rel), "utf8");
    } catch {
      parseFailures += 1;
      continue;
    }
    filesScanned += 1;
    const lexed = lex(source, "java");
    if (lexed.error) parseFailures += 1;
    const packageInfo = findPackageRoot(root, rel);
    const context: JavaContext = {
      source,
      lexed,
      filePath: rel.replace(/\\/gu, "/"),
      packageName: packageInfo.name,
      packageRoot: packageInfo.root,
      modulePath: modulePathFor(packageInfo.root, join(root, rel)),
      packageClause: "",
      drafts: [],
      failures: 0,
    };
    new JavaParser(context).parse();
    parseFailures += context.failures;
    for (const draft of context.drafts) {
      const shapeText = canonicalShape(draft.shape);
      const parent = draft.parentName
        ? context.drafts.find((candidate) => candidate.name === draft.parentName && candidate.kind !== "method")
        : undefined;
      /* v8 ignore next */
      if (draft.parentName && !parent) continue;
      const qualified = parent
        ? `${context.packageName}.${context.modulePath.replace(/\//gu, ".")}.${parent.name}.${draft.name}`
        : `${context.packageName}.${context.modulePath.replace(/\//gu, ".")}.${draft.name}`;
      const aliases = new Set<string>([draft.name]);
      if (context.packageClause) {
        aliases.add(parent ? `${context.packageClause}.${parent.name}.${draft.name}` : `${context.packageClause}.${draft.name}`);
        aliases.add(parent ? `${parent.name}.${draft.name}` : `${context.packageClause}.${draft.name}`);
      }
      if (parent) {
        aliases.add(`${parent.name}.${draft.name}`);
        aliases.add(`${parent.name}#${draft.name}`);
        if (context.packageClause) {
          aliases.add(`${context.packageClause}.${parent.name}#${draft.name}`);
        }
      }
      aliases.add(`${context.modulePath.replace(/\//gu, ".")}.${draft.name}`);
      symbols.push({
        id: parent
          ? `${context.packageName}|${context.modulePath}|${draft.kind}|${parent.name}.${draft.name}|0`
          : `${context.packageName}|${context.modulePath}|${draft.kind}|${draft.name}|0`,
        name: draft.name,
        kind: draft.kind,
        modulePath: context.modulePath,
        packageName: context.packageName,
        packageRoot: context.packageRoot,
        qualifiedName: qualified,
        aliases: [...aliases].sort(),
        shape: draft.shape,
        shapeText,
        shapeHash: shapeHash(draft.shape),
        paramNamesHash: paramNamesHash(draft.shape.params),
        bodyHash: bodyHash(draft.body),
        contractFlags: [],
        ...(parent ? { parentId: `${context.packageName}|${context.modulePath}|${parent.kind}|${parent.name}|0` } : {}),
        line: lineOf(source, draft.start),
        filePath: context.filePath,
      });
    }
    for (const entry of collectJavadocs(source)) {
      javadocs.push({ ...entry, filePath: context.filePath });
    }
  }
  return { symbols, javadocs, parseFailures, filesScanned };
}

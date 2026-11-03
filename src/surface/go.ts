import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findPackageRoot, modulePathFor } from "../discover.js";
import {
  bodyHash,
  canonicalShape,
  paramNamesHash,
  shapeHash,
} from "../shape/canonical.js";
import { normalizeType } from "../hash.js";
import { lex, type LexResult, type Token } from "./lex.js";
import type { ExtractResult } from "./protocol.js";
import { findMatching, isExportedGo, lineOf, splitTopLevel, tokenText } from "./syntax.js";
import type {
  ContractFlag,
  MemberShape,
  ParamShape,
  Shape,
  Symbol,
  SymbolKind,
} from "../types.js";

interface GoDraft {
  name: string;
  kind: SymbolKind;
  shape: Shape;
  start: number;
  body: string;
  parentName?: string;
  enabled: boolean;
  exported: boolean;
}

interface GoContext {
  source: string;
  lexed: LexResult;
  filePath: string;
  packageName: string;
  packageRoot: string;
  modulePath: string;
  drafts: GoDraft[];
  failures: { count: number };
}

function goParams(tokens: Token[], start: number, end: number, masked: string): ParamShape[] {
  const parts = splitTopLevel(tokens, start, end, ",").map(([from, to]) => {
    const values = tokens.slice(from, to).map((token) => token.value);
    const first = values[0] ?? "";
    const second = values[1] ?? "";
    const unnamedPrefix = ["*", "[", "...", "chan", "map", "func", "<-"];
    if (values.length <= 1 || unnamedPrefix.includes(first) || second === ".") {
      return { type: tokenText(masked, tokens, from, to), optional: false, rest: first === "...", hasDefault: false };
    }
    const name = first;
    const type = tokenText(masked, tokens, from + 1, to);
    return {
      name,
      type,
      optional: false,
      rest: type.startsWith("...") || second === "...",
      hasDefault: false,
    };
  });
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (!parts[index].name && !parts[index].type.includes("*") && !parts[index].type.includes("[")) {
      const next = parts[index + 1];
      if (next.name && next.type) {
        parts[index] = {
          ...parts[index],
          name: parts[index].type,
          type: next.type,
        };
      }
    }
  }
  return parts;
}
function goTypeParams(tokens: Token[], index: number, masked: string): { text?: string; end: number } {
  if (tokens[index]?.value !== "[") return { end: index };
  const close = findMatching(tokens, index, "[", "]");
  if (close < 0) return { end: tokens.length };
  return { text: tokenText(masked, tokens, index + 1, close), end: close + 1 };
}

function goReturns(tokens: Token[], start: number, masked: string): { type?: string; end: number } {
  if (tokens[start]?.value === "(") {
    const close = findMatching(tokens, start, "(", ")");
    if (close < 0) return { end: tokens.length };
    const parts = splitTopLevel(tokens, start + 1, close, ",")
      .map(([from, to]) => tokenText(masked, tokens, from, to))
      .filter(Boolean);
    return { type: parts.join(",") || undefined, end: close + 1 };
  }
  let end = start;
  while (end < tokens.length && tokens[end].value !== "{" && tokens[end].value !== ";") end += 1;
  const type = tokenText(masked, tokens, start, end);
  return { type: type || undefined, end };
}

function goDeprecated(source: string, offset: number): boolean {
  const before = source.slice(Math.max(0, offset - 400), offset);
  return /\/\/\s*Deprecated:/u.test(before);
}

function endOfLine(tokens: Token[], start: number, source: string): number {
  const line = lineOf(source, tokens[start]?.start ?? 0);
  let index = start;
  while (index < tokens.length && lineOf(source, tokens[index].start) === line) index += 1;
  return index;
}

class GoParser {
  private readonly tokens: Token[];
  private readonly masked: string;

  constructor(private readonly context: GoContext) {
    this.tokens = context.lexed.tokens;
    this.masked = context.lexed.masked;
  }

  parseRange(start: number, end: number): void {
    let index = start;
    while (index < end) {
      const keyword = this.tokens[index]?.value;
      if (keyword === "func") {
        index = this.parseFunction(index, end);
      } else if (keyword === "type") {
        index = this.parseType(index, end);
      } else if (keyword === "const") {
        index = this.parseValues(index, end, "const");
      } else if (keyword === "var") {
        index = this.parseValues(index, end, "var");
      } else if (keyword === "import") {
        index = this.skipDeclaration(index);
      } else {
        index += 1;
      }
      if (index <= start) index = start + 1;
    }
  }

  private parseFunction(index: number, end: number): number {
    let cursor = index + 1;
    let receiver: string | undefined;
    if (this.tokens[cursor]?.value === "(") {
      const close = findMatching(this.tokens, cursor, "(", ")");
      if (close < 0) {
        this.context.failures.count += 1;
        return end;
      }
      const receiverText = tokenText(this.masked, this.tokens, cursor + 1, close);
      const match = /(?:^|[.\s*])([A-Za-z_]\w*)(?:\[[^\]]*\])?$/u.exec(receiverText);
      receiver = match?.[1];
      cursor = close + 1;
    }
    const nameToken = this.tokens[cursor];
    if (!nameToken || !/^[A-Za-z_]/u.test(nameToken.value)) return cursor + 1;
    cursor += 1;
    const typeParams = goTypeParams(this.tokens, cursor, this.masked);
    cursor = typeParams.end;
    if (this.tokens[cursor]?.value !== "(") return cursor + 1;
    const close = findMatching(this.tokens, cursor, "(", ")");
    if (close < 0) {
      this.context.failures.count += 1;
      return end;
    }
    const params = goParams(this.tokens, cursor + 1, close, this.masked);
    cursor = close + 1;
    const returns = goReturns(this.tokens, cursor, this.masked);
    cursor = returns.end;
    let body = "";
    if (this.tokens[cursor]?.value === "{") {
      const bodyClose = findMatching(this.tokens, cursor, "{", "}");
      if (bodyClose < 0) {
        this.context.failures.count += 1;
        return end;
      }
      body = this.context.source.slice(this.tokens[cursor].start, this.tokens[bodyClose].end);
      cursor = bodyClose + 1;
    }
    const exported = isExportedGo(nameToken.value);
    const flags: ContractFlag[] = goDeprecated(this.context.source, nameToken.start) ? ["deprecated"] : [];
    if (receiver) {
      params.unshift({
        name: "receiver",
        type: receiver,
        optional: false,
        rest: false,
        hasDefault: false,
        kind: "receiver",
      });
    }
    this.context.drafts.push({
      name: nameToken.value,
      kind: receiver ? "method" : "function",
      shape: {
        kind: receiver ? "method" : "function",
        async: false,
        generator: false,
        typeParams: typeParams.text,
        params,
        returnType: returns.type,
        visibility: "public",
        flags,
      },
      start: nameToken.start,
      body,
      parentName: receiver,
      enabled: exported,
      exported,
    });
    return cursor;
  }

  private parseType(index: number, end: number): number {
    if (this.tokens[index + 1]?.value === "(") {
      const close = findMatching(this.tokens, index + 1, "(", ")");
      if (close < 0) {
        this.context.failures.count += 1;
        return end;
      }
      const body = this.context.source.slice(this.tokens[index + 1].end, this.tokens[close].start);
      let offset = this.tokens[index + 1].end;
      for (const line of body.split(/\r?\n/u)) {
        this.parseTypeLine(line, offset);
        offset += line.length + 1;
      }
      return close + 1;
    }
    const nameToken = this.tokens[index + 1];
    if (!nameToken) return index + 1;
    let cursor = index + 2;
    const typeParams = goTypeParams(this.tokens, cursor, this.masked);
    cursor = typeParams.end;
    const exported = isExportedGo(nameToken.value) && !goDeprecated(this.context.source, nameToken.start);
    if (this.tokens[cursor]?.value === "struct" && this.tokens[cursor + 1]?.value === "{") {
      const close = findMatching(this.tokens, cursor + 1, "{", "}");
      if (close < 0) {
        this.context.failures.count += 1;
        return end;
      }
      const body = this.context.source.slice(this.tokens[cursor + 1].start, this.tokens[close].end);
      const members = this.structFields(body, nameToken.value, exported, this.tokens[cursor + 1].start);
      this.context.drafts.push({
        name: nameToken.value,
        kind: "class",
        shape: { kind: "class", typeParams: typeParams.text, members },
        start: nameToken.start,
        body,
        enabled: exported,
        exported,
      });
      return close + 1;
    }
    if (this.tokens[cursor]?.value === "interface" && this.tokens[cursor + 1]?.value === "{") {
      const close = findMatching(this.tokens, cursor + 1, "{", "}");
      if (close < 0) {
        this.context.failures.count += 1;
        return end;
      }
      const body = this.context.source.slice(this.tokens[cursor + 1].start, this.tokens[close].end);
      const members = this.interfaceMembers(body, nameToken.value, exported, this.tokens[cursor + 1].start);
      this.context.drafts.push({
        name: nameToken.value,
        kind: "interface",
        shape: { kind: "interface", typeParams: typeParams.text, members },
        start: nameToken.start,
        body,
        enabled: exported,
        exported,
      });
      return close + 1;
    }
    if (this.tokens[cursor]?.value === "=") cursor += 1;
    const lineEnd = endOfLine(this.tokens, Math.max(cursor, index + 2), this.context.source);
    const type = tokenText(this.masked, this.tokens, cursor, lineEnd);
    this.context.drafts.push({
      name: nameToken.value,
      kind: "type",
      shape: { kind: "type", typeParams: typeParams.text, typeShape: type },
      start: nameToken.start,
      body: type,
      enabled: exported,
      exported,
    });
    return Math.max(lineEnd, cursor + 1);
  }

  private parseTypeLine(line: string, offset: number): void {
    const clean = line.trim();
    if (!clean || clean.startsWith("//")) return;
    const tokens = lex(clean, "go").tokens;
    if (tokens.length < 2) return;
    const name = tokens[0].value;
    if (!isExportedGo(name)) return;
    const typeStart = tokens[1].value === "=" ? 2 : 1;
    const type = clean.slice(tokens[typeStart]?.start ?? 0).trim();
    this.context.drafts.push({
      name,
      kind: "type",
      shape: { kind: "type", typeShape: normalizeType(type) },
      start: offset + tokens[0].start,
      body: type,
      enabled: true,
      exported: true,
    });
  }

  private structFields(body: string, parentName: string, parentExported: boolean, bodyOffset: number): MemberShape[] {
    const members: MemberShape[] = [];
    const lines = body.split(/\r?\n/u);
    let offset = bodyOffset;
    for (const rawLine of lines) {
      const line = rawLine.replace(/`[^`]*`/gu, "").trim();
      if (line.length === 0 || line === "{" || line === "}") {
        offset += rawLine.length + 1;
        continue;
      }
      const lineTokens = lex(line, "go").tokens;
      const fields = this.parseField(lineTokens, line, parentName, parentExported, offset);
      members.push(...fields);
      offset += rawLine.length + 1;
    }
    return members;
  }

  private parseField(tokens: Token[], line: string, parentName: string, parentExported: boolean, offset: number): MemberShape[] {
    if (tokens.length === 0) return [];
    let names: string[] = [];
    let type = "";
    if (tokens[0]?.value === "*" || tokens[0]?.value === "[" || tokens[0]?.value === "(") {
      const name = [...tokens].reverse().find((token) => /^[A-Za-z_]/u.test(token.value))?.value;
      if (!name) return [];
      names = [name];
      type = line.trim();
    } else if (tokens[1]?.value === ",") {
      const parts = splitTopLevel(tokens, 0, tokens.length, ",");
      for (const [from] of parts.slice(0, -1)) names.push(tokens[from].value);
      const last = parts[parts.length - 1];
      if (last[1] - last[0] >= 2) {
        names.push(tokens[last[0]].value);
        type = line.slice(tokens[last[0] + 1].start, tokens[tokens.length - 1].end);
      } else {
        type = line.slice(tokens[last[0]].start, tokens[tokens.length - 1].end);
      }
    } else if (tokens.length === 1 || /^[.*[]/u.test(tokens[1].value)) {
      const name = tokens[0].value;
      names = [name];
      type = line.trim();
    } else {
      names = [tokens[0].value];
      type = line.slice(tokens[1].start, tokens[tokens.length - 1].end);
    }
    if (names.length === 0 || !type) return [];
    return names.map((name) => {
      const exported = isExportedGo(name);
      if (exported && parentExported) {
        this.context.drafts.push({
          name,
          kind: "property",
          shape: { kind: "property", typeShape: normalizeType(type), visibility: "public" },
          start: offset + (tokens[0]?.start ?? 0),
          body: "",
          parentName,
          enabled: true,
          exported: true,
        });
      }
      const member: MemberShape = {
        name,
        kind: "property",
        optional: false,
        shape: { kind: "property", typeShape: normalizeType(type), visibility: exported ? "public" : "private" },
      };
      return member;
    });
  }

  private interfaceMembers(body: string, parentName: string, parentExported: boolean, bodyOffset: number): MemberShape[] {
    const members: MemberShape[] = [];
    let offset = bodyOffset;
    for (const rawLine of body.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (line.length === 0 || line === "{" || line === "}") {
        offset += rawLine.length + 1;
        continue;
      }
      const lineTokens = lex(line, "go").tokens;
      const nameToken = lineTokens[0];
      if (nameToken && lineTokens[1]?.value === "(") {
        const close = findMatching(lineTokens, 1, "(", ")");
        const returnType = close >= 0
          ? tokenText(line, lineTokens, close + 1, lineTokens.length) || undefined
          : undefined;
        const params = close >= 0 ? goParams(lineTokens, 2, close, line) : [];
        if (isExportedGo(nameToken.value) && parentExported) {
          this.context.drafts.push({
            name: nameToken.value,
            kind: "method",
            shape: {
              kind: "method",
              params,
              returnType,
              visibility: "public",
              flags: [],
            },
            start: offset + nameToken.start,
            body: "",
            parentName,
            enabled: true,
            exported: true,
          });
        }
        members.push({
          name: nameToken.value,
          kind: "method",
          optional: false,
          shape: { kind: "method", params, returnType, visibility: "public" },
        });
      }
      offset += rawLine.length + 1;
    }
    return members;
  }

  private parseValues(index: number, end: number, kind: "const" | "var"): number {
    let cursor = index + 1;
    if (this.tokens[cursor]?.value === "(") {
      const close = findMatching(this.tokens, cursor, "(", ")");
      if (close < 0) {
        this.context.failures.count += 1;
        return end;
      }
      const start = this.tokens[cursor].end;
      const body = this.context.source.slice(start, this.tokens[close].start);
      let offset = start;
      for (const line of body.split(/\r?\n/u)) {
        this.parseValueLine(line, kind, offset);
        offset += line.length + 1;
      }
      return close + 1;
    }
    const lineEnd = endOfLine(this.tokens, cursor, this.context.source);
    const line = this.context.source.slice(this.tokens[cursor].start, this.tokens[lineEnd - 1]?.end ?? this.tokens[cursor].end);
    this.parseValueLine(line, kind, this.tokens[cursor].start);
    return Math.max(lineEnd, cursor + 1);
  }

  private parseValueLine(line: string, kind: "const" | "var", offset: number): void {
    const clean = line.replace(/`[^`]*`/gu, "").trim();
    if (clean.length === 0 || clean.startsWith("//")) return;
    const tokens = lex(clean, "go").tokens;
    if (tokens.length === 0) return;
    const equal = tokens.findIndex((token) => token.value === "=");
    const declaration = equal >= 0 ? clean.slice(0, tokens[equal].start) : clean;
    const value = equal >= 0 ? clean.slice(tokens[equal].start + 1).trim() : "";
    const declarationTokens = lex(declaration, "go").tokens;
    if (declarationTokens.length === 0) return;
    const names: string[] = [];
    let type = "";
    if (declarationTokens.length === 1) {
      names.push(declarationTokens[0].value);
    } else if (declarationTokens[0].value === "(") {
      return;
    } else {
      names.push(declarationTokens[0].value);
      type = declaration.slice(declarationTokens[1].start).trim();
      if (declarationTokens[1]?.value === ",") {
        const parts = splitTopLevel(declarationTokens, 0, declarationTokens.length, ",");
        names.length = 0;
        for (const [from] of parts.slice(0, -1)) names.push(declarationTokens[from].value);
        const last = parts[parts.length - 1];
        if (last[1] - last[0] === 1) {
          names.push(declarationTokens[last[0]].value);
          type = "";
        } else {
          names.push(declarationTokens[last[0]].value);
          type = declaration.slice(declarationTokens[last[0] + 1].start).trim();
        }
      }
    }
    const literal = value.startsWith("\"") || value.startsWith("`") ? "string"
      : /^-?\d/u.test(value) ? "number"
      : value === "true" || value === "false" ? "boolean"
      : "expression";
    for (const name of names) {
      if (!isExportedGo(name)) continue;
      this.context.drafts.push({
        name,
        kind: "const",
        shape: { kind: "const", typeShape: type || literal, literalKind: literal },
        start: offset + clean.indexOf(name),
        body: value,
        enabled: true,
        exported: true,
      });
    }
  }

  private skipDeclaration(index: number): number {
    if (this.tokens[index + 1]?.value === "(") {
      const close = findMatching(this.tokens, index + 1, "(", ")");
      return close < 0 ? this.tokens.length : close + 1;
    }
    return Math.max(endOfLine(this.tokens, index, this.context.source), index + 1);
  }
}

function buildGoSymbols(context: GoContext): Symbol[] {
  const top = context.drafts.filter((draft) => draft.enabled && draft.exported && !draft.parentName);
  const result: Symbol[] = [];
  const byName = new Map<string, Symbol>();
  const childCounts = new Map<string, number>();
  for (const draft of top) {
    const shapeText = canonicalShape(draft.shape);
    const symbol: Symbol = {
      id: `${context.packageName}|${context.modulePath}|${draft.kind}|${draft.name}|0`,
      name: draft.name,
      kind: draft.kind,
      modulePath: context.modulePath,
      packageName: context.packageName,
      packageRoot: context.packageRoot,
      qualifiedName: `${context.packageName}.${context.modulePath.replace(/\//gu, ".")}.${draft.name}`,
      aliases: [`${context.modulePath.replace(/\//gu, ".")}.${draft.name}`],
      shape: draft.shape,
      shapeText,
      shapeHash: shapeHash(draft.shape),
      paramNamesHash: paramNamesHash(draft.shape.params),
      bodyHash: bodyHash(draft.body),
      contractFlags: draft.shape.flags ?? [],
      line: lineOf(context.source, draft.start),
      filePath: context.filePath,
    };
    result.push(symbol);
    byName.set(draft.name, symbol);
  }
  for (const draft of context.drafts) {
    if (!draft.enabled || !draft.exported || !draft.parentName) continue;
    const parent = byName.get(draft.parentName);
    if (!parent) continue;
    const key = `${draft.parentName}.${draft.name}`;
    const index = childCounts.get(key) ?? 0;
    childCounts.set(key, index + 1);
    const shapeText = canonicalShape(draft.shape);
    result.push({
      id: `${context.packageName}|${context.modulePath}|${draft.kind}|${key}|${index}`,
      name: draft.name,
      kind: draft.kind,
      modulePath: context.modulePath,
      packageName: context.packageName,
      packageRoot: context.packageRoot,
      qualifiedName: `${parent.qualifiedName}.${draft.name}`,
      aliases: [key],
      shape: draft.shape,
      shapeText,
      shapeHash: shapeHash(draft.shape),
      paramNamesHash: paramNamesHash(draft.shape.params),
      bodyHash: bodyHash(draft.body),
      contractFlags: draft.shape.flags ?? [],
      parentId: parent.id,
      line: lineOf(context.source, draft.start),
      filePath: context.filePath,
    });
  }
  return result;
}

export function extractGo(root: string, files: string[]): ExtractResult {
  const symbols: Symbol[] = [];
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
    const packageInfo = findPackageRoot(root, rel);
    const lexed = lex(source, "go");
    if (lexed.error) parseFailures += 1;
    const context: GoContext = {
      source,
      lexed,
      filePath: rel.replace(/\\/gu, "/"),
      packageName: packageInfo.name,
      packageRoot: packageInfo.root,
      modulePath: modulePathFor(packageInfo.root, join(root, rel)),
      drafts: [],
      failures: { count: 0 },
    };
    new GoParser(context).parseRange(0, lexed.tokens.length);
    parseFailures += context.failures.count;
    symbols.push(...buildGoSymbols(context));
    filesScanned += 1;
  }
  return { symbols, parseFailures, filesScanned };
}

export interface GoSignatureSnippet {
  name: string;
  kind: SymbolKind;
  shape: Shape;
}

export function snippetSignatureGo(code: string): GoSignatureSnippet | undefined {
  const lexed = lex(code, "go");
  const context: GoContext = {
    source: code,
    lexed,
    filePath: "snippet.go",
    packageName: "snippet",
    packageRoot: "",
    modulePath: "snippet",
    drafts: [],
    failures: { count: 0 },
  };
  new GoParser(context).parseRange(0, lexed.tokens.length);
  const draft = context.drafts.find((candidate) =>
    candidate.body.length === 0 &&
    candidate.kind !== "const" &&
    candidate.kind !== "module"
  );
  return draft ? { name: draft.name, kind: draft.kind, shape: draft.shape } : undefined;
}

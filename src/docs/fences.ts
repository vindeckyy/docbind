import ts from "typescript";
import type { Code } from "mdast";
import { contextFingerprint, hasNegativeCue } from "./context.js";
import type { DocAnchor, ImportRef, Shape } from "../types.js";
import { snippetSignature } from "../surface/typescript.js";
import { snippetSignatureRust } from "../surface/rust.js";
import { snippetSignatureGo } from "../surface/go.js";
import { lex } from "../surface/lex.js";
import type { GoTypeHints, PythonTypeHints } from "./infer.js";

const TS_LANGS = new Set(["ts", "typescript", "tsx", "js", "javascript", "jsx", "mjs", "cjs"]);
const PY_LANGS = new Set(["py", "python", "pycon"]);
const RUST_LANGS = new Set(["rs", "rust"]);
const GO_LANGS = new Set(["go", "golang"]);
const PY_KEYWORDS = new Set([
  "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del",
  "elif", "else", "except", "False", "finally", "for", "from", "global", "if", "import",
  "in", "is", "lambda", "None", "nonlocal", "not", "or", "pass", "raise", "return",
  "True", "try", "while", "with", "yield", "self", "cls",
]);
const GO_KEYWORDS = new Set([
  "break", "case", "chan", "const", "continue", "default", "defer", "else",
  "fallthrough", "for", "func", "go", "goto", "if", "import", "interface",
  "map", "package", "range", "return", "select", "struct", "switch", "type",
  "var", "nil", "true", "false",
]);

const TS_KEYWORDS = new Set([
  "abstract", "any", "as", "async", "await", "boolean", "break", "case", "catch", "class",
  "const", "constructor", "continue", "debugger", "declare", "default", "delete", "do",
  "else", "enum", "export", "extends", "false", "finally", "for", "from", "function",
  "get", "if", "implements", "import", "in", "infer", "instanceof", "interface", "is",
  "keyof", "let", "module", "namespace", "never", "new", "null", "number", "object",
  "of", "package", "private", "protected", "public", "readonly", "require", "return",
  "set", "static", "string", "super", "switch", "symbol", "this", "throw", "true", "try",
  "type", "typeof", "undefined", "unknown", "var", "void", "while", "with", "yield",
]);

export interface FenceResult {
  anchors: DocAnchor[];
  imports: Record<string, ImportRef>;
}

function addNames(pattern: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(pattern)) {
    names.add(pattern.text);
    return;
  }
  for (const element of pattern.elements) {
    if (ts.isBindingElement(element)) addNames(element.name, names);
  }
}

function collectTsLocals(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) addNames(node.name, names);
    if (ts.isParameter(node)) addNames(node.name, names);
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isModuleDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

function collectTsImports(sourceFile: ts.SourceFile): Record<string, ImportRef> {
  const imports: Record<string, ImportRef> = {};
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const source = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) imports[clause.name.text] = { source, imported: "default" };
    const bindings = clause.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      imports[bindings.name.text] = { source, imported: "*" };
    } else {
      for (const element of bindings.elements) {
        imports[element.name.text] = {
          source,
          imported: element.propertyName?.text ?? element.name.text,
        };
      }
    }
  }
  return imports;
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isEnumDeclaration(parent) ||
      ts.isModuleDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isBindingElement(parent) ||
      ts.isTypeParameterDeclaration(parent) ||
      ts.isImportSpecifier(parent) ||
      ts.isImportClause(parent) ||
      ts.isNamespaceImport(parent) ||
      ts.isExportSpecifier(parent)) &&
    (parent as { name?: ts.Node }).name === node
  ) {
    return true;
  }
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
  if (ts.isQualifiedName(parent) && parent.right === node) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node && !ts.isIdentifier(parent.expression)) {
    return false;
  }
  return false;
}

function contextLine(value: string, lineIndex: number): string {
  return value.split("\n")[lineIndex] ?? "";
}

function makeAnchor(
  docPath: string,
  token: string,
  line: number,
  column: number,
  surface: DocAnchor["surface"],
  context: string[],
  imports: Record<string, ImportRef>,
  localDecls: string[],
  fragment: boolean,
  fenceLang: string | undefined,
  signatureShape?: Shape,
  hints?: string[],
): DocAnchor {
  return {
    docPath,
    line,
    column,
    length: token.length,
    token,
    occurrence: 0,
    surface,
    ...(fenceLang ? { fenceLang } : {}),
    contextFp: contextFingerprint(context, token),
    importTable: imports,
    localDecls,
    fragment,
    ...(signatureShape ? { signatureShape } : {}),
    ...(hints?.length ? { hints } : {}),
  };
}

function tsFenceAnchors(node: Code, docPath: string, heading: string): FenceResult {
  const lang = node.lang ?? "";
  const value = node.value;
  const sourceFile = ts.createSourceFile(`fence.${lang === "python" ? "py" : "ts"}`, value, ts.ScriptTarget.Latest, true);
  const imports = collectTsImports(sourceFile);
  const locals = collectTsLocals(sourceFile);
  const fragment = /\.\.\.|…/u.test(value) ||
    ((sourceFile as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics?.length ?? 0) > 0;
  const startLine = node.position?.start.line ?? 1;
  const signature = snippetSignature(value, `fence.${lang}`);
  if (signature) {
    let line = startLine + 1;
    let column = 1;
    const identifier = value.indexOf(signature.name);
    if (identifier >= 0) {
      const before = value.slice(0, identifier);
      const lines = before.split("\n");
      line = startLine + 1 + lines.length - 1;
      column = (lines[lines.length - 1]?.length ?? 0) + 1;
    }
    const context = [heading, value.split("\n")[0] ?? ""];
    return {
      anchors: [
        makeAnchor(
          docPath,
          signature.name,
          line,
          column,
          "signatureFence",
          context,
          imports,
          [...locals].filter((name) => name !== signature.name),
          false,
          lang,
          signature.shape,
        ),
      ],
      imports,
    };
  }

  const anchors: DocAnchor[] = [];
  const seen = new Set<string>();
  const visit = (current: ts.Node): void => {
    if (ts.isIdentifier(current) && !isDeclarationName(current)) {
      const token = current.text;
      if (
        token.length >= 2 &&
        !TS_KEYWORDS.has(token) &&
        !locals.has(token) &&
        !seen.has(`${token}:${current.getStart(sourceFile)}`)
      ) {
        seen.add(`${token}:${current.getStart(sourceFile)}`);
        const position = sourceFile.getLineAndCharacterOfPosition(current.getStart(sourceFile));
        anchors.push(
          makeAnchor(
            docPath,
            token,
            startLine + 1 + position.line,
            position.character + 1,
            "fenceToken",
            [heading, contextLine(value, position.line)],
            imports,
            [...locals],
            fragment,
            lang,
          ),
        );
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(sourceFile);
  return { anchors, imports };
}

function inferPythonTypes(lines: string[], hints?: PythonTypeHints): Map<string, string> {
  const types = new Map<string, string>();
  if (!hints) return types;
  const inferCall = (source: string): string | undefined => {
    const expr = source.replace(/^\s*await\s+/u, "").trim();
    const call = /^([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*)\s*\(/u.exec(expr);
    if (!call?.[1]) return undefined;
    const parts = call[1].replace(/\s*\.\s*/gu, ".").split(".");
    const tail = parts[parts.length - 1];
    if (tail && hints.classes.has(tail)) return tail;
    const method = parts.pop() as string;
    const receiver = parts.join(".");
    const receiverType = types.get(receiver);
    return hints.returns.get(`${receiverType ?? receiver}.${method}`) ??
      hints.returns.get(`${receiver}.${method}`);
  };
  for (const raw of lines) {
    const line = raw.replace(/^\s*(?:>>>|\.\.\.)\s?/u, "").trim();
    const withMatch = /^(?:async\s+)?with\s+(.+?)\s+as\s+([A-Za-z_]\w*)\s*:/u.exec(line);
    if (withMatch) {
      const type = inferCall(withMatch[1] as string);
      if (type) types.set(withMatch[2] as string, type);
      continue;
    }
    const annotated = /^([A-Za-z_]\w*)\s*:\s*([^=]+)=/u.exec(line);
    if (annotated) {
      const first = (annotated[2] as string).split("|")[0] as string;
      const names = first.match(/[A-Za-z_]\w*/gu) ?? [];
      const type = names[names.length - 1];
      if (type && hints.classes.has(type)) types.set(annotated[1] as string, type);
      continue;
    }
    const assignment = /^([A-Za-z_]\w*)\s*=\s*(.+)$/u.exec(line);
    if (assignment) {
      const type = inferCall(assignment[2] as string);
      if (type) types.set(assignment[1] as string, type);
    }
  }
  return types;
}

function pyFenceAnchors(
  node: Code,
  docPath: string,
  heading: string,
  hints?: PythonTypeHints,
): FenceResult {
  const lang = node.lang ?? "";
  const value = node.value;
  const imports: Record<string, ImportRef> = {};
  for (const line of value.split("\n")) {
    const from = /^\s*from\s+([.\w]+)\s+import\s+(.+)$/u.exec(line);
    if (from) {
      for (const part of (from[2] ?? "").split(",")) {
        const cleaned = part.trim().replace(/[()]/gu, "");
        if (!cleaned) continue;
        const [imported, alias] = cleaned.split(/\s+as\s+/u);
        if (!imported || imported === "*") continue;
        imports[alias ?? imported] = { source: from[1] ?? "", imported };
      }
    }
    const direct = /^\s*import\s+([.\w]+)(?:\s+as\s+(\w+))?/u.exec(line);
    if (direct?.[1]) {
      const local = direct[2] ?? direct[1].split(".")[0];
      if (local) imports[local] = { source: direct[1], imported: "*" };
    }
  }
  const locals = new Set<string>();
  for (const line of value.split("\n")) {
    const cleaned = line.replace(/^\s*(?:>>>|\.\.\.)\s?/u, "");
    const declaration = /^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/u.exec(cleaned);
    if (declaration?.[1]) locals.add(declaration[1]);
    const assignment = /^\s*([A-Za-z_]\w*)\s*=/u.exec(cleaned);
    if (assignment?.[1]) locals.add(assignment[1]);
  }
  const localTypes = inferPythonTypes(value.split("\n"), hints);
  const anchors: DocAnchor[] = [];
  const seen = new Set<string>();
  const startLine = node.position?.start.line ?? 1;
  const lines = value.split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] as string;
    for (const chainMatch of line.matchAll(/[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)+/gu)) {
      const chain = chainMatch[0].replace(/\s*\.\s*/gu, ".");
      const root = chain.split(".")[0] as string;
      const type = localTypes.get(root);
      if (!type) continue;
      const token = `${type}.${chain.split(".").slice(1).join(".")}`;
      const column = (chainMatch.index as number) + 1;
      anchors.push(
        makeAnchor(
          docPath,
          token,
          startLine + 1 + lineIndex,
          column,
          "fenceToken",
          [heading, line],
          imports,
          [...locals],
          /\.\.\.|…/u.test(value),
          lang,
        ),
      );
    }
  }
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] as string;
    for (const chainMatch of line.matchAll(/[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*/gu)) {
      const token = chainMatch[0].replace(/\s*\.\s*/gu, ".");
      const root = token.split(".")[0] as string;
      const column = (chainMatch.index as number) + 1;
      if (
        token.length < 2 ||
        PY_KEYWORDS.has(root) ||
        locals.has(root) ||
        seen.has(`${lineIndex}:${column}:${token}`)
      ) {
        continue;
      }
      seen.add(`${lineIndex}:${column}:${token}`);
      anchors.push(
        makeAnchor(
          docPath,
          token,
          startLine + 1 + lineIndex,
          column,
          "fenceToken",
          [heading, line],
          imports,
          [...locals],
          /\.\.\.|…/u.test(value),
          lang,
        ),
      );
    }
  }
  return { anchors, imports };
}

function inferGoExpression(
  expression: string,
  hints: GoTypeHints,
  localReturns?: Map<string, string>,
): string | undefined {
  const cleaned = expression.trim().replace(/^&/u, "");
  const call = /^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(/u.exec(cleaned);
  if (call?.[1]) return localReturns?.get(call[1]) ?? hints.returns.get(call[1]);
  const composite = /^([A-Za-z_]\w*)\s*\{/u.exec(cleaned);
  if (composite?.[1] && hints.types.has(composite[1])) return composite[1];
  return hints.values.get(cleaned);
}

function goAnnotationType(annotation: string): string | undefined {
  const names = annotation.replace(/[\[\]]/gu, " ").match(/[A-Za-z_]\w*/gu) ?? [];
  return names[names.length - 1];
}

function goFunctionReturns(value: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of value.matchAll(/\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(([\s\S]*?)\)\s*([^{;]*?)\{/gu)) {
    const declared = ((match[3] as string).trim().replace(/^\(/u, "").split(",")[0] as string).trim();
    const type = goAnnotationType(declared);
    if (type && /^[A-Z]/u.test(type)) result.set(match[1] as string, type);
  }
  return result;
}

function goFunctionParameters(value: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of value.matchAll(/\bfunc\s+(?:\([^)]*\)\s*)?[A-Za-z_]\w*\s*\(([\s\S]*?)\)/gu)) {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    const source = match[1] as string;
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (char === "(" || char === "[" || char === "{") depth += 1;
      else if (char === ")" || char === "]" || char === "}") depth = Math.max(0, depth - 1);
      else if (char === "," && depth === 0) {
        parts.push(source.slice(start, index));
        start = index + 1;
      }
    }
    if (start < source.length) parts.push(source.slice(start));
    let current: string | undefined;
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = (parts[index] as string).trim();
      const named = /^([A-Za-z_]\w*)\s+(.+)$/u.exec(part);
      if (named) {
        current = goAnnotationType(named[2] as string);
        if (current) result.set(named[1] as string, current);
        continue;
      }
      const bare = /^([A-Za-z_]\w*)$/u.exec(part);
      if (bare && current) result.set(bare[1] as string, current);
    }
  }
  return result;
}

function lexFenceAnchors(
  node: Code,
  docPath: string,
  heading: string,
  language: "rust" | "go",
  goHints?: GoTypeHints,
): FenceResult {
  const value = node.value;
  const lexed = lex(value, language);
  const imports: Record<string, ImportRef> = {};
  const locals = new Set<string>();
  const parameters = language === "go" ? goFunctionParameters(value) : new Map<string, string>();
  const helperReturns = language === "go" ? goFunctionReturns(value) : new Map<string, string>();
  for (const line of value.split("\n")) {
    if (language === "rust") {
      const use = /^\s*use\s+([\w:]+)(?:\s+as\s+(\w+))?;/u.exec(line);
      if (use?.[1]) {
        const imported = use[1].split("::").pop() ?? use[1];
        imports[use[2] ?? imported] = { source: use[1], imported };
      }
      const local = /\b(?:fn|struct|enum|trait|type|const|static|let|mod)\s+([A-Za-z_]\w*)/u.exec(line);
      if (local?.[1]) locals.add(local[1]);
    } else {
      const use = /^\s*import\s+(?:(\w+)\s+)?"([^"]+)"/u.exec(line);
      if (use?.[2]) {
        const imported = use[2].split("/").pop() ?? use[2];
        imports[use[1] ?? imported] = { source: use[2], imported };
      }
      const local = /\b(?:func|type|var|const)\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/u.exec(line);
      if (local?.[1]) locals.add(local[1]);
      const short = /^\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*:=/u.exec(line);
      if (short?.[1]) {
        for (const name of short[1].split(",")) locals.add(name.trim());
      }
    }
  }
  for (const name of parameters.keys()) locals.add(name);
  const localTypes = new Map<string, string>(parameters);
  const goFallback: GoTypeHints = {
    types: new Set(),
    returns: new Map(),
    values: new Map(),
    fields: new Map(),
  };
  const inferGoValue = (expression: string): string | undefined => {
    const alias = /^([A-Za-z_]\w*)$/u.exec(expression.trim());
    if (alias?.[1]) return localTypes.get(alias[1]);
    return inferGoExpression(expression, goHints ?? goFallback, helperReturns);
  };
  const setGoType = (name: string, type: string | undefined): void => {
    if (type) localTypes.set(name, type);
    else localTypes.delete(name);
  };
  if (language === "go" && (goHints || helperReturns.size > 0)) {
    for (const line of value.split("\n")) {
      const declaration = /^\s*var\s+([A-Za-z_]\w*)\s*(.*)$/u.exec(line);
      if (declaration?.[1]) {
        const rest = declaration[2] as string;
        const equal = rest.indexOf("=");
        if (equal >= 0) {
          const annotation = rest.slice(0, equal).trim();
          const expression = rest.slice(equal + 1).trim();
          setGoType(
            declaration[1],
            goAnnotationType(annotation) ?? inferGoValue(expression),
          );
        } else {
          setGoType(declaration[1], goAnnotationType(rest));
        }
        continue;
      }
      const short = /^\s*([A-Za-z_]\w*)(?:\s*,\s*[A-Za-z_]\w*)*\s*:=\s*(.+)$/u.exec(line);
      if (short?.[1]) {
        setGoType(short[1], inferGoValue(short[2] as string));
        continue;
      }
      const assignment = /^\s*([A-Za-z_]\w*)(?:\s*,\s*[A-Za-z_]\w*)*\s*=(?!=)\s*(.+)$/u.exec(line);
      if (assignment?.[1]) {
        setGoType(assignment[1], inferGoValue(assignment[2] as string));
      }
    }
  }
  const signature = language === "rust" ? snippetSignatureRust(value) : snippetSignatureGo(value);
  const startLine = node.position?.start.line ?? 1;
  if (signature) {
    const identifier = value.indexOf(signature.name);
    const before = identifier >= 0 ? value.slice(0, identifier) : "";
    const lines = before.split("\n");
    return {
      anchors: [
        makeAnchor(
          docPath,
          signature.name,
          startLine + 1 + Math.max(0, lines.length - 1),
          (lines[lines.length - 1]?.length ?? 0) + 1,
          "signatureFence",
          [heading, value.split("\n")[0] ?? ""],
          imports,
          [...locals].filter((name) => name !== signature.name),
          false,
          node.lang ?? undefined,
          signature.shape,
        ),
      ],
      imports,
    };
  }

  const anchors: DocAnchor[] = [];
  for (let index = 0; index < lexed.tokens.length; index += 1) {
    const token = lexed.tokens[index];
    if (!/^[A-Za-z_]/u.test(token.value)) continue;
    if (language === "go" && GO_KEYWORDS.has(token.value)) continue;
    if (token.value.length < 2 && !localTypes.has(token.value)) continue;
    let chain = token.value;
    let chainEnd = index;
    while (
      lexed.tokens[chainEnd + 1]?.value === "." ||
      (language === "rust" && lexed.tokens[chainEnd + 1]?.value === "::")
    ) {
      const next = lexed.tokens[chainEnd + 2];
      if (!next || !/^[A-Za-z_]/u.test(next.value)) break;
      chain += `.${next.value}`;
      chainEnd += 2;
    }
    let anchorToken = chain;
    if (locals.has(token.value)) {
      const type = localTypes.get(token.value);
      if (!type || !chain.includes(".")) {
        index = chainEnd;
        continue;
      }
      const parts = chain.split(".");
      let resolvedType = type;
      let partIndex = 1;
      while (partIndex < parts.length - 1) {
        const fieldType = goHints?.fields.get(`${resolvedType}.${parts[partIndex]}`);
        if (!fieldType) break;
        resolvedType = fieldType;
        partIndex += 1;
      }
      anchorToken = `${resolvedType}.${parts.slice(partIndex).join(".")}`;
    }
    const position = lexed.masked.slice(0, token.start).split("\n").length - 1;
    const column = token.start - lexed.masked.lastIndexOf("\n", token.start - 1);
    anchors.push(
      makeAnchor(
        docPath,
        anchorToken,
        startLine + 1 + position,
        column,
        "fenceToken",
        [heading, contextLine(value, position)],
        imports,
        [...locals],
        lexed.error || /\.\.\./u.test(value),
        node.lang ?? undefined,
        undefined,
        language === "rust" && /derive\s*\(/u.test(contextLine(value, position)) ? ["derive"] : undefined,
      ),
    );
    index = chainEnd;
  }
  return { anchors, imports };
}

export function fenceAnchors(
  node: Code,
  docPath: string,
  heading: string,
  pythonHints?: PythonTypeHints,
  goHints?: GoTypeHints,
): FenceResult {
  const lang = (node.lang ?? "").toLowerCase();
  if (TS_LANGS.has(lang)) return tsFenceAnchors(node, docPath, heading);
  if (PY_LANGS.has(lang)) return pyFenceAnchors(node, docPath, heading, pythonHints);
  if (RUST_LANGS.has(lang)) return lexFenceAnchors(node, docPath, heading, "rust");
  if (GO_LANGS.has(lang)) return lexFenceAnchors(node, docPath, heading, "go", goHints);
  return { anchors: [], imports: {} };
}

export function isSupportedFence(lang: string | null | undefined): boolean {
  const normalized = (lang ?? "").toLowerCase();
  return TS_LANGS.has(normalized) || PY_LANGS.has(normalized) || RUST_LANGS.has(normalized) || GO_LANGS.has(normalized);
}

export function isHistoricalContext(heading: string, line: string): boolean {
  return hasNegativeCue(`${heading} ${line}`);
}

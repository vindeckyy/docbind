import ts from "typescript";
import type { Code } from "mdast";
import { contextFingerprint, hasNegativeCue } from "./context.js";
import type { DocAnchor, ImportRef, Shape } from "../types.js";
import { snippetSignature } from "../surface/typescript.js";
import { snippetSignatureRust } from "../surface/rust.js";
import { snippetSignatureGo } from "../surface/go.js";
import { lex } from "../surface/lex.js";

const TS_LANGS = new Set(["ts", "typescript", "tsx", "js", "javascript", "jsx", "mjs", "cjs"]);
const PY_LANGS = new Set(["py", "python"]);
const RUST_LANGS = new Set(["rs", "rust"]);
const GO_LANGS = new Set(["go", "golang"]);
const PY_KEYWORDS = new Set([
  "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del",
  "elif", "else", "except", "False", "finally", "for", "from", "global", "if", "import",
  "in", "is", "lambda", "None", "nonlocal", "not", "or", "pass", "raise", "return",
  "True", "try", "while", "with", "yield", "self", "cls",
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

function pyFenceAnchors(node: Code, docPath: string, heading: string): FenceResult {
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
    const declaration = /^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/u.exec(line);
    if (declaration?.[1]) locals.add(declaration[1]);
    const assignment = /^\s*([A-Za-z_]\w*)\s*=/u.exec(line);
    if (assignment?.[1]) locals.add(assignment[1]);
  }
  const anchors: DocAnchor[] = [];
  const seen = new Set<string>();
  const startLine = node.position?.start.line ?? 1;
  const lines = value.split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    for (const match of line.matchAll(/[A-Za-z_]\w*/gu)) {
      const token = match[0];
      const column = (match.index ?? 0) + 1;
      if (
        token.length < 2 ||
        PY_KEYWORDS.has(token) ||
        locals.has(token) ||
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

function lexFenceAnchors(
  node: Code,
  docPath: string,
  heading: string,
  language: "rust" | "go",
): FenceResult {
  const value = node.value;
  const lexed = lex(value, language);
  const imports: Record<string, ImportRef> = {};
  const locals = new Set<string>();
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
  const seen = new Set<string>();
  for (const token of lexed.tokens) {
    if (token.value.length < 2 || !/^[A-Za-z_]/u.test(token.value)) continue;
    if (locals.has(token.value) || seen.has(`${token.start}`)) continue;
    const position = lexed.masked.slice(0, token.start).split("\n").length - 1;
    const column = token.start - lexed.masked.lastIndexOf("\n", token.start - 1);
    seen.add(`${token.start}`);
    anchors.push(
      makeAnchor(
        docPath,
        token.value,
        startLine + 1 + position,
        column,
        "fenceToken",
        [heading, contextLine(value, position)],
        imports,
        [...locals],
        lexed.error || /\.\.\./u.test(value),
        node.lang ?? undefined,
      ),
    );
  }
  return { anchors, imports };
}

export function fenceAnchors(node: Code, docPath: string, heading: string): FenceResult {
  const lang = (node.lang ?? "").toLowerCase();
  if (TS_LANGS.has(lang)) return tsFenceAnchors(node, docPath, heading);
  if (PY_LANGS.has(lang)) return pyFenceAnchors(node, docPath, heading);
  if (RUST_LANGS.has(lang)) return lexFenceAnchors(node, docPath, heading, "rust");
  if (GO_LANGS.has(lang)) return lexFenceAnchors(node, docPath, heading, "go");
  return { anchors: [], imports: {} };
}

export function isSupportedFence(lang: string | null | undefined): boolean {
  const normalized = (lang ?? "").toLowerCase();
  return TS_LANGS.has(normalized) || PY_LANGS.has(normalized) || RUST_LANGS.has(normalized) || GO_LANGS.has(normalized);
}

export function isHistoricalContext(heading: string, line: string): boolean {
  return hasNegativeCue(`${heading} ${line}`);
}

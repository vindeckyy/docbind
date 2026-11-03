import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { findPackageRoot, modulePathFor } from "../discover.js";
import { canonicalShape, bodyHash, paramNamesHash, shapeHash } from "../shape/canonical.js";
import type { ExtractResult } from "./protocol.js";
import type { ParamShape, Shape, Symbol, SymbolKind } from "../types.js";

interface RustdocItem {
  name?: string;
  visibility?: unknown;
  span?: { filename?: string; begin?: [number, number] };
  inner?: Record<string, unknown>;
  items?: number[];
}

interface RustdocIndex {
  index?: Record<string, RustdocItem>;
}

export interface CargoResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type CargoRunner = (args: string[], cwd: string) => CargoResult;

const defaultCargo: CargoRunner = (args, cwd) => {
  const result = spawnSync("cargo", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status,
    /* v8 ignore next 2 */
    stdout: result.stdout ?? "",
    /* v8 ignore next 2 */
    stderr: result.stderr ?? "",
  };
};

function isPublic(visibility: unknown): boolean {
  return visibility === "public" || visibility === "default" || visibility === undefined;
}

export function typeText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.primitive === "string") return record.primitive;
  if (typeof record.generic === "string") return record.generic;
  if (typeof record.infer === "string") return record.infer;
  if (typeof record.resolved_path === "object" && record.resolved_path) {
    const path = record.resolved_path as Record<string, unknown>;
    const name = typeof path.name === "string" ? path.name : "unknown";
    const args = path.args as Record<string, unknown> | undefined;
    const angle = args?.angle_bracketed as Record<string, unknown> | undefined;
    const values = Array.isArray(angle?.args) ? angle.args : [];
    const rendered = values
      .map((argument) => {
        const item = argument as Record<string, unknown>;
        if (item.type) return typeText(item.type);
        if (item.lifetime) return `'${String(item.lifetime)}`;
        return "";
      })
      .filter(Boolean);
    return rendered.length > 0 ? `${name}<${rendered.join(",")}>` : name;
  }
  if (typeof record.borrowed_ref === "object" && record.borrowed_ref) {
    const reference = record.borrowed_ref as Record<string, unknown>;
    return `${reference.mutable ? "&mut " : "&"}${typeText(reference.type)}`;
  }
  if (typeof record.raw_pointer === "object" && record.raw_pointer) {
    const pointer = record.raw_pointer as Record<string, unknown>;
    return `${pointer.mutable ? "*mut " : "*const "}${typeText(pointer.type)}`;
  }
  if (Array.isArray(record.tuple)) return `(${record.tuple.map(typeText).join(",")})`;
  if (record.slice) return `[${typeText(record.slice)}]`;
  if (record.array) {
    const array = record.array as Record<string, unknown>;
    return `[${typeText(array.type)};${String(array.len)}]`;
  }
  if (record.qualified_path) {
    const path = record.qualified_path as Record<string, unknown>;
    return typeText(path.self_type);
  }
  if (record.impl_trait) return "impl Trait";
  if (record.dyn_trait) return "dyn Trait";
  return "";
}

export function typeName(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.resolved_path === "object" && record.resolved_path) {
    const path = record.resolved_path as Record<string, unknown>;
    if (typeof path.name === "string") return path.name.split("::").pop();
  }
  if (typeof record.generic === "string") return record.generic;
  return undefined;
}

function shapeFromFunction(input: Record<string, unknown>, method: boolean): Shape {
  const signature = (input.sig as Record<string, unknown> | undefined) ?? {};
  const inputs = Array.isArray(signature.inputs) ? signature.inputs : [];
  const params: ParamShape[] = inputs.map((value, index) => ({
    name: `arg${index}`,
    type: typeText(value),
    optional: false,
    rest: false,
    hasDefault: false,
  }));
  const generics = (input.generics as Record<string, unknown> | undefined) ?? {};
  const typeParams = Array.isArray(generics.params)
    ? generics.params
        .map((parameter) => (parameter as Record<string, unknown>).name)
        .filter((name): name is string => typeof name === "string")
    : [];
  const header = (input.header as Record<string, unknown> | undefined) ?? {};
  const output = typeText(signature.output);
  return {
    kind: method ? "method" : "function",
    async: header.is_async === true,
    generator: false,
    typeParams: typeParams.length > 0 ? typeParams.join(",") : undefined,
    params,
    returnType: output || undefined,
    visibility: "public",
    flags: header.is_unsafe === true ? ["unsafe"] : [],
  };
}

function symbolFromFunction(
  item: RustdocItem,
  functionInput: Record<string, unknown>,
  root: string,
  packageRoot: string,
  packageName: string,
  parentName?: string,
): Symbol | undefined {
  if (!item.name || !isPublic(item.visibility)) return undefined;
  const filename = item.span?.filename ?? "";
  const absolute = join(root, filename);
  const filePath = existsSync(absolute) ? relative(root, absolute).replace(/\\/gu, "/") : filename;
  const modulePath = filePath.endsWith(".rs") ? modulePathFor(packageRoot, join(root, filePath)) : "rustdoc";
  const kind: SymbolKind = parentName ? "method" : "function";
  const shape = shapeFromFunction(functionInput, Boolean(parentName));
  const shapeText = canonicalShape(shape);
  const qualified = `${packageName}.${modulePath.replace(/\//gu, ".")}.${parentName ? `${parentName}.` : ""}${item.name}`;
  return {
    id: `${packageName}|rustdoc|${kind}|${parentName ? `${parentName}.` : ""}${item.name}|0`,
    name: item.name,
    kind,
    modulePath,
    packageName,
    packageRoot,
    qualifiedName: qualified,
    aliases: [
      `${modulePath.replace(/\//gu, ".")}.${parentName ? `${parentName}.` : ""}${item.name}`,
      `${packageName}.${parentName ? `${parentName}.` : ""}${item.name}`,
      ...(parentName ? [`${parentName}.${item.name}`] : []),
    ],
    shape,
    shapeText,
    shapeHash: shapeHash(shape),
    paramNamesHash: paramNamesHash(shape.params),
    bodyHash: bodyHash(""),
    contractFlags: shape.flags ?? [],
    line: item.span?.begin?.[0] ?? 1,
    filePath,
  };
}

export function parseRustdocJson(
  data: RustdocIndex,
  root: string,
  packageRoot: string,
  packageName: string,
): Symbol[] {
  const index = data.index ?? {};
  const symbols: Symbol[] = [];
  const seen = new Set<string>();
  const add = (symbol: Symbol | undefined): void => {
    if (!symbol) return;
    const key = `${symbol.name}|${symbol.kind}|${symbol.qualifiedName}`;
    if (seen.has(key)) return;
    seen.add(key);
    symbols.push(symbol);
  };

  for (const item of Object.values(index)) {
    const inner = item.inner ?? {};
    if (inner.function && item.name) {
      add(symbolFromFunction(item, inner.function as Record<string, unknown>, root, packageRoot, packageName));
    }
    if (inner.impl) {
      const implementation = inner.impl as Record<string, unknown>;
      const target = typeName(implementation.for);
      const itemIds = Array.isArray(implementation.items) ? implementation.items : [];
      for (const id of itemIds) {
        const method = index[String(id)];
        const methodInner = method?.inner?.function;
        if (method && methodInner && target) {
          add(symbolFromFunction(
            method,
            methodInner as Record<string, unknown>,
            root,
            packageRoot,
            packageName,
            target,
          ));
        }
      }
    }
    if (inner.trait) {
      const traitItem = inner.trait as Record<string, unknown>;
      const itemIds = Array.isArray(traitItem.items) ? traitItem.items : [];
      for (const id of itemIds) {
        const method = index[String(id)];
        const methodInner = method?.inner?.function;
        if (method && methodInner && item.name) {
          add(symbolFromFunction(
            method,
            methodInner as Record<string, unknown>,
            root,
            packageRoot,
            packageName,
            item.name,
          ));
        }
      }
    }
    if (inner.proc_macro && item.name) {
      add({
        ...symbolFromFunction(
          { ...item, visibility: "public" },
          { sig: { inputs: [] }, header: {}, generics: {} },
          root,
          packageRoot,
          packageName,
        )!,
        kind: "function",
      });
    }
  }
  return symbols;
}

function packageMetadata(
  packageRoot: string,
  runner: CargoRunner,
): { name: string; target: string } | undefined {
  const result = runner(["metadata", "--no-deps", "--format-version", "1"], packageRoot);
  if (result.status !== 0) return undefined;
  try {
    const metadata = JSON.parse(result.stdout) as {
      target_directory?: string;
      packages?: Array<{ name: string; manifest_path: string }>;
    };
    const manifest = join(packageRoot, "Cargo.toml");
    const pkg = metadata.packages?.find((candidate) => candidate.manifest_path === manifest);
    if (!pkg?.name || !metadata.target_directory) return undefined;
    return { name: pkg.name, target: metadata.target_directory };
  } catch {
    return undefined;
  }
}

export function extractRustdoc(
  root: string,
  files: string[],
  runner: CargoRunner = defaultCargo,
): ExtractResult {
  const packageRoots = new Set(files.map((file) => findPackageRoot(root, file).root));
  const symbols: Symbol[] = [];
  let parseFailures = 0;
  const errors: string[] = [];
  for (const packageRoot of packageRoots) {
    const metadata = packageMetadata(packageRoot, runner);
    if (!metadata) continue;
    const build = runner(
      ["+nightly", "rustdoc", "--lib", "--", "-Z", "unstable-options", "--output-format", "json"],
      packageRoot,
    );
    if (build.status !== 0) {
      parseFailures += 1;
      errors.push((build.stderr || "rustdoc failed").trim());
      continue;
    }
    const jsonPath = join(metadata.target, "doc", `${metadata.name.replace(/-/gu, "_")}.json`);
    try {
      const data = JSON.parse(readFileSync(jsonPath, "utf8")) as RustdocIndex;
      symbols.push(...parseRustdocJson(data, root, packageRoot, metadata.name));
    } catch (error) {
      parseFailures += 1;
      errors.push(`cannot read rustdoc json: ${(error as Error).message}`);
    }
  }
  return {
    symbols,
    parseFailures,
    filesScanned: 0,
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
  };
}

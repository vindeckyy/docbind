import { describe, expect, it } from "vitest";
import { extractTypescript } from "../src/surface/typescript.js";
import { tempProject } from "./helpers.js";

function extraProject(): string {
  return tempProject({
    "package.json": JSON.stringify({ name: "app" }),
    "src/extra.ts": `
/** @deprecated */
export abstract class Base<T> extends Root implements Face {
  protected p = 1;
  #secret = 2;
  [Symbol.iterator](): Iterator<T> { throw new Error(); }
  abstract run<U>(x: U): U;
  [key: string]: unknown;
  call(): void {}
  construct: new () => Base<T>;
  get value(): T { throw new Error(); }
  set value(v: T) {}
}
export namespace NS { export const x = 1; }
export async function* stream(): AsyncGenerator<number> { yield 1; }
export function destructured({ a }: { a: string }, b = 1): void {}
export interface Callable { (x: string): void; new (x: string): Callable; [key: string]: unknown; }
export const { d1, d2: d3 } = { d1: 1, d2: 2 };
const localConst = 1;
export let bare;
export type Obj = { a: string; b?: number; method(x: string): void };
export const values = { a: 1 };
export const list = [1, 2];
export const flag = true;
export const nul = null;
export const num = 1;
export const str = \`x\`;
export const template = \`x\${num}\`;
export const arrow = () => 1;
export const expr = getSomething();
export const noInit: string;
function getSomething(): unknown { return 1; }
`,
    "src/anon-fn.ts": "export default function (): void {}",
    "src/anon-class.ts": "export default class {}",
    "src/exporteq.ts": "function local(): void {}\nexport = local;",
    "src/reexport.ts": 'export { other as alias } from "./other";\nexport { missing } from "./nope";\nexport { localConst as broken };\nexport { ghost };\nexport { external } from "pkg";\nexport * as ns from "./other";',
    "src/other.ts": "export function other(): void {}",
    "src/barrel.ts": 'export * from "./dir";\nexport { other } from "./other.js";',
    "src/namespace.ts": 'export * as api from "./other";\nexport * as missing from "./nope";',
    "src/dir/index.ts": "export const nested = 1;",
    "src/cycle-a.ts": 'export * from "./cycle-b";\nexport const a = 1;',
    "src/cycle-b.ts": 'export * from "./cycle-a";\nexport const b = 1;',
    "src/exportnum.ts": "export = 1;",
    "src/comp.tsx": "export const Component = (): null => null;",
    "src/comp.jsx": "export const Jsx = () => null;",
    "src/mod.mjs": "export const Mjs = 1;",
    "src/mod.cjs": "export const Cjs = 1;",
  });
}

describe("TypeScript surface edge cases", () => {
  it("handles the full declaration surface", () => {
    const root = extraProject();
    const files = [
      "src/extra.ts", "src/anon-fn.ts", "src/anon-class.ts", "src/exporteq.ts",
      "src/reexport.ts", "src/other.ts", "src/barrel.ts", "src/namespace.ts", "src/dir/index.ts",
      "src/cycle-a.ts", "src/cycle-b.ts", "src/exportnum.ts", "src/comp.tsx", "src/comp.jsx",
      "src/mod.mjs", "src/mod.cjs",
    ];
    const result = extractTypescript(root, files);
    const names = result.symbols.map((symbol) => symbol.name);
    expect(names).toEqual(expect.arrayContaining([
      "Base", "NS", "Obj", "values", "list", "flag", "nul", "num", "str",
      "template", "arrow", "expr", "noInit", "default", "local", "other", "stream", "destructured", "Callable",
      "a", "b", "Component", "Jsx", "Mjs", "Cjs",
    ]));
    expect(result.symbols.find((symbol) => symbol.name === "Base")?.shape.abstract).toBe(true);
    expect(result.symbols.find((symbol) => symbol.name === "run")?.shape.typeParams).toBe("U");
    expect(result.symbols.find((symbol) => symbol.name === "Base")?.contractFlags).toContain("deprecated");
    expect(result.symbols.find((symbol) => symbol.name === "values")?.shape.literalKind).toBe("object");
    expect(result.symbols.find((symbol) => symbol.name === "list")?.shape.literalKind).toBe("array");
    expect(result.symbols.find((symbol) => symbol.name === "flag")?.shape.literalKind).toBe("boolean");
    expect(result.symbols.find((symbol) => symbol.name === "nul")?.shape.literalKind).toBe("null");
    expect(result.symbols.find((symbol) => symbol.name === "num")?.shape.literalKind).toBe("number");
    expect(result.symbols.find((symbol) => symbol.name === "str")?.shape.literalKind).toBe("string");
    expect(result.symbols.find((symbol) => symbol.name === "template")?.shape.literalKind).toBe("expression");
    expect(result.symbols.find((symbol) => symbol.name === "arrow")?.shape.literalKind).toBe("function");
    expect(result.symbols.find((symbol) => symbol.name === "expr")?.shape.literalKind).toBe("expression");
    expect(result.symbols.find((symbol) => symbol.name === "noInit")?.shape.typeShape).toBe("string");
    expect(result.symbols.find((symbol) => symbol.name === "nested")?.modulePath).toBe("src/dir");
    expect(result.symbols.find((symbol) => symbol.name === "stream")?.shape.async).toBe(true);
    expect(result.symbols.find((symbol) => symbol.name === "stream")?.shape.generator).toBe(true);
    expect(result.symbols.find((symbol) => symbol.name === "destructured")?.shape.params?.[0].name).toContain("a");
  });

  it("resolves re-exports, cycles and missing targets", () => {
    const root = extraProject();
    const result = extractTypescript(root, ["src/reexport.ts", "src/other.ts", "src/barrel.ts", "src/namespace.ts", "src/dir/index.ts", "src/cycle-a.ts", "src/cycle-b.ts"]);
    expect(result.symbols.find((symbol) => symbol.name === "other")?.aliases).toContain("alias");
    expect(result.symbols.find((symbol) => symbol.name === "nested")?.aliases).toContain("dir.nested");
    expect(result.symbols.find((symbol) => symbol.name === "other")?.aliases).toContain("api.other");
    expect(result.symbols.map((symbol) => symbol.name)).toEqual(expect.arrayContaining(["a", "b"]));
  });
});

import { describe, expect, it } from "vitest";
import { extractTypescript, snippetSignature } from "../src/surface/typescript.js";
import { tempProject } from "./helpers.js";

function project(): string {
  return tempProject({
    "package.json": JSON.stringify({ name: "app" }),
    "src/users.ts": `
export interface User { id: string; email?: string; }
export type Maybe<T> = T | null;
export enum Role { Admin = "admin", User = "user" }
export const VERSION: string = "1";
export function getUser(id: string): User { return { id }; }
function hidden(): void {}
export class Client {
  private secret = 1;
  static readonly version = "1";
  constructor(public name: string) {}
  request(path: string): Promise<User> { return Promise.resolve({ id: path }); }
  get active(): boolean { return true; }
}
export { getUser as fetchUser };
export * from "./other";
`,
    "src/other.ts": "export function other(): void {}",
    "src/default.ts": "export default function namedDefault(): void {}",
    "src/anon.ts": "export default class { run(): void {} }",
    "src/overloads.ts": `
export function over(a: string): string;
export function over(a: number, b: number): number;
export function over(a: unknown, b?: unknown): unknown { return a; }
`,
    "src/bad.ts": "export function broken(",
    "packages/app/package.json": JSON.stringify({ name: "nested" }),
    "packages/app/src/nested.ts": "export function nested(): void {}",
  });
}

describe("TypeScript surface", () => {
  it("extracts exported declarations and members", () => {
    const root = project();
    const result = extractTypescript(root, [
      "src/users.ts",
      "src/other.ts",
      "src/default.ts",
      "src/anon.ts",
      "src/overloads.ts",
      "packages/app/src/nested.ts",
    ]);
    const names = result.symbols.map((symbol) => symbol.name);
    expect(names).toEqual(expect.arrayContaining([
      "User", "Maybe", "Role", "VERSION", "getUser", "Client", "other", "namedDefault", "default", "over", "nested", "request",
    ]));
    expect(names).not.toContain("hidden");
    expect(names).not.toContain("secret");
    expect(result.symbols.find((symbol) => symbol.name === "request")).toMatchObject({
      kind: "method",
      parentId: expect.stringContaining("Client"),
    });
    expect(result.symbols.find((symbol) => symbol.name === "active")?.kind).toBe("property");
    expect(result.symbols.find((symbol) => symbol.name === "version")?.contractFlags).toContain("static");
    expect(result.symbols.find((symbol) => symbol.name === "getUser")?.aliases).toContain("fetchUser");
    expect(result.symbols.find((symbol) => symbol.name === "namedDefault")?.aliases).toContain("default");
    expect(result.symbols.find((symbol) => symbol.name === "nested")?.packageName).toBe("nested");
  });

  it("keeps overload indexes distinct", () => {
    const root = project();
    const result = extractTypescript(root, ["src/overloads.ts"]);
    const overloads = result.symbols.filter((symbol) => symbol.name === "over");
    expect(overloads).toHaveLength(3);
    expect(new Set(overloads.map((symbol) => symbol.id)).size).toBe(3);
    expect(overloads.map((symbol) => symbol.id)).toEqual([
      expect.stringContaining("|0"),
      expect.stringContaining("|1"),
      expect.stringContaining("|2"),
    ]);
  });

  it("records parse failures and missing files", () => {
    const root = project();
    const result = extractTypescript(root, ["src/bad.ts", "src/missing.ts"]);
    expect(result.parseFailures).toBeGreaterThan(0);
  });

  it("extracts class, interface, const and enum shapes", () => {
    const root = project();
    const result = extractTypescript(root, ["src/users.ts"]);
    const user = result.symbols.find((symbol) => symbol.name === "User");
    expect(user?.shape.members?.map((member) => member.name)).toEqual(expect.arrayContaining(["id", "email"]));
    const role = result.symbols.find((symbol) => symbol.name === "Role");
    expect(role?.shape.enumMembers).toHaveLength(2);
    const version = result.symbols.find((symbol) => symbol.name === "VERSION");
    expect(version?.shape.typeShape).toBe("string");
    const client = result.symbols.find((symbol) => symbol.name === "Client");
    expect(client?.shape.extends).toEqual([]);
    expect(client?.shape.members?.length).toBeGreaterThan(2);
  });
});

describe("signature snippets", () => {
  it("parses signature fences", () => {
    expect(snippetSignature("function getUser(id: string): User")?.name).toBe("getUser");
    expect(snippetSignature("interface User { id: string }")?.kind).toBe("interface");
    expect(snippetSignature("type Id = string;")?.kind).toBe("type");
    expect(snippetSignature("class Client { request(): void }")?.kind).toBe("class");
    expect(snippetSignature("const VERSION: string")?.kind).toBe("const");
  });

  it("rejects examples with bodies or multiple statements", () => {
    expect(snippetSignature("function getUser() { return 1; }")).toBeUndefined();
    expect(snippetSignature("const a = 1; const b = 2;")).toBeUndefined();
    expect(snippetSignature("class Client { request(): void {} }")).toBeUndefined();
    expect(snippetSignature("const a = 1;")).toBeUndefined();
  });
});

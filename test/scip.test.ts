import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkProject } from "../src/check.js";
import { parseConfig } from "../src/config.js";
import { extractScip, nameFromSymbol } from "../src/surface/scip.js";
import { cli, tempProject } from "./helpers.js";

function varint(value: number): Buffer {
  const bytes: number[] = [];
  let rest = value;
  while (rest > 0x7f) {
    bytes.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  bytes.push(rest);
  return Buffer.from(bytes);
}

function key(field: number, wire: number): Buffer {
  return varint((field << 3) | wire);
}

function text(field: number, value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([key(field, 2), varint(bytes.length), bytes]);
}

function message(field: number, value: Buffer): Buffer {
  return Buffer.concat([key(field, 2), varint(value.length), value]);
}

function numberField(field: number, value: number): Buffer {
  return Buffer.concat([key(field, 0), varint(value)]);
}

function packed(field: number, values: number[]): Buffer {
  const payload = Buffer.concat(values.map(varint));
  return Buffer.concat([key(field, 2), varint(payload.length), payload]);
}

function fixture(root: string): string {
  const symbol = "scip-typescript npm app 1.0 src/users.ts/getUser().";
  const occurrence = Buffer.concat([
    packed(1, [0, 13, 20]),
    text(2, symbol),
    numberField(3, 1),
  ]);
  const info = Buffer.concat([text(1, symbol), numberField(5, 17), text(6, "getUser")]);
  const document = Buffer.concat([
    text(1, "src/users.ts"),
    message(2, occurrence),
    message(3, info),
  ]);
  const index = message(2, document);
  const path = join(root, "index.scip");
  writeFileSync(path, index);
  return path;
}

function signatureFixture(root: string): { path: string; symbol: ReturnType<typeof extractScip>["symbols"][number] } {
  const symbol = "scip-typescript npm app 1.0 src/users.ts/getUser().";
  const signature = "export function getUser(id: string): string";
  const occurrence = Buffer.concat([packed(1, [0, 13, 20]), text(2, symbol), numberField(3, 1)]);
  const info = Buffer.concat([
    text(1, symbol),
    numberField(5, 17),
    text(6, "getUser"),
    message(7, Buffer.concat([numberField(4, 23), text(5, signature)])),
  ]);
  const document = Buffer.concat([text(1, "src/users.ts"), message(2, occurrence), message(3, info)]);
  const path = join(root, "signature.scip");
  writeFileSync(path, message(2, document));
  return { path, symbol: extractScip(root, path).symbols[0]! };
}

describe("SCIP signatures", () => {
  it("parses signature_documentation into a contract shape", () => {
    const root = tempProject({ "src/users.ts": "export const other = 1;\n" });
    const { symbol } = signatureFixture(root);
    expect(symbol.indexContract).toBe(true);
    expect(symbol.shape.params).toEqual([
      { name: "id", type: "string", optional: false, rest: false, hasDefault: false, kind: "positional" },
    ]);
    expect(symbol.shape.returnType).toBe("string");
  });

  it("checks inline contracts and satisfies --require-contracts", async () => {
    const root = tempProject({
      "package.json": JSON.stringify({ name: "app" }),
      "src/users.ts": "export const other = 1;\n",
      "docs/api.md": "placeholder\n",
    });
    const { path, symbol } = signatureFixture(root);
    writeFileSync(
      join(root, "docs/api.md"),
      `<!-- docbind: symbol=src/users.ts#getUser contract=${symbol.shapeHash} -->\n\nCall \`getUser(id)\`.\n`,
    );
    expect((await cli(["check", "--index", path], root)).code).toBe(0);
    expect((await cli(["check", "--index", path, "--require-contracts"], root)).code).toBe(0);
    writeFileSync(
      join(root, "docs/api.md"),
      "<!-- docbind: symbol=src/users.ts#getUser contract=0000000000000000 -->\n\nCall `getUser(id)`.\n",
    );
    const drift = await cli(["check", "--index", path, "--json"], root);
    expect(drift.code).toBe(1);
    expect(JSON.parse(drift.stdout).findings[0].rule).toBe("L3-reshaped");
  });
});

describe("SCIP ingestion", () => {
  it("decodes documents, definitions, and kinds", () => {
    const root = tempProject({ "src/users.ts": "export const other = 1;\n" });
    const result = extractScip(root, fixture(root));
    expect(result.error).toBeUndefined();
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0]).toMatchObject({
      name: "getUser",
      kind: "function",
      filePath: "src/users.ts",
      line: 1,
      indexOnly: true,
    });
  });

  it("binds explicit annotations through a SCIP index", () => {
    const root = tempProject({
      "package.json": JSON.stringify({ name: "app" }),
      "src/users.ts": "export const other = 1;\n",
      "docs/api.md": "<!-- docbind: symbol=src/users.ts#getUser -->\n\nCall `getUser(id)`.\n",
    });
    const index = fixture(root);
    expect(checkProject(root, parseConfig({ indexes: [index] })).findings).toEqual([]);
    expect(checkProject(root, parseConfig({})).findings[0]?.rule).toBe("L1-broken");
  });

  it("warns on invalid indexes", () => {
    const root = tempProject({ "src/users.ts": "export const other = 1;\n" });
    writeFileSync(join(root, "bad.scip"), Buffer.from([0xff, 0xff, 0xff]));
    const result = checkProject(root, parseConfig({ indexes: ["bad.scip"] }));
    expect(result.warnings[0]).toContain("SCIP index");
  });
});

describe("SCIP edge cases", () => {
  it("skips non-definitions, local symbols, and missing paths", () => {
    const root = tempProject({ "src/users.ts": "export const other = 1;\n" });
    const reference = Buffer.concat([packed(1, [0, 0, 1]), text(2, "scip-typescript npm app 1.0 src/users.ts/other()."), numberField(3, 2)]);
    const local = Buffer.concat([packed(1, [1, 0, 1]), text(2, "local 1"), numberField(3, 1)]);
    const typed = Buffer.concat([
      message(8, Buffer.concat([numberField(1, 2), numberField(2, 4), numberField(3, 8)])),
      text(2, "scip-typescript npm app 1.0 src/users.ts/Client#"),
      numberField(3, 1),
    ]);
    const info = Buffer.concat([text(1, "scip-typescript npm app 1.0 src/users.ts/Client#"), numberField(5, 7)]);
    const unknownWire = Buffer.concat([key(64, 1), Buffer.alloc(8), key(65, 5), Buffer.alloc(4)]);
    const unpacked = Buffer.concat([numberField(1, 4), text(2, "scip-typescript npm app 1.0 src/users.ts/unpacked()."), numberField(3, 1)]);
    const document = Buffer.concat([
      text(1, "src/users.ts"),
      message(2, reference),
      message(2, local),
      message(2, typed),
      message(2, unpacked),
      message(3, info),
      unknownWire,
    ]);
    const noPath = message(2, Buffer.concat([message(2, reference)]));
    const index = Buffer.concat([message(2, noPath), message(2, document)]);
    const path = join(root, "edge.scip");
    writeFileSync(path, index);
    const result = extractScip(root, path);
    expect(result.error).toBeUndefined();
    expect(result.symbols).toHaveLength(2);
    expect(result.symbols[0]).toMatchObject({ name: "Client", kind: "class", line: 3 });
    expect(result.symbols[1]).toMatchObject({ name: "unpacked", line: 5 });
  });

  it("skips nameless, duplicate, and role-less definitions", () => {
    const root = tempProject({ "src/users.ts": "export const other = 1;\n" });
    const symbol = "scip-typescript npm app 1.0 src/users.ts/getUser().";
    const definition = Buffer.concat([packed(1, [0, 0, 1]), text(2, symbol), numberField(3, 1)]);
    const noRoles = Buffer.concat([packed(1, [1, 0, 1]), text(2, "scip-typescript npm app 1.0 src/users.ts/other().")]);
    const nameless = Buffer.concat([packed(1, [2, 0, 1]), text(2, "scip-typescript npm app 1.0"), numberField(3, 1)]);
    const document = Buffer.concat([
      text(1, "src/users.ts"),
      message(2, definition),
      message(2, definition),
      message(2, noRoles),
      message(2, nameless),
      message(3, Buffer.concat([text(1, symbol), numberField(5, 17)])),
    ]);
    const path = join(root, "dupes.scip");
    writeFileSync(path, message(2, document));
    const result = extractScip(root, path);
    expect(result.symbols).toHaveLength(1);
  });

  it("parses descriptors and reports truncated indexes", () => {
    expect(nameFromSymbol("scip-typescript npm app 1.0 src/users.ts/getUser().")).toBe("getUser");
    expect(nameFromSymbol("local 12")).toBe("12");
    const root = tempProject({ "src/users.ts": "export const other = 1;\n" });
    writeFileSync(join(root, "truncated.scip"), Buffer.from([0x12, 0x05, 0x01]));
    const result = extractScip(root, join(root, "truncated.scip"));
    expect(result.error).toContain("SCIP index invalid");
  });
});

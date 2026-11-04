import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { extractSurface } from "../src/surface/index.js";

const root = join(import.meta.dirname, "fixtures/golden");
const config = parseConfig({
  languages: { typescript: true, python: true, rust: true, go: true, rustdoc: false },
  javadoc: true,
});

const cases: Array<{ name: string; file: string }> = [
  { name: "typescript", file: "typescript/index.ts" },
  { name: "python", file: "python/mod.py" },
  { name: "rust", file: "rust/lib.rs" },
  { name: "go", file: "go/main.go" },
  { name: "java", file: "java/Client.java" },
];

describe("golden extractor output", () => {
  for (const item of cases) {
    it(`matches the ${item.name} snapshot`, () => {
      const symbols = extractSurface(root, [item.file], config).symbols
        .map((symbol) => ({
          id: symbol.id,
          name: symbol.name,
          kind: symbol.kind,
          qualifiedName: symbol.qualifiedName,
          shapeHash: symbol.shapeHash,
          shape: symbol.shape,
        }))
        .sort((left, right) => left.id.localeCompare(right.id));
      const expected = JSON.parse(readFileSync(join(import.meta.dirname, "golden", `${item.name}.json`), "utf8"));
      expect(symbols).toEqual(expected);
    });
  }
});

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseConfig } from "../src/config.js";
import { extractSurface } from "../src/surface/index.js";

const root = join(process.cwd(), "test/fixtures/golden");
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

mkdirSync(join(process.cwd(), "test/golden"), { recursive: true });
for (const item of cases) {
  const result = extractSurface(root, [item.file], config);
  const symbols = result.symbols
    .map((symbol) => ({
      id: symbol.id,
      name: symbol.name,
      kind: symbol.kind,
      qualifiedName: symbol.qualifiedName,
      shapeHash: symbol.shapeHash,
      shape: symbol.shape,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  writeFileSync(join(process.cwd(), "test/golden", `${item.name}.json`), `${JSON.stringify(symbols, null, 2)}\n`);
}

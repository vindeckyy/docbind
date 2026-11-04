import { describe, expect, it } from "vitest";
import { auditExamples } from "../src/examples.js";
import { parseConfig } from "../src/config.js";
import { tempProject } from "./helpers.js";

describe("example audit", () => {
  it("counts fences and docs with no configured doctest", () => {
    const root = tempProject({
      "docs/a.md": "# A\n\n```python\nprint(1)\n```\n",
      "docs/b.md": "# B\n\n```ts\nconst x = 1;\n```\n",
      "README.md": "# Readme\n",
    });
    const config = parseConfig({ doctests: [{ name: "pytest", command: "python3", args: [], docs: ["docs/a.md"] }] });
    const result = auditExamples(root, config);
    expect(result.fences).toBe(2);
    expect(result.configuredDocs).toEqual(["docs/a.md"]);
    expect(result.unconfiguredDocs).toEqual(["docs/b.md"]);
  });
});

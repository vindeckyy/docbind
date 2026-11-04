import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripAnnotations } from "../src/strip.js";
import { parseConfig } from "../src/config.js";
import { tempProject } from "./helpers.js";

describe("strip annotations", () => {
  it("removes only docbind annotation lines", () => {
    const root = tempProject({
      "docs/api.md": "<!-- docbind: symbol=src/users.ts#getUser -->\n\nCall `getUser(id)`.\n<!-- keep -->\n",
    });
    const preview = stripAnnotations(root, parseConfig({}), false);
    expect(preview).toEqual({ files: ["docs/api.md"], removed: 1 });
    expect(readFileSync(join(root, "docs/api.md"), "utf8")).toContain("docbind: symbol");
    expect(stripAnnotations(root, parseConfig({}), true)).toEqual({ files: ["docs/api.md"], removed: 1 });
    const text = readFileSync(join(root, "docs/api.md"), "utf8");
    expect(text).not.toContain("docbind: symbol");
    expect(text).toContain("<!-- keep -->");
  });
});

import { describe, expect, it } from "vitest";
import { BUILTIN_EXTRACTORS, EXTRACTOR_API_VERSION, filesFor } from "../src/surface/plugins.js";

describe("extractor plugins", () => {
  it("exposes one versioned plugin per extractor", () => {
    expect(EXTRACTOR_API_VERSION).toBe(1);
    expect(new Set(BUILTIN_EXTRACTORS.map((plugin) => plugin.id)).size).toBe(BUILTIN_EXTRACTORS.length);
    for (const plugin of BUILTIN_EXTRACTORS) {
      expect(plugin.apiVersion).toBe(EXTRACTOR_API_VERSION);
      expect(plugin.extensions.length).toBeGreaterThan(0);
      expect(typeof plugin.enabled).toBe("function");
    }
  });

  it("selects files by extension", () => {
    const rust = BUILTIN_EXTRACTORS.find((plugin) => plugin.id === "rust");
    expect(rust && filesFor(rust, ["a.rs", "b.ts", "c.go"])).toEqual(["a.rs"]);
    const typescript = BUILTIN_EXTRACTORS.find((plugin) => plugin.id === "typescript");
    expect(typescript && filesFor(typescript, ["a.ts", "b.java", "c.js"])).toEqual(["a.ts", "c.js"]);
  });
});

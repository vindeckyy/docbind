import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { extractSurface } from "../src/surface/index.js";
import { checkProject } from "../src/check.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { tempProject } from "./helpers.js";

describe("execution gating", () => {
  it("defaults to no project execution", () => {
    expect(DEFAULT_CONFIG.allowExec).toBe(false);
    expect(parseConfig({ languages: { rustdoc: true } }).allowExec).toBe(false);
  });

  it("skips rustdoc cargo runs without allowExec", () => {
    const root = tempProject({ "src/lib.rs": "pub fn get_user() {}\n" });
    const config = parseConfig({ languages: { rustdoc: true } });
    const result = extractSurface(root, ["src/lib.rs"], config);
    expect(result.error).toContain("allow-exec");
    expect(result.symbols.some((symbol) => symbol.id.includes("|rustdoc|"))).toBe(false);
    expect(checkProject(root, config).warnings[0]).toContain("rustdoc skipped");
  });

  it("honors allowExec in config", () => {
    const root = tempProject({ "src/lib.rs": "pub fn get_user() {}\n", "Cargo.toml": "[package]\nname = \"x\"\n" });
    const config = parseConfig({ languages: { rustdoc: true }, allowExec: true });
    expect(config.allowExec).toBe(true);
    expect(root.length).toBeGreaterThan(0);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  configPathFor,
  DEFAULT_CONFIG,
  loadConfig,
  parseConfig,
  writeDefaultConfig,
} from "../src/config.js";
import { emptyProject, tempProject } from "./helpers.js";

describe("config", () => {
  it("returns defaults for an empty object", () => {
    expect(parseConfig({})).toEqual(DEFAULT_CONFIG);
    expect(parseConfig(undefined)).toEqual(DEFAULT_CONFIG);
  });

  it("merges partial config", () => {
    const config = parseConfig({
      docs: ["README.md"],
      exclude: ["x.md"],
      packages: ["packages/*"],
      languages: { python: false },
      severity: { "L1-broken": "warning", "S1-deprecated": "note" },
      maxFindings: 5,
    });
    expect(config.docs).toEqual(["README.md"]);
    expect(config.exclude).toEqual(["x.md"]);
    expect(config.languages).toEqual({ typescript: true, python: false, rust: true, go: false });
    expect(config.severity["L1-broken"]).toBe("warning");
    expect(config.severity["S1-deprecated"]).toBe("note");
    expect(config.maxFindings).toBe(5);
  });

  it("rejects unknown keys and invalid values", () => {
    expect(() => parseConfig({ nope: true })).toThrow();
    expect(() => parseConfig({ severity: { "L1-broken": "loud" } })).toThrow();
    expect(() => parseConfig({ maxFindings: 0 })).toThrow();
    expect(() => parseConfig({ languages: { ruby: true } })).toThrow();
  });

  it("loads missing config as defaults", () => {
    const root = emptyProject();
    expect(loadConfig(root)).toEqual(DEFAULT_CONFIG);
  });

  it("writes and loads config", () => {
    const root = emptyProject();
    const path = writeDefaultConfig(root);
    expect(path).toBe(configPathFor(root));
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(DEFAULT_CONFIG);
    expect(loadConfig(root)).toEqual(DEFAULT_CONFIG);
  });

  it("throws on malformed config and non-ENOENT read errors", () => {
    const root = tempProject({ "docbind.json": "{ nope" });
    expect(() => loadConfig(root)).toThrow();
    const directory = tempProject({ "docbind.json/x": "x" });
    expect(() => loadConfig(directory)).toThrow();
  });
});

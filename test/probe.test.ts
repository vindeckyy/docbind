import { describe, expect, it } from "vitest";
import { dockerArgs, runProbes } from "../src/probe.js";
import { parseConfig } from "../src/config.js";
import { tempProject } from "./helpers.js";

const probes = [
  { name: "response", image: "python:3.12-alpine", command: "python3", args: ["-c", "print(1)"], docs: ["docs/api.md"] },
];

describe("sandboxed probes", () => {
  it("builds a read-only, network-less docker invocation", () => {
    const args = dockerArgs("/repo", probes[0]!);
    expect(args).toContain("--network");
    expect(args).toContain("none");
    expect(args).toContain("--read-only");
    expect(args).toContain("/repo:/workspace:ro");
    expect(args).toContain("65534:65534");
  });

  it("turns probe failures into findings", () => {
    const root = tempProject({ "README.md": "# Docs\n" });
    const config = parseConfig({ probes });
    const failed = runProbes(root, config, () => ({ status: 2, stdout: "", stderr: "boom" }));
    expect(failed[0]).toMatchObject({ rule: "D2-probe", severity: "error", doc: { path: "docs/api.md" } });
    expect(failed[0]?.message).toContain("exit 2");
    expect(failed[0]?.message).toContain("boom");
    expect(runProbes(root, config, () => ({ status: 0, stdout: "", stderr: "" }))).toEqual([]);
    const spawnError = runProbes(root, config, () => ({ status: null, stdout: "", stderr: "", error: "docker not found" }));
    expect(spawnError[0]?.message).toContain("docker not found");
    expect(runProbes(root, parseConfig({ probes, severity: { "D2-probe": "off" } }), () => ({ status: 1, stdout: "", stderr: "" }))).toEqual([]);
    const noDocs = runProbes(
      root,
      parseConfig({ probes: [{ name: "plain", image: "alpine", command: "true", args: [] }] }),
      () => ({ status: 7, stdout: "", stderr: "" }),
    );
    expect(noDocs[0]?.doc.path).toBe("README.md");
    expect(noDocs[0]?.message).toContain("exit 7");
  });
});

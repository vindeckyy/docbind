import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { changedFiles } from "../src/git.js";
import { tempProject } from "./helpers.js";

function git(root: string, args: string[]): void {
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
    cwd: root,
    stdio: "ignore",
  });
}

describe("git changes", () => {
  it("returns an empty set outside a repository", () => {
    const root = tempProject({ "a.md": "x" });
    expect(changedFiles(root, "HEAD~1").size).toBe(0);
  });

  it("lists committed and working-tree changes", () => {
    const root = tempProject({ "a.md": "a", "b.md": "b" });
    git(root, ["init"]);
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "one"]);
    writeFileSync(join(root, "a.md"), "changed");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "two"]);
    writeFileSync(join(root, "b.md"), "working");
    const files = changedFiles(root, "HEAD~1");
    expect(files.has("a.md")).toBe(true);
    expect(files.has("b.md")).toBe(true);
  });
});

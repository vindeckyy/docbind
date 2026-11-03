import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cli, tempProject } from "./helpers.js";

const code = (name = "getUser"): string =>
  `export interface User { id: string }\nexport function ${name}(id: string): User { return { id }; }\nexport class Client { request(path: string): Promise<User> { return Promise.resolve({ id: path }); } }\n`;

function project(doc = "# API\n\nCall `getUser(id)`.\n"): string {
  return tempProject({
    "package.json": JSON.stringify({ name: "app" }),
    "src/users.ts": code(),
    "docs/api.md": doc,
  });
}

async function lock(root: string): Promise<void> {
  const result = await cli(["lock"], root);
  expect(result.code).toBe(0);
}

describe("CLI basics", () => {
  it("prints version and help", async () => {
    const root = tempProject({});
    expect((await cli(["--version"], root)).stdout).toBe("0.1.8");
    expect((await cli(["--help"], root)).code).toBe(0);
    expect((await cli([], root)).code).toBe(2);
    expect((await cli(["check", "--help"], root)).code).toBe(0);
    expect((await cli(["nope"], root)).code).toBe(2);
    expect((await cli(["--bad"], root)).code).toBe(2);
  });

  it("uses process streams by default", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect(await runCli(["--version"])).toBe(0);
    expect(await runCli(["nope"])).toBe(2);
    stdout.mockRestore();
    stderr.mockRestore();
  });

  it("initializes config and lock once", async () => {
    const root = tempProject({});
    const first = await cli(["init"], root);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain("wrote docbind.json");
    expect(existsSync(join(root, "docbind.lock.json"))).toBe(true);
    const second = await cli(["init"], root);
    expect(second.stdout).toContain("already exists");
    expect(second.stdout).toContain("docbind.lock.json already exists");
  });
});

describe("CLI check", () => {
  it("reports clean repos and output formats", async () => {
    const root = project();
    const clean = await cli(["check"], root);
    expect(clean.code).toBe(0);
    expect(clean.stdout).toContain("0 errors");
    const json = await cli(["check", "--json"], root);
    expect(JSON.parse(json.stdout).findings).toEqual([]);
    const github = await cli(["check", "--github"], root);
    expect(github.stdout).toContain("No stale documentation found.");
  });

  it("reports findings in human, JSON, GitHub and SARIF formats", async () => {
    const root = project();
    await lock(root);
    writeFileSync(join(root, "src/users.ts"), code("get_user"));
    const human = await cli(["check"], root);
    expect(human.code).toBe(1);
    expect(human.stdout).toContain("getUser was renamed");
    const json = await cli(["check", "--json"], root);
    expect(JSON.parse(json.stdout).findings[0].rule).toBe("L4-renamed");
    const github = await cli(["check", "--github"], root);
    expect(github.stdout).toContain("::error");
    const sarif = await cli(["check", "--sarif", "out.sarif"], root);
    expect(sarif.code).toBe(1);
    expect(JSON.parse(readFileSync(join(root, "out.sarif"), "utf8")).version).toBe("2.1.0");
  });

  it("honors severity, strict, all and maxFindings", async () => {
    const root = tempProject({
      "docbind.json": JSON.stringify({ severity: { "L4-renamed": "note" }, maxFindings: 1 }),
      "package.json": JSON.stringify({ name: "app" }),
      "src/users.ts": code(),
      "docs/api.md": "`getUser(id)` and `users.getUser(id)`.\n",
    });
    await lock(root);
    writeFileSync(join(root, "src/users.ts"), code("get_user"));
    const noted = await cli(["check"], root);
    expect(noted.code).toBe(0);
    expect(noted.stdout).not.toContain("note");
    const all = await cli(["check", "--all", "--strict"], root);
    expect(all.code).toBe(1);
    expect(all.stdout).toContain("note");
    expect(all.stderr).toContain("hidden by maxFindings=1");
  });

  it("keeps warnings non-fatal unless strict", async () => {
    const root = tempProject({
      "docbind.json": JSON.stringify({ severity: { "L4-renamed": "warning" } }),
      "package.json": JSON.stringify({ name: "app" }),
      "src/users.ts": code(),
      "docs/api.md": "`getUser(id)`\n",
    });
    await lock(root);
    writeFileSync(join(root, "src/users.ts"), code("get_user"));
    expect((await cli(["check"], root)).code).toBe(0);
    expect((await cli(["check", "--strict"], root)).code).toBe(1);
  });

  it("reports invalid config", async () => {
    const root = tempProject({ "docbind.json": "{", "package.json": "{}" });
    const result = await cli(["check"], root);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("error:");
  });

  it("does not hide findings when git is unavailable", async () => {
    const root = project();
    await lock(root);
    writeFileSync(join(root, "src/users.ts"), code("get_user"));
    const result = await cli(["check", "--changed-only"], root);
    expect(result.code).toBe(1);
  });

  it("filters changed docs only", async () => {
    const root = project();
    const git = (args: string[]): void => {
      execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
        cwd: root,
        stdio: "ignore",
      });
    };
    git(["init"]);
    git(["add", "."]);
    git(["commit", "-m", "baseline"]);
    await lock(root);
    git(["add", "docbind.lock.json"]);
    git(["commit", "-m", "lock"]);
    writeFileSync(join(root, "src/users.ts"), code("get_user"));
    const filtered = await cli(["check", "--changed-only", "--base", "HEAD"], root);
    expect(filtered.code).toBe(0);
    writeFileSync(join(root, "docs/api.md"), "# API\n\nCall `getUser(id)` now.\n");
    const changed = await cli(["check", "--changed-only", "--base", "HEAD"], root);
    expect(changed.code).toBe(1);
  });
});

describe("CLI lock", () => {
  it("writes, checks and refreshes a lock", async () => {
    const root = project();
    await lock(root);
    expect((await cli(["lock", "--check"], root)).code).toBe(0);
    expect(await cli(["lock", "--refresh"], root)).toMatchObject({ code: 0 });
    rmSync(join(root, "docbind.lock.json"));
    expect((await cli(["lock", "--check"], root)).code).toBe(3);
    await lock(root);
    writeFileSync(join(root, "src/users.ts"), code("get_user"));
    expect((await cli(["lock", "--check"], root)).code).toBe(3);
  });
});

describe("CLI fix", () => {
  it("prints a dry run and then writes fixes", async () => {
    const root = project();
    await lock(root);
    writeFileSync(join(root, "src/users.ts"), code("get_user"));
    const dry = await cli(["fix"], root);
    expect(dry.code).toBe(1);
    expect(dry.stdout).toContain("getUser -> get_user");
    expect(readFileSync(join(root, "docs/api.md"), "utf8")).toContain("`getUser");
    const written = await cli(["fix", "--write"], root);
    expect(written.code).toBe(0);
    expect(readFileSync(join(root, "docs/api.md"), "utf8")).toContain("`get_user");
    expect((await cli(["check"], root)).code).toBe(0);
  });

  it("reports when there is nothing to fix", async () => {
    const root = project();
    const result = await cli(["fix", "--write"], root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("0 fixable findings");
  });
});

describe("CLI explain and stats", () => {
  it("explains an anchor and rejects bad locations", async () => {
    const root = project();
    const result = await cli(["explain", "docs/api.md:3"], root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("bound:");
    expect((await cli(["explain"], root)).code).toBe(2);
    expect((await cli(["explain", "bad"], root)).code).toBe(2);
  });

  it("prints stats", async () => {
    const root = project();
    const result = await cli(["stats"], root);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).symbols).toBeGreaterThan(0);
  });
});

import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    expect((await cli(["--version"], root)).stdout).toBe("0.2.6");
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

  it("init produces a config and a green run", async () => {
    const root = tempProject({ "README.md": "# Empty\n" });
    expect((await cli(["init"], root)).code).toBe(0);
    expect(readFileSync(join(root, "docbind.json"), "utf8")).toContain('"lock": true');
    const run = await cli(["check"], root);
    expect(run.code).toBe(0);
  });

  it("reports binding coverage and unbound tokens", async () => {
    const root = project("Call `getUser(id)` and `ghost()` in prose.\n");
    const audit = await cli(["audit", "--json", "--unbound"], root);
    expect(audit.code).toBe(0);
    const parsed = JSON.parse(audit.stdout) as {
      anchors: number;
      bound: number;
      unbound: number;
      coverage: number;
      tokens: Array<{ token: string; reason: string }>;
    };
    expect(parsed.anchors).toBe(2);
    expect(parsed.bound).toBe(1);
    expect(parsed.unbound).toBe(1);
    expect(parsed.coverage).toBe(0.5);
    expect(parsed.tokens.map((token) => token.token)).toContain("ghost()");
    const text = await cli(["audit", "--unbound"], root);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain("binding coverage: 1/2");
    expect(text.stdout).toContain("ghost()");
  });

  it("proposes and writes explicit annotations", async () => {
    const root = project("Call `getUser(id)` in prose.\n");
    const proposed = await cli(["adopt", "--json"], root);
    expect(proposed.code).toBe(0);
    const suggestions = JSON.parse(proposed.stdout) as Array<{ annotation: string; token: string }>;
    expect(suggestions[0]?.token).toBe("getUser(id)");
    expect(suggestions[0]?.annotation).toContain("src/users.ts#getUser");
    expect((await cli(["adopt", "--write"], root)).code).toBe(0);
    const doc = readFileSync(join(root, "docs/api.md"), "utf8");
    expect(doc).toContain("<!-- docbind: symbol=src/users.ts#getUser -->");
    expect((await cli(["adopt", "--json", "--write"], root)).code).toBe(0);
    const second = await cli(["adopt", "--json"], root);
    expect(JSON.parse(second.stdout)).toEqual([]);
  });

  it("adopts inline contracts for no-lock checks", async () => {
    const root = project("Call `getUser(id)` in prose.\n");
    expect((await cli(["adopt", "--write", "--contract"], root)).code).toBe(0);
    const doc = readFileSync(join(root, "docs/api.md"), "utf8");
    expect(doc).toMatch(/contract=[0-9a-f]{12}/u);
    expect((await cli(["check", "--no-lock"], root)).code).toBe(0);
  });

  it("fails strict mode on changed abstentions", async () => {
    const root = project("Call `getUser(id)` and `ghost()` in prose.\n");
    expect((await cli(["check"], root)).code).toBe(0);
    expect((await cli(["check", "--mode", "strict"], root)).code).toBe(1);
    expect((await cli(["check", "--mode", "gate"], root)).code).toBe(0);
  });

  it("requires allowExec and configured probes", async () => {
    const root = tempProject({ "README.md": "# Docs\n" });
    expect((await cli(["probe"], root)).code).toBe(2);
    const configured = tempProject({
      "README.md": "# Docs\n",
      "docbind.json": JSON.stringify({ probes: [{ name: "p", image: "alpine", command: "true", args: [] }] }),
    });
    expect((await cli(["probe"], configured)).code).toBe(2);
  });

  it("maps docker probe failures through the CLI", async () => {
    const root = tempProject({
      "README.md": "# Docs\n",
      "docbind.json": JSON.stringify({ probes: [{ name: "p", image: "alpine", command: "true", args: [] }] }),
      "bin/docker": "#!/bin/sh\nexit 1\n",
    });
    chmodSync(join(root, "bin/docker"), 0o755);
    const previous = process.env.PATH;
    process.env.PATH = `${join(root, "bin")}:${previous ?? ""}`;
    try {
      const text = await cli(["probe", "--allow-exec"], root);
      expect(text.code).toBe(1);
      expect(text.stdout).toContain("1 probe finding");
      const json = await cli(["probe", "--allow-exec", "--json"], root);
      expect(json.code).toBe(1);
      expect(JSON.parse(json.stdout)[0].rule).toBe("D2-probe");
      writeFileSync(join(root, "bin/docker"), "#!/bin/sh\nexit 0\n");
      chmodSync(join(root, "bin/docker"), 0o755);
      const ok = await cli(["probe", "--allow-exec"], root);
      expect(ok.code).toBe(0);
      expect(ok.stdout).toContain("0 probe findings");
      expect((await cli(["probe", "--allow-exec", "--json"], root)).stdout.trim()).toBe("[]");
    } finally {
      process.env.PATH = previous;
    }
  });

  it("runs configured doctests only with allowExec", async () => {
    const root = tempProject({
      "README.md": "# Docs\n",
      "docbind.json": JSON.stringify({
        doctests: [{ name: "bad", command: process.execPath, args: ["-e", "process.exit(1)"], docs: ["README.md"] }],
      }),
    });
    expect((await cli(["doctest"], root)).code).toBe(2);
    const failed = await cli(["doctest", "--allow-exec", "--json"], root);
    expect(failed.code).toBe(1);
    const findings = JSON.parse(failed.stdout) as Array<{ rule: string; severity: string }>;
    expect(findings[0]?.rule).toBe("D1-doctest");
    expect(findings[0]?.severity).toBe("error");
    const text = await cli(["doctest", "--allow-exec"], root);
    expect(text.code).toBe(1);
    expect(text.stdout).toContain("1 doctest finding");
    const none = await cli(["doctest", "--allow-exec"], tempProject({ "README.md": "# Docs\n" }));
    expect(none.code).toBe(2);
    const ok = await cli(
      ["doctest", "--allow-exec"],
      tempProject({
        "README.md": "# Docs\n",
        "docbind.json": JSON.stringify({ doctests: [{ name: "ok", command: process.execPath, args: ["-e", ""] }] }),
      }),
    );
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain("0 doctest findings");
  });

  it("binds through an LSIF index", async () => {
    const root = project("<!-- docbind: symbol=src/extra.ts#indexedUser -->\n\nCall `indexedUser(id)`.\n");
    writeFileSync(join(root, "src/extra.ts"), "export const other = 1;\n");
    const index = join(root, "indexed.lsif");
    writeFileSync(
      index,
      [
        '{"type":"vertex","label":"document","id":1,"uri":"src/extra.ts"}',
        '{"type":"vertex","label":"range","id":2,"start":{"line":0,"character":13},"end":{"line":0,"character":24}}',
        '{"type":"edge","label":"contains","outV":1,"inV":2}',
        '{"type":"vertex","label":"moniker","id":3,"kind":"export","scheme":"tsc","identifier":"app.src.extra.indexedUser"}',
        '{"type":"edge","label":"next","outV":2,"inV":3}',
      ].join("\n"),
    );
    expect((await cli(["check"], root)).code).toBe(1);
    const indexed = await cli(["check", "--index", index], root);
    expect(indexed.code).toBe(0);
  });

  it("migrates legacy locks and reports them", async () => {
    const root = project();
    writeFileSync(
      join(root, "docbind.lock.json"),
      JSON.stringify({ engine: "0.1.0", generation: 0, anchors: [], tombstones: [] }),
    );
    const needs = await cli(["migrate", "--check"], root);
    expect(needs.code).toBe(3);
    expect(needs.stdout).toContain("lock needs migration");
    expect((await cli(["migrate"], root)).code).toBe(0);
    expect((await cli(["migrate", "--check"], root)).code).toBe(0);
    expect((await cli(["migrate", "--json"], root)).stdout).toContain('"changed": false');
  });

  it("requires lock changes to be coupled to doc edits", async () => {
    const root = project();
    await lock(root);
    const git = (args: string[]): void => {
      execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
        cwd: root,
        stdio: "ignore",
      });
    };
    git(["init"]);
    git(["add", "."]);
    git(["commit", "-m", "one"]);
    writeFileSync(join(root, "src/users.ts"), code("fetchUser"));
    const text = await cli(["lock", "--review"], root);
    expect(text.code).toBe(3);
    expect(text.stdout).toContain("docs/api.md:3 getUser");
    const uncoupled = await cli(["lock", "--review", "--json"], root);
    expect(uncoupled.code).toBe(3);
    expect(JSON.parse(uncoupled.stdout).uncoupled[0].docPath).toBe("docs/api.md");
    writeFileSync(join(root, "docs/api.md"), "# API\n\nCall `fetchUser(id)`.\n");
    expect((await cli(["lock", "--review"], root)).code).toBe(0);
  });

  it("renders semantic lock diffs", async () => {
    const root = project();
    expect((await cli(["lock"], root)).code).toBe(0);
    writeFileSync(
      join(root, "src/users.ts"),
      "export interface User { id: string }\nexport function getUser(id: number): User { return { id: String(id) }; }\nexport class Client { request(path: string): Promise<User> { return Promise.resolve({ id: path }); } }\n",
    );
    const changed = await cli(["lock", "--diff"], root);
    expect(changed.code).toBe(0);
    expect(changed.stdout).toContain("contract changed");
    expect(changed.stdout).toContain("getUser");
    const json = await cli(["lock", "--diff", "--json"], root);
    expect(JSON.parse(json.stdout).changed).toHaveLength(1);
    writeFileSync(join(root, "docs/api.md"), "# API\n\nNo anchors.\n");
    const removed = await cli(["lock", "--diff"], root);
    expect(removed.stdout).toContain("no longer bound");
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

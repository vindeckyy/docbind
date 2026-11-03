import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig, writeDefaultConfig } from "./config.js";
import { checkProject, markLockAdvanced } from "./check.js";
import { emptyLock, lockContentEqual, lockPath, readLock } from "./lock/schema.js";
import { writeLock } from "./lock/write.js";
import { applyFixes } from "./fix.js";
import { changedFiles } from "./git.js";
import { explain } from "./explain.js";
import { formatHuman } from "./report/human.js";
import { formatJson } from "./report/json.js";
import { formatSarif } from "./report/sarif.js";
import { formatGithub } from "./report/github.js";
import { ENGINE_VERSION } from "./version.js";
import type { Finding } from "./types.js";

export interface CliIO {
  cwd: string;
  stdout: (value: string) => void;
  stderr: (value: string) => void;
}

const HELP = `docbind ${ENGINE_VERSION}

Usage:
  docbind init
  docbind check [--json] [--sarif <file>] [--github] [--all] [--strict] [--changed-only] [--base <rev>]
  docbind lock [--check] [--refresh]
  docbind fix [--write]
  docbind explain <doc>:<line>[:<column>]
  docbind stats

Commands:
  init      Write docbind.json and an empty lock
  check     Report stale symbol references (read-only)
  lock      Rebuild docbind.lock.json
  fix       Rewrite safe renames and moved paths
  explain   Show why a token did or did not bind
  stats     Print scan statistics`;

function failure(io: CliIO, message: string): number {
  io.stderr(message);
  return 2;
}

function findingsExit(findings: Finding[], strict: boolean): number {
  if (findings.some((finding) => finding.severity === "error")) return 1;
  if (strict && findings.length > 0) return 1;
  return 0;
}

function printFindings(
  findings: Finding[],
  result: ReturnType<typeof checkProject>,
  io: CliIO,
  options: { json?: boolean; github?: boolean; all?: boolean; sarif?: string; cwd: string },
): void {
  if (options.sarif) {
    writeFileSync(join(options.cwd, options.sarif), formatSarif(findings), "utf8");
  }
  if (options.json) {
    io.stdout(formatJson(findings));
  } else if (options.github) {
    const text = formatGithub(findings);
    io.stdout(text.length > 0 ? text : "No stale documentation found.");
  } else {
    io.stdout(formatHuman({ ...result, findings }, { all: options.all }));
  }
}

export async function runCli(argv: string[], partialIO: Partial<CliIO> = {}): Promise<number> {
  const io: CliIO = {
    cwd: partialIO.cwd ?? process.cwd(),
    stdout: partialIO.stdout ?? ((value: string) => process.stdout.write(`${value}\n`)),
    stderr: partialIO.stderr ?? ((value: string) => process.stderr.write(`${value}\n`)),
  };

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        json: { type: "boolean" },
        sarif: { type: "string" },
        github: { type: "boolean" },
        all: { type: "boolean" },
        strict: { type: "boolean" },
        "changed-only": { type: "boolean" },
        base: { type: "string" },
        check: { type: "boolean" },
        refresh: { type: "boolean" },
        write: { type: "boolean" },
      },
    });
  } catch (error) {
    return failure(io, `error: ${(error as Error).message}`);
  }

  const values = parsed.values;
  const command = parsed.positionals[0];
  const option = (name: string): boolean => values[name] === true;
  const stringOption = (name: string): string | undefined =>
    typeof values[name] === "string" ? values[name] : undefined;

  if (option("version")) {
    io.stdout(ENGINE_VERSION);
    return 0;
  }
  if (option("help")) {
    io.stdout(HELP);
    return 0;
  }
  if (command === undefined) {
    io.stdout(HELP);
    return 2;
  }

  try {
    if (command === "init") {
      const root = io.cwd;
      if (!existsSync(join(root, "docbind.json"))) {
        writeDefaultConfig(root);
        io.stdout("wrote docbind.json");
      } else {
        io.stdout("docbind.json already exists");
      }
      if (!existsSync(lockPath(root))) {
        writeLock(root, emptyLock());
        io.stdout("wrote docbind.lock.json");
      } else {
        io.stdout("docbind.lock.json already exists");
      }
      return 0;
    }

    const config = loadConfig(io.cwd);

    if (command === "check") {
      const result = checkProject(io.cwd, config);
      let findings = result.findings;
      if (option("changed-only")) {
        const changed = changedFiles(io.cwd, stringOption("base") ?? "origin/HEAD");
        if (changed.size > 0) {
          findings = findings.filter((finding) => changed.has(finding.doc.path));
        }
      }
      const limited = findings.slice(0, config.maxFindings);
      if (findings.length > limited.length) {
        io.stderr(`note: ${findings.length - limited.length} findings hidden by maxFindings=${config.maxFindings}`);
      }
      printFindings(limited, result, io, {
        json: option("json"),
        github: option("github"),
        all: option("all"),
        sarif: stringOption("sarif"),
        cwd: io.cwd,
      });
      return findingsExit(findings, option("strict"));
    }

    if (command === "lock") {
      const result = checkProject(io.cwd, config, { ignoreBaseline: option("refresh") });
      const expected = markLockAdvanced({ ...result.lock, engine: ENGINE_VERSION });
      if (option("check")) {
        if (!existsSync(lockPath(io.cwd))) {
          io.stderr("lock is missing");
          return 3;
        }
        const current = readLock(io.cwd);
        if (lockContentEqual(current, expected)) {
          io.stdout("lock is up to date");
          return 0;
        }
        io.stderr("lock is out of date");
        return 3;
      }
      writeLock(io.cwd, expected);
      io.stdout(`wrote ${expected.anchors.length} anchors, ${expected.tombstones.length} tombstones`);
      return 0;
    }

    if (command === "fix") {
      let result = checkProject(io.cwd, config);
      const fixable = result.findings.filter((finding) => finding.fix);
      if (!option("write")) {
        for (const finding of fixable) {
          io.stdout(`${finding.doc.path}:${finding.doc.line} ${finding.fix?.from} -> ${finding.fix?.to}`);
        }
        io.stdout(`${fixable.length} fixable findings; pass --write to apply`);
        printFindings(result.findings, result, io, { all: option("all"), cwd: io.cwd });
        return findingsExit(result.findings, option("strict"));
      }
      io.stdout(`${fixable.length} fixable findings`);
      const applied = applyFixes(io.cwd, fixable);
      result = checkProject(io.cwd, config);
      writeLock(io.cwd, markLockAdvanced({ ...result.lock, engine: ENGINE_VERSION }));
      for (const file of applied.changedFiles) io.stdout(`fixed ${file}`);
      for (const skip of applied.skipped) {
        io.stderr(`skipped ${skip.finding.doc.path}:${skip.finding.doc.line}: ${skip.reason}`);
      }
      printFindings(result.findings, result, io, { all: option("all"), cwd: io.cwd });
      return findingsExit(result.findings, option("strict"));
    }

    if (command === "explain") {
      const target = parsed.positionals[1];
      if (!target) return failure(io, "error: explain requires <doc>:<line>[:<column>]");
      const match = /^(.*):(\d+)(?::(\d+))?$/u.exec(target);
      if (!match?.[1] || !match[2]) return failure(io, `error: invalid location ${target}`);
      io.stdout(
        explain(io.cwd, config, {
          docPath: match[1],
          line: Number(match[2]),
          ...(match[3] ? { column: Number(match[3]) } : {}),
        }),
      );
      return 0;
    }

    if (command === "stats") {
      const result = checkProject(io.cwd, config);
      io.stdout(JSON.stringify(result.stats, null, 2));
      return 0;
    }

    return failure(io, `error: unknown command ${command}`);
  } catch (error) {
    return failure(io, `error: ${(error as Error).message}`);
  }
}

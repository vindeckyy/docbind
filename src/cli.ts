import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig, writeDefaultConfig } from "./config.js";
import { checkProject, markLockAdvanced } from "./check.js";
import { emptyLock, lockContentEqual, lockPath, readLock, serializeLock } from "./lock/schema.js";
import { writeLock } from "./lock/write.js";
import { applyFixes } from "./fix.js";
import { changedFiles, changedLines } from "./git.js";
import { explain } from "./explain.js";
import { applyAnnotations, suggestAnnotations } from "./adopt.js";
import { describeLockDiff, diffLock } from "./lock/diff.js";
import { migrateLock } from "./lock/migrate.js";
import { runDoctests } from "./doctest.js";
import { runProbes } from "./probe.js";
import { stripAnnotations } from "./strip.js";
import { auditExamples } from "./examples.js";
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
  docbind check [--json] [--sarif <file>] [--github] [--all] [--strict] [--unbound] [--index <lsif>] [--mode gate|strict] [--no-lock] [--allow-exec] [--no-cache] [--changed-only] [--base <rev>]
  docbind lock [--check] [--diff] [--review] [--refresh]\ndocbind migrate [--check] [--json]
  docbind fix [--write]
  docbind explain <doc>:<line>[:<column>]
  docbind adopt [--write] [--json] [--contract]
  docbind audit [--unbound] [--adopted] [--examples] [--json]
  docbind doctest [--json]
  docbind probe [--json]
  docbind strip [--write] [--json]
  docbind stats

Commands:
  init      Write docbind.json and an empty lock
  check     Report stale symbol references (read-only)
  lock      Rebuild docbind.lock.json
  fix       Rewrite safe renames and moved paths
  explain   Show why a token did or did not bind
  migrate   Upgrade the lock file to the current format
  adopt     Propose explicit annotations for inferred bindings
  audit     Report binding coverage and unbound tokens
  doctest   Run configured doctest commands and report failures
  probe     Run configured commands in a Docker sandbox
  strip     Remove docbind annotation comments from docs
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

const HEDGE = /\b(?:roughly|typically|may|might|could|possibly|usually|generally|approximately|about|such as|for example|e\.g\.)\b/iu;

function strictEligible(cwd: string, anchor: { docPath: string; line: number }, cache: Map<string, string[]>): boolean {
  let lines = cache.get(anchor.docPath);
  if (!lines) {
    try {
      lines = readFileSync(join(cwd, anchor.docPath), "utf8").split(/\r?\n/u);
    } catch {
      lines = [];
    }
    cache.set(anchor.docPath, lines);
  }
  const text = lines[anchor.line - 1] ?? "";
  return !HEDGE.test(text);
}

function hasHumanAnnotation(root: string, docPath: string, line: number | undefined): boolean {
  if (line === undefined) return false;
  let lines: string[];
  try {
    lines = readFileSync(join(root, docPath), "utf8").split(/\r?\n/u);
  } catch {
    return false;
  }
  for (let index = Math.max(0, line - 6); index < line; index += 1) {
    const text = lines[index] ?? "";
    if (/docbind:\s*symbol=/u.test(text) && !/\badopted\b/u.test(text)) return true;
  }
  return false;
}

function coverageGate(
  result: ReturnType<typeof checkProject>,
  config: ReturnType<typeof loadConfig>,
  io: CliIO,
  options: { required?: number; ratchet: boolean; write: boolean },
): number {
  const coverage = result.coverage.annotationCoverage;
  const required = Math.max(options.required ?? 0, config.minCoverage);
  const path = join(io.cwd, ".docbind-coverage.json");
  const ratchet = options.ratchet || existsSync(path);
  let baseline: number | undefined;
  if (ratchet) {
    try {
      baseline = (JSON.parse(readFileSync(path, "utf8")) as { coverage?: number }).coverage;
    } catch {
      baseline = undefined;
    }
  }
  if (options.write) {
    writeFileSync(path, `${JSON.stringify({
      coverage,
      verifiedExplicit: result.coverage.verifiedExplicit,
      anchors: result.stats.anchors,
    }, null, 2)}\n`, "utf8");
  }
  if (required > 0 && coverage + 1e-9 < required) {
    io.stderr(`coverage: verified annotation coverage ${(coverage * 100).toFixed(1)}% is below required ${(required * 100).toFixed(1)}%`);
    return 3;
  }
  if (ratchet) {
    if (baseline === undefined) {
      io.stderr("coverage: no .docbind-coverage.json baseline; run check --write-coverage first");
      return 3;
    }
    if (coverage + 1e-9 < baseline) {
      io.stderr(`coverage: verified annotation coverage regressed from ${(baseline * 100).toFixed(1)}% to ${(coverage * 100).toFixed(1)}%`);
      return 3;
    }
  }
  return 0;
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
        unbound: { type: "boolean" },
        mode: { type: "string" },
        "no-lock": { type: "boolean" },
        "allow-exec": { type: "boolean" },
        "no-cache": { type: "boolean" },
        index: { type: "string", multiple: true },
        review: { type: "boolean" },
        "require-index": { type: "boolean" },
        "require-coverage": { type: "string" },
        "coverage-ratchet": { type: "boolean" },
        "no-coverage-ratchet": { type: "boolean" },
        "require-contracts": { type: "boolean" },
        "allow-binding-only": { type: "boolean" },
        "no-coverage-gate": { type: "boolean" },
        "write-coverage": { type: "boolean" },
        "allow-probes": { type: "boolean" },
        adopted: { type: "boolean" },
        examples: { type: "boolean" },
        contract: { type: "boolean" },
        diff: { type: "boolean" },
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
    if (option("no-lock")) config.lock = false;
    if (option("allow-exec")) config.allowExec = true;
    if (option("no-cache")) config.cache = false;
    if (option("require-index")) config.requireIndex = true;
    if (option("no-coverage-gate")) config.minCoverage = 0;
    if (option("allow-binding-only")) config.requireContracts = false;
    if (Array.isArray(values.index)) {
      config.indexes = [...config.indexes, ...values.index.filter((value): value is string => typeof value === "string")];
    }

    if (command === "check") {
      const result = checkProject(io.cwd, config);
      for (const warning of result.warnings) io.stderr(`warning: ${warning}`);
      let findings = result.findings;
      if (option("unbound")) {
        findings = [
          ...findings,
          ...result.unbound.map((entry): Finding => ({
            id: `unbound-${entry.anchor.docPath}-${entry.anchor.line}-${entry.anchor.column}`,
            rule: "L1-broken",
            severity: "note",
            doc: {
              path: entry.anchor.docPath,
              line: entry.anchor.line,
              column: entry.anchor.column,
              length: entry.anchor.length,
            },
            message: `unbound token: ${entry.anchor.token} (${entry.reason})`,
          })),
        ];
      }
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
      if (stringOption("mode") === "strict") {
        const base = stringOption("base") ?? "origin/HEAD";
        const lines = changedLines(io.cwd, base);
        const files = changedFiles(io.cwd, base);
        const lineCache = new Map<string, string[]>();
        const strictUnbound = result.unbound.filter((entry) => {
          const changed =
            lines.size === 0 && files.size === 0
              ? true
              : (() => {
                  const changedLines = lines.get(entry.anchor.docPath);
                  if (changedLines) return changedLines.has(entry.anchor.line);
                  return files.has(entry.anchor.docPath);
                })();
          return changed && strictEligible(io.cwd, entry.anchor, lineCache);
        });
        if (strictUnbound.length > 0) {
          io.stderr(`strict: ${strictUnbound.length} unbound token${strictUnbound.length === 1 ? "" : "s"} on changed lines`);
          return 1;
        }
      }
      const exit = findingsExit(findings, option("strict"));
      if (exit !== 0) return exit;
      if ((config.requireContracts || option("require-contracts")) && result.coverage.indexOnly > 0) {
        io.stderr(`contracts: ${result.coverage.indexOnly} bound anchors use binding-only index symbols; native extractors or explicit contracts are required`);
        return 3;
      }
      const required = stringOption("require-coverage");
      const requiredValue = required === undefined ? undefined : Number(required);
      if (requiredValue !== undefined && (!Number.isFinite(requiredValue) || requiredValue < 0 || requiredValue > 1)) {
        io.stderr("error: --require-coverage must be a number between 0 and 1");
        return 2;
      }
      return coverageGate(result, config, io, {
        ...(requiredValue !== undefined ? { required: requiredValue } : {}),
        ratchet: option("coverage-ratchet") && !option("no-coverage-ratchet"),
        write: option("write-coverage"),
      });
    }

    if (command === "migrate") {
      if (!existsSync(lockPath(io.cwd))) {
        io.stderr("error: docbind.lock.json not found");
        return 2;
      }
      const text = readFileSync(lockPath(io.cwd), "utf8");
      let migrated: ReturnType<typeof migrateLock>;
      try {
        migrated = migrateLock(JSON.parse(text));
      } catch (error) {
        io.stderr(`error: ${(error as Error).message}`);
        return 3;
      }
      if (option("check")) {
        if (option("json")) io.stdout(JSON.stringify({ changed: migrated.changed, actions: migrated.actions }, null, 2));
        else io.stdout(migrated.changed ? `lock needs migration: ${migrated.actions.join(", ")}` : "lock is current");
        return migrated.changed ? 3 : 0;
      }
      if (migrated.changed) {
        writeFileSync(lockPath(io.cwd), serializeLock(migrated.lock), "utf8");
      }
      if (option("json")) io.stdout(JSON.stringify({ changed: migrated.changed, actions: migrated.actions }, null, 2));
      else io.stdout(migrated.changed ? `migrated lock: ${migrated.actions.join(", ")}` : "lock is current");
      return 0;
    }

    if (command === "lock") {
      const result = checkProject(io.cwd, config, {
        ignoreBaseline: option("refresh") || option("diff") || option("review"),
      });
      const expected = markLockAdvanced({ ...result.lock, engine: ENGINE_VERSION });
      if (option("review")) {
        const current = readLock(io.cwd);
        const diff = diffLock(current, expected);
        const base = stringOption("base") ?? "origin/HEAD";
        const lines = changedLines(io.cwd, base);
        const files = changedFiles(io.cwd, base);
        const changes = [
          ...diff.added,
          ...diff.removed,
          ...diff.changed.map((change) => change.after),
        ];
        const uncoupled = changes.filter((entry) => {
          if (!hasHumanAnnotation(io.cwd, entry.docPath, entry.line)) return true;
          const changed = lines.get(entry.docPath);
          if (changed && entry.line !== undefined) return !changed.has(entry.line);
          return !files.has(entry.docPath);
        });
        const report = {
          coupled: changes.length - uncoupled.length,
          uncoupled: uncoupled.map((entry) => ({
            docPath: entry.docPath,
            line: entry.line,
            token: entry.token,
            symbol: entry.qualifiedName,
          })),
        };
        if (option("json")) io.stdout(JSON.stringify(report, null, 2));
        else if (report.uncoupled.length === 0) io.stdout(`lock changes coupled to doc edits: ${report.coupled}`);
        else for (const entry of report.uncoupled) {
          io.stdout(`${entry.docPath}:${entry.line ?? "?"} ${entry.token} (${entry.symbol})`);
        }
        return report.uncoupled.length === 0 ? 0 : 3;
      }
      if (option("diff")) {
        const current = readLock(io.cwd);
        const diff = diffLock(current, expected);
        if (option("json")) {
          io.stdout(JSON.stringify(diff, null, 2));
        } else {
          for (const line of describeLockDiff(diff)) io.stdout(line);
        }
        return 0;
      }
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

    if (command === "adopt") {
      const suggestions = suggestAnnotations(io.cwd, config, option("contract"));
      if (option("json")) {
        io.stdout(JSON.stringify(suggestions, null, 2));
        if (option("write")) {
          const applied = applyAnnotations(io.cwd, suggestions);
          io.stderr(`inserted ${applied.inserted} annotations in ${applied.changedFiles.length} files`);
        }
        return 0;
      }
      for (const suggestion of suggestions) {
        io.stdout(`${suggestion.docPath}:${suggestion.line} ${suggestion.token} -> ${suggestion.annotation}`);
      }
      io.stdout("adopted annotations stay advisory and do not count toward verified coverage until the adopted tag is removed");
      if (!option("write")) {
        io.stdout(`${suggestions.length} annotations proposed; pass --write to insert`);
        return 0;
      }
      const applied = applyAnnotations(io.cwd, suggestions);
      for (const file of applied.changedFiles) io.stdout(`updated ${file}`);
      io.stdout(`inserted ${applied.inserted} annotations`);
      return 0;
    }

    if (command === "strip") {
      const stripped = stripAnnotations(io.cwd, config, option("write"));
      if (option("json")) {
        io.stdout(JSON.stringify(stripped, null, 2));
      } else {
        for (const file of stripped.files) io.stdout(`stripped ${file}`);
        io.stdout(`${stripped.removed} annotation${stripped.removed === 1 ? "" : "s"} ${option("write") ? "removed" : "found"}`);
      }
      return 0;
    }

    if (command === "probe") {
      if (!config.allowExec) {
        io.stderr("error: probes execute project tooling; pass --allow-exec or set allowExec to true");
        return 2;
      }
      if (!option("allow-probes")) {
        io.stderr("error: probes require --allow-probes; Docker is not a hostile-code boundary");
        return 2;
      }
      if (config.probes.length === 0) {
        io.stderr("error: no probes configured; add probes to docbind.json");
        return 2;
      }
      const findings = runProbes(io.cwd, config);
      if (option("json")) {
        io.stdout(JSON.stringify(findings, null, 2));
      } else {
        for (const finding of findings) {
          io.stdout(`${finding.doc.path}:${finding.doc.line} ${finding.severity} ${finding.rule} ${finding.message}`);
        }
        io.stdout(`${findings.length} probe finding${findings.length === 1 ? "" : "s"}`);
      }
      return findings.length > 0 ? 1 : 0;
    }

    if (command === "doctest") {
      if (!config.allowExec) {
        io.stderr("error: doctest commands execute project tooling; pass --allow-exec or set allowExec to true");
        return 2;
      }
      if (config.doctests.length === 0) {
        io.stderr("error: no doctests configured; add doctests to docbind.json");
        return 2;
      }
      const findings = runDoctests(io.cwd, config);
      if (option("json")) {
        io.stdout(JSON.stringify(findings, null, 2));
      } else {
        for (const finding of findings) {
          io.stdout(`${finding.doc.path}:${finding.doc.line} ${finding.severity} ${finding.rule} ${finding.message}`);
        }
        io.stdout(`${findings.length} doctest finding${findings.length === 1 ? "" : "s"}`);
      }
      return findings.length > 0 ? 1 : 0;
    }

    if (command === "audit") {
      const result = checkProject(io.cwd, config);
      const coverage = result.stats.anchors === 0 ? 0 : result.stats.bound / result.stats.anchors;
      const examples = option("examples") ? auditExamples(io.cwd, config) : undefined;
      if (option("json")) {
        io.stdout(JSON.stringify({
          anchors: result.stats.anchors,
          bound: result.stats.bound,
          unbound: result.stats.unbound,
          coverage,
          annotationCoverage: result.coverage.annotationCoverage,
          verifiedExplicit: result.coverage.verifiedExplicit,
          adopted: result.coverage.adopted,
          inferred: result.coverage.inferred,
          adoptedTokens: option("adopted")
            ? result.pending
                .filter((binding) => binding.anchor.adopted)
                .map((binding) => ({
                  path: binding.anchor.docPath,
                  line: binding.anchor.line,
                  token: binding.anchor.token,
                  confidence: binding.anchor.adoptConfidence,
                }))
            : undefined,
          examples,
          tokens: option("unbound")
            ? result.unbound.map((entry) => ({
                path: entry.anchor.docPath,
                line: entry.anchor.line,
                column: entry.anchor.column,
                token: entry.anchor.token,
                reason: entry.reason,
              }))
            : undefined,
        }, null, 2));
        return 0;
      }
      io.stdout(`binding coverage: ${result.stats.bound}/${result.stats.anchors} (${(coverage * 100).toFixed(1)}%)`);
      io.stdout(`verified annotation coverage: ${result.coverage.verifiedExplicit}/${result.stats.anchors} (${(result.coverage.annotationCoverage * 100).toFixed(1)}%)`);
      io.stdout(`adopted: ${result.coverage.adopted}; inferred: ${result.coverage.inferred}; unbound: ${result.stats.unbound}`);
      if (examples) {
        io.stdout(`example fences: ${examples.fences}; docs with examples: ${examples.docsWithExamples.length}; configured for doctests: ${examples.configuredDocs.length}`);
        for (const doc of examples.unconfiguredDocs) io.stdout(`uncovered example doc: ${doc}`);
      }
      if (option("adopted")) {
        for (const entry of result.pending.filter((binding) => binding.anchor.adopted)) {
          io.stdout(`${entry.anchor.docPath}:${entry.anchor.line}:${entry.anchor.column} ${entry.anchor.token} (confidence ${entry.anchor.adoptConfidence ?? "?"})`);
        }
      }
      if (option("unbound")) {
        for (const entry of result.unbound) {
          io.stdout(`${entry.anchor.docPath}:${entry.anchor.line}:${entry.anchor.column} ${entry.anchor.token} (${entry.reason})`);
        }
      }
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

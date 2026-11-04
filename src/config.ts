import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { RULES, type Config, type Rule, type Severity } from "./types.js";

export const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/vendor/**",
  "**/dist/**",
  "**/build/**",
  "**/target/**",
  "**/.docbind-cache/**",
  "**/.venv/**",
  "**/site/**",
  "**/_build/**",
  "CHANGELOG*",
  "HISTORY*",
  "releases/**",
  "docs/migration*",
  "docs/upgrade*",
];

export const DEFAULT_DOCS = ["README.md", "docs/**/*.md", "docs/**/*.rst", "**/*.md", "**/*.rst"];

export const DEFAULT_CONFIG: Config = {
  docs: DEFAULT_DOCS,
  exclude: DEFAULT_EXCLUDES,
  packages: [],
  languages: { typescript: true, python: true, rust: true, go: false, rustdoc: false },
  severity: {
    "L1-broken": "error",
    "L2-moved": "error",
    "L3-reshaped": "error",
    "L4-renamed": "error",
    "S1-deprecated": "off",
    "D1-doctest": "error",
    "D2-probe": "error",
  },
  maxFindings: 200,
  minConfidence: 0.6,
  docstrings: false,
  asciidoc: false,
  javadoc: false,
  javaDefaults: false,
  lock: true,
  allowExec: false,
  cache: true,
  minCoverage: 0.8,
  requireContracts: true,
  indexes: [],
  doctests: [],
  probes: [],
  requireIndex: false,
};

const severitySchema = z.enum(["error", "warning", "note", "off"]);

const rawConfigSchema = z
  .object({
    docs: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    packages: z.array(z.string()).optional(),
    languages: z
      .object({
        typescript: z.boolean().optional(),
        python: z.boolean().optional(),
        rust: z.boolean().optional(),
        go: z.boolean().optional(),
        rustdoc: z.boolean().optional(),
      })
      .strict()
      .optional(),
    severity: z
      .object({
        "L1-broken": severitySchema.optional(),
        "L2-moved": severitySchema.optional(),
        "L3-reshaped": severitySchema.optional(),
        "L4-renamed": severitySchema.optional(),
        "S1-deprecated": severitySchema.optional(),
        "D1-doctest": severitySchema.optional(),
        "D2-probe": severitySchema.optional(),
      })
      .strict()
      .optional(),
    maxFindings: z.number().int().positive().optional(),
    minConfidence: z.number().min(0).max(1).optional(),
    docstrings: z.boolean().optional(),
    asciidoc: z.boolean().optional(),
    javadoc: z.boolean().optional(),
    javaDefaults: z.boolean().optional(),
    lock: z.boolean().optional(),
    allowExec: z.boolean().optional(),
    cache: z.boolean().optional(),
    minCoverage: z.number().min(0).max(1).optional(),
    requireContracts: z.boolean().optional(),
    indexes: z.array(z.string()).optional(),
    probes: z
      .array(
        z
          .object({
            name: z.string(),
            image: z.string(),
            command: z.string(),
            args: z.array(z.string()),
            docs: z.array(z.string()).optional(),
          })
          .strict(),
      )
      .optional(),
    requireIndex: z.boolean().optional(),
    doctests: z
      .array(
        z
          .object({
            name: z.string(),
            command: z.string(),
            args: z.array(z.string()),
            docs: z.array(z.string()).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export function parseConfig(input: unknown): Config {
  const raw = rawConfigSchema.parse(input ?? {});
  const severity = { ...DEFAULT_CONFIG.severity };
  for (const rule of RULES) {
    const value = raw.severity?.[rule] as Severity | undefined;
    if (value) severity[rule as Rule] = value;
  }
  return {
    docs: raw.docs ?? DEFAULT_CONFIG.docs,
    exclude: raw.exclude ?? DEFAULT_CONFIG.exclude,
    packages: raw.packages ?? DEFAULT_CONFIG.packages,
    languages: {
      ...DEFAULT_CONFIG.languages,
      ...(raw.languages ?? {}),
    },
    severity,
    maxFindings: raw.maxFindings ?? DEFAULT_CONFIG.maxFindings,
    minConfidence: raw.minConfidence ?? DEFAULT_CONFIG.minConfidence,
    docstrings: raw.docstrings ?? DEFAULT_CONFIG.docstrings,
    asciidoc: raw.asciidoc ?? DEFAULT_CONFIG.asciidoc,
    javadoc: raw.javadoc ?? DEFAULT_CONFIG.javadoc,
    javaDefaults: raw.javaDefaults ?? DEFAULT_CONFIG.javaDefaults,
    lock: raw.lock ?? DEFAULT_CONFIG.lock,
    allowExec: raw.allowExec ?? DEFAULT_CONFIG.allowExec,
    cache: raw.cache ?? DEFAULT_CONFIG.cache,
    minCoverage: raw.minCoverage ?? DEFAULT_CONFIG.minCoverage,
    requireContracts: raw.requireContracts ?? DEFAULT_CONFIG.requireContracts,
    indexes: raw.indexes ?? DEFAULT_CONFIG.indexes,
    doctests: raw.doctests ?? DEFAULT_CONFIG.doctests,
    probes: raw.probes ?? DEFAULT_CONFIG.probes,
    requireIndex: raw.requireIndex ?? DEFAULT_CONFIG.requireIndex,
  };
}

export function configPathFor(root: string): string {
  return join(root, "docbind.json");
}

export function loadConfig(root: string): Config {
  const path = configPathFor(root);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return parseConfig({});
    }
    throw error;
  }
  return parseConfig(JSON.parse(text));
}

export function writeDefaultConfig(root: string): string {
  const path = configPathFor(root);
  writeFileSync(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
  return path;
}

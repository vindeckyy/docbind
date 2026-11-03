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
  "**/.venv/**",
  "**/site/**",
  "**/_build/**",
  "CHANGELOG*",
  "HISTORY*",
  "releases/**",
  "docs/migration*",
  "docs/upgrade*",
];

export const DEFAULT_DOCS = ["README.md", "docs/**/*.md", "**/*.md"];

export const DEFAULT_CONFIG: Config = {
  docs: DEFAULT_DOCS,
  exclude: DEFAULT_EXCLUDES,
  packages: [],
  languages: { typescript: true, python: true },
  severity: {
    "L1-broken": "error",
    "L2-moved": "error",
    "L3-reshaped": "error",
    "L4-renamed": "error",
    "S1-deprecated": "off",
  },
  maxFindings: 200,
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
      })
      .strict()
      .optional(),
    maxFindings: z.number().int().positive().optional(),
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

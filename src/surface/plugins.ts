import type { Config } from "../types.js";
import type { ExtractResult } from "./protocol.js";
import { extractTypescript } from "./typescript.js";
import { extractPython } from "./python.js";
import { extractRust } from "./rust.js";
import { extractRustdoc } from "./rustdoc.js";
import { extractGo } from "./go.js";
import { extractJava } from "./java.js";

export const EXTRACTOR_API_VERSION = 1;

export interface ExtractorInput {
  root: string;
  files: string[];
  config: Config;
}

export interface ExtractorPlugin {
  id: string;
  apiVersion: number;
  extensions: string[];
  enabled: (config: Config) => boolean;
  extract: (input: ExtractorInput) => ExtractResult;
}

export const BUILTIN_EXTRACTORS: ExtractorPlugin[] = [
  {
    id: "typescript",
    apiVersion: EXTRACTOR_API_VERSION,
    extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
    enabled: (config) => config.languages.typescript,
    extract: ({ root, files }) => extractTypescript(root, files),
  },
  {
    id: "python",
    apiVersion: EXTRACTOR_API_VERSION,
    extensions: [".py"],
    enabled: (config) => config.languages.python,
    extract: ({ root, files }) => extractPython(root, files),
  },
  {
    id: "rust",
    apiVersion: EXTRACTOR_API_VERSION,
    extensions: [".rs"],
    enabled: (config) => config.languages.rust,
    extract: ({ root, files }) => extractRust(root, files),
  },
  {
    id: "rustdoc",
    apiVersion: EXTRACTOR_API_VERSION,
    extensions: [".rs"],
    enabled: (config) => config.languages.rustdoc && config.allowExec,
    extract: ({ root, files }) => extractRustdoc(root, files),
  },
  {
    id: "go",
    apiVersion: EXTRACTOR_API_VERSION,
    extensions: [".go"],
    enabled: (config) => config.languages.go,
    extract: ({ root, files }) => extractGo(root, files),
  },
  {
    id: "java",
    apiVersion: EXTRACTOR_API_VERSION,
    extensions: [".java"],
    enabled: (config) => config.javadoc,
    extract: ({ root, files, config }) => extractJava(root, files, config.javaDefaults),
  },
];

export function filesFor(plugin: ExtractorPlugin, files: string[]): string[] {
  return files.filter((file) => plugin.extensions.some((extension) => file.endsWith(extension)));
}

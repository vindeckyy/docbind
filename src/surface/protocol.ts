export interface DocstringEntry {
  filePath: string;
  line: number;
  text: string;
  owner?: string;
}

export interface ExtractResult {
  symbols: import("../types.js").Symbol[];
  docstrings?: DocstringEntry[];
  javadocs?: DocstringEntry[];
  parseFailures: number;
  filesScanned: number;
  error?: string;
}

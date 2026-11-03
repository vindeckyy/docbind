export interface DocstringEntry {
  filePath: string;
  line: number;
  text: string;
}

export interface ExtractResult {
  symbols: import("../types.js").Symbol[];
  docstrings?: DocstringEntry[];
  parseFailures: number;
  filesScanned: number;
  error?: string;
}

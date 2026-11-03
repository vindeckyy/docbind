export interface ExtractResult {
  symbols: import("../types.js").Symbol[];
  parseFailures: number;
  filesScanned: number;
  error?: string;
}

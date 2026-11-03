export type LineCoverage = Map<number, number>;
export type CoverageMap = Map<string, LineCoverage>;

export interface ChangedCoverageResult {
  total: number;
  covered: number;
  percent: number;
  threshold: number;
  pass: boolean;
  uncovered: Array<{ file: string; line: number }>;
}

export function parseLcov(text: string): CoverageMap {
  const result: CoverageMap = new Map();
  let current: string | undefined;
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.startsWith("SF:")) {
      current = line.slice(3).replace(/^\.\//u, "");
      result.set(current, new Map());
      continue;
    }
    if (line.startsWith("DA:") && current) {
      const [lineNumber, hits] = line.slice(3).split(",");
      const number = Number(lineNumber);
      if (Number.isFinite(number)) {
        result.get(current)?.set(number, Number(hits) || 0);
      }
      continue;
    }
    if (line === "end_of_record") current = undefined;
  }
  return result;
}

export function parseUnifiedDiff(text: string): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  let current: Set<number> | undefined;
  for (const rawLine of text.split(/\r?\n/u)) {
    if (rawLine.startsWith("+++ ")) {
      const path = rawLine.slice(4).trim();
      if (path === "/dev/null") {
        current = undefined;
        continue;
      }
      current = new Set();
      result.set(path.replace(/^b\//u, ""), current);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u.exec(rawLine);
    if (hunk && current) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      for (let offset = 0; offset < count; offset += 1) current.add(start + offset);
    }
  }
  return result;
}

export function allExecutableLines(coverage: CoverageMap): Map<string, Set<number>> {
  return new Map(
    [...coverage.entries()].map(([file, lines]) => [file, new Set(lines.keys())]),
  );
}

export function computeChangedCoverage(
  changed: Map<string, Set<number>>,
  coverage: CoverageMap,
  threshold = 95,
): ChangedCoverageResult {
  let total = 0;
  let covered = 0;
  const uncovered: Array<{ file: string; line: number }> = [];
  for (const [file, lines] of changed) {
    const executable = coverage.get(file);
    if (!executable) continue;
    for (const line of lines) {
      const hits = executable.get(line);
      if (hits === undefined) continue;
      total += 1;
      if (hits > 0) covered += 1;
      else uncovered.push({ file, line });
    }
  }
  const percent = total === 0 ? 100 : (covered / total) * 100;
  return {
    total,
    covered,
    percent,
    threshold,
    pass: percent >= threshold,
    uncovered: uncovered.sort((left, right) =>
      left.file === right.file ? left.line - right.line : left.file.localeCompare(right.file)
    ),
  };
}

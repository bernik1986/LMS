import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coverageDirectory = resolve(process.argv[2] || resolve(projectRoot, ".coverage", "v8"));
const outputPath = resolve(coverageDirectory, "..", "combined-summary.json");

function coverageFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return coverageFiles(path);
    return entry.name.endsWith(".json") ? [path] : [];
  });
}

function scriptPath(value) {
  if (!value || value.startsWith("node:") || value.startsWith("internal/")) return "";
  try {
    if (value.startsWith("file:")) {
      const url = new URL(value);
      url.search = "";
      url.hash = "";
      return resolve(fileURLToPath(url));
    }
  } catch {
    return "";
  }
  return /^[a-zA-Z]:[\\/]/.test(value) ? resolve(value.split(/[?#]/)[0]) : "";
}

function isProductionFile(path) {
  const projectPrefix = `${projectRoot}${sep}`;
  if (!path.startsWith(projectPrefix)) return false;
  const localPath = relative(projectRoot, path).replaceAll("\\", "/");
  if (localPath.startsWith("node_modules/") || localPath.startsWith("tests/")) return false;
  return /\.(?:c?js|mjs|ts)$/.test(localPath);
}

const scripts = new Map();
for (const path of coverageFiles(coverageDirectory)) {
  const document = JSON.parse(readFileSync(path, "utf8"));
  for (const result of document.result ?? []) {
    const pathName = scriptPath(result.url);
    if (!isProductionFile(pathName)) continue;
    let script = scripts.get(pathName);
    if (!script) {
      script = { path: pathName, functions: new Map() };
      scripts.set(pathName, script);
    }
    for (const functionCoverage of result.functions ?? []) {
      const rootRange = functionCoverage.ranges?.[0];
      if (!rootRange) continue;
      const functionKey = `${functionCoverage.functionName}|${rootRange.startOffset}|${rootRange.endOffset}`;
      let mergedFunction = script.functions.get(functionKey);
      if (!mergedFunction) {
        mergedFunction = {
          name: functionCoverage.functionName,
          root: { startOffset: rootRange.startOffset, endOffset: rootRange.endOffset, count: 0 },
          ranges: new Map()
        };
        script.functions.set(functionKey, mergedFunction);
      }
      for (const range of functionCoverage.ranges) {
        const rangeKey = `${range.startOffset}|${range.endOffset}`;
        const current = mergedFunction.ranges.get(rangeKey) ?? {
          startOffset: range.startOffset,
          endOffset: range.endOffset,
          count: 0
        };
        current.count += Number(range.count) || 0;
        mergedFunction.ranges.set(rangeKey, current);
      }
      mergedFunction.root.count = mergedFunction.ranges.get(
        `${rootRange.startOffset}|${rootRange.endOffset}`
      )?.count ?? 0;
    }
  }
}

function percent(covered, total) {
  return total ? Number(((covered / total) * 100).toFixed(2)) : 100;
}

function executableLines(source) {
  const lines = [];
  let offset = 0;
  let inBlockComment = false;
  for (const line of source.split(/\n/)) {
    const withoutCarriageReturn = line.endsWith("\r") ? line.slice(0, -1) : line;
    const trimmed = withoutCarriageReturn.trim();
    let executable = Boolean(trimmed);
    if (inBlockComment) {
      executable = false;
      if (trimmed.includes("*/")) inBlockComment = false;
    } else if (trimmed.startsWith("//")) {
      executable = false;
    } else if (trimmed.startsWith("/*")) {
      executable = false;
      if (!trimmed.includes("*/")) inBlockComment = true;
    } else if (/^\*\/?$/.test(trimmed)) {
      executable = false;
    }
    if (executable) {
      const firstCodeCharacter = withoutCarriageReturn.search(/\S/);
      const lastCodeCharacter = withoutCarriageReturn.search(/\s*$/) - 1;
      lines.push({
        offset: offset + Math.max(0, firstCodeCharacter),
        endOffset: offset + Math.max(firstCodeCharacter, lastCodeCharacter)
      });
    }
    offset += line.length + 1;
  }
  return lines;
}

function effectiveCount(ranges, offset) {
  let selected = null;
  for (const range of ranges) {
    if (range.startOffset > offset || range.endOffset <= offset) continue;
    if (!selected || range.endOffset - range.startOffset < selected.endOffset - selected.startOffset) {
      selected = range;
    }
  }
  return selected?.count ?? 0;
}

function summarizeScript(script) {
  const source = readFileSync(script.path, "utf8");
  const functions = [...script.functions.values()];
  const allRanges = functions.flatMap((item) => [...item.ranges.values()]);
  const lineEntries = executableLines(source);
  let coveredLines = 0;
  for (const line of lineEntries) {
    const offsets = [
      line.offset,
      Math.floor((line.offset + line.endOffset) / 2),
      line.endOffset
    ];
    if (offsets.some((offset) => effectiveCount(allRanges, offset) > 0)) coveredLines += 1;
  }

  const measuredFunctions = functions.filter(
    (item) => !(item.name === "" && item.root.startOffset === 0 && item.root.endOffset >= source.length)
  );
  const branchRanges = functions.flatMap((item) =>
    [...item.ranges.values()].filter(
      (range) =>
        range.startOffset !== item.root.startOffset ||
        range.endOffset !== item.root.endOffset
    )
  );
  const coveredFunctions = measuredFunctions.filter((item) => item.root.count > 0).length;
  const coveredBranches = branchRanges.filter((range) => range.count > 0).length;
  return {
    file: relative(projectRoot, script.path).replaceAll("\\", "/"),
    bytes: statSync(script.path).size,
    lines: {
      covered: coveredLines,
      total: lineEntries.length,
      percent: percent(coveredLines, lineEntries.length)
    },
    functions: {
      covered: coveredFunctions,
      total: measuredFunctions.length,
      percent: percent(coveredFunctions, measuredFunctions.length)
    },
    branches: {
      covered: coveredBranches,
      total: branchRanges.length,
      percent: percent(coveredBranches, branchRanges.length)
    }
  };
}

const fileSummaries = [...scripts.values()]
  .map(summarizeScript)
  .sort((left, right) => left.file.localeCompare(right.file));

function totalsFor(metric) {
  const covered = fileSummaries.reduce((sum, file) => sum + file[metric].covered, 0);
  const total = fileSummaries.reduce((sum, file) => sum + file[metric].total, 0);
  return { covered, total, percent: percent(covered, total) };
}

const summary = {
  generatedAt: new Date().toISOString(),
  method: "Merged raw V8 process coverage; comment-only and blank lines are excluded.",
  files: fileSummaries,
  totals: {
    lines: totalsFor("lines"),
    functions: totalsFor("functions"),
    branches: totalsFor("branches")
  }
};

writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

const rows = fileSummaries.map((file) => ({
  File: file.file,
  Lines: `${file.lines.percent.toFixed(2)}% (${file.lines.covered}/${file.lines.total})`,
  Functions: `${file.functions.percent.toFixed(2)}% (${file.functions.covered}/${file.functions.total})`,
  Branches: `${file.branches.percent.toFixed(2)}% (${file.branches.covered}/${file.branches.total})`
}));
rows.push({
  File: "TOTAL",
  Lines: `${summary.totals.lines.percent.toFixed(2)}% (${summary.totals.lines.covered}/${summary.totals.lines.total})`,
  Functions: `${summary.totals.functions.percent.toFixed(2)}% (${summary.totals.functions.covered}/${summary.totals.functions.total})`,
  Branches: `${summary.totals.branches.percent.toFixed(2)}% (${summary.totals.branches.covered}/${summary.totals.branches.total})`
});

console.table(rows);
console.log(`Combined coverage summary: ${outputPath}`);

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareBenchmarkJsonReports,
  defaultComparisonOutputPath,
  loadBenchmarkJsonReport,
  renderBenchmarkComparisonMarkdown
} from "../src/lib/eval/reportComparison";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function usage(): string {
  return [
    "Usage:",
    "  npm run eval:rag:compare -- <before-report.json> <after-report.json> [output.md]",
    "",
    "Both inputs must be JSON files produced by npm run eval:rag."
  ].join("\n");
}

function resolveInput(input: string): string {
  return path.isAbsolute(input) ? input : path.join(repoRoot, input);
}

function main(): void {
  const [, , beforeArg, afterArg, outputArg] = process.argv;
  if (!beforeArg || !afterArg) {
    console.error(usage());
    process.exit(1);
  }

  const beforePath = resolveInput(beforeArg);
  const afterPath = resolveInput(afterArg);
  const outputPath = outputArg ? resolveInput(outputArg) : defaultComparisonOutputPath(repoRoot);
  const comparison = compareBenchmarkJsonReports(
    loadBenchmarkJsonReport(beforePath),
    loadBenchmarkJsonReport(afterPath)
  );
  const markdown = renderBenchmarkComparisonMarkdown(comparison);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${markdown}\n`, "utf8");
  console.log(markdown);
  console.log(`\nComparison written: ${outputPath}`);

  if (comparison.regressedCases.length > 0) {
    process.exit(1);
  }
}

main();

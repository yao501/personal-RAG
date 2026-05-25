import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareRealRegressionReports,
  defaultRealRegressionComparisonOutputPath,
  hasBlockingRealRegressionChange,
  loadRealRegressionReport,
  renderRealRegressionComparisonMarkdown
} from "../src/lib/eval/realRegressionComparison";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function usage(): string {
  return [
    "Usage:",
    "  npm run eval:rag:real:compare -- <before-real-regression.json> <after-real-regression.json> [output.md]",
    "",
    "Both inputs must be JSON files produced by scripts/runRealRegressionRagOnly.ts."
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
  const outputPath = outputArg ? resolveInput(outputArg) : defaultRealRegressionComparisonOutputPath(repoRoot);
  const comparison = compareRealRegressionReports(
    loadRealRegressionReport(beforePath),
    loadRealRegressionReport(afterPath)
  );
  const markdown = renderRealRegressionComparisonMarkdown(comparison);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${markdown}\n`, "utf8");
  console.log(markdown);
  console.log(`\nComparison written: ${outputPath}`);

  if (hasBlockingRealRegressionChange(comparison)) {
    process.exit(1);
  }
}

main();

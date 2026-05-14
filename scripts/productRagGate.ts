import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const viteNodeBin = path.join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "vite-node.cmd" : "vite-node");

interface GateStep {
  id: string;
  label: string;
  command: string[];
  status: "pass" | "fail" | "skipped";
  exitCode: number | null;
  summary: string[];
  skippedReason?: string;
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function nextSeqForDate(dir: string, date: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const prefix = `product-rag-gate-${date}-`;
  const existing = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".md"))
    .map((name) => Number.parseInt(name.replace(prefix, "").replace(/\.md$/, ""), 10))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  return String((existing.at(-1) ?? 0) + 1).padStart(3, "0");
}

function extractSummary(stdout: string): string[] {
  const summaryPatterns = [
    /Passed \d+\/\d+/,
    /Mean recall@k: .+/,
    /mustRefuse correct: \d+\/\d+/,
    /Phase B .+/,
    /P:\d+ Pa:\d+ F:\d+ \| .+/
  ];
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const matched = lines.filter((line) => summaryPatterns.some((pattern) => pattern.test(line)));
  return matched.length > 0 ? matched : lines.slice(-6);
}

function runStep(id: string, label: string, args: string[], env: NodeJS.ProcessEnv = {}): GateStep {
  const command = [viteNodeBin, ...args];
  console.log(`\n== ${label} ==`);
  console.log(command.map((part) => (part.includes(" ") ? `"${part}"` : part)).join(" "));

  const result = spawnSync(viteNodeBin, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      PKRAG_RETRIEVAL_DEBUG: process.env.PKRAG_RETRIEVAL_DEBUG ?? "1",
      ...env
    },
    encoding: "utf8"
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  const exitCode = result.status ?? (result.error ? 1 : 0);
  return {
    id,
    label,
    command,
    status: exitCode === 0 ? "pass" : "fail",
    exitCode,
    summary: extractSummary(`${result.stdout ?? ""}\n${result.stderr ?? ""}`)
  };
}

function skippedStep(id: string, label: string, reason: string): GateStep {
  console.log(`\n== ${label} ==`);
  console.log(`skipped: ${reason}`);
  return {
    id,
    label,
    command: [],
    status: "skipped",
    exitCode: null,
    summary: [reason],
    skippedReason: reason
  };
}

function writeReport(steps: GateStep[], options: { requireRealpdf: boolean; realpdfDir: string | null }): string {
  const outDir = path.join(repoRoot, "evals", "results");
  const date = new Date().toISOString().slice(0, 10);
  const seq = nextSeqForDate(outDir, date);
  const reportPath = path.join(outDir, `product-rag-gate-${date}-${seq}.md`);
  const failed = steps.filter((step) => step.status === "fail");

  const lines: string[] = [];
  lines.push("# Product RAG Gate");
  lines.push("");
  lines.push(`- generated_at: ${new Date().toISOString()}`);
  lines.push(`- require_realpdf: ${options.requireRealpdf ? "yes" : "no"}`);
  lines.push(`- realpdf_dir: ${options.realpdfDir ?? "not set"}`);
  lines.push(`- result: ${failed.length === 0 ? "PASS" : "FAIL"}`);
  lines.push("");
  lines.push("| step | status | exit | summary |");
  lines.push("|------|--------|------|---------|");
  for (const step of steps) {
    const status = step.status.toUpperCase();
    const exit = step.exitCode === null ? "-" : String(step.exitCode);
    const summary = step.summary.join("<br>").replace(/\|/g, "\\|");
    lines.push(`| ${step.label} | **${status}** | ${exit} | ${summary} |`);
  }
  lines.push("");
  lines.push("## Commands");
  for (const step of steps) {
    if (step.command.length === 0) {
      lines.push(`- ${step.label}: skipped (${step.skippedReason})`);
      continue;
    }
    lines.push(`- ${step.label}: \`${step.command.join(" ")}\``);
  }
  lines.push("");
  lines.push("## Notes");
  lines.push("- Fixture benchmark is mandatory and should stay green before retrieval, chunking, reranking, or answer changes are shipped.");
  lines.push("- Real DCS PDF evaluation is local-only; generated reports are gitignored because they may contain absolute paths and source snippets.");

  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  return reportPath;
}

async function main(): Promise<void> {
  const requireRealpdf = hasFlag("--require-realpdf");
  const skipRealpdf = hasFlag("--skip-realpdf");
  const realpdfDir = process.env.PKRAG_REALPDF_DIR?.trim() || null;
  const realpdfAvailable = Boolean(realpdfDir && fs.existsSync(realpdfDir));
  const steps: GateStep[] = [];

  steps.push(runStep("fixture-smoke", "Fixture smoke benchmark", ["scripts/runRagEval.ts", "benchmarks/benchmark.v1.json"]));

  if (skipRealpdf) {
    steps.push(skippedStep("dcs-manual7", "DCS Manual 7 Phase B", "--skip-realpdf was set"));
  } else if (realpdfAvailable && realpdfDir) {
    steps.push(
      runStep("dcs-manual7", "DCS Manual 7 Phase B", [
        "scripts/p0bPhaseBOnly.ts",
        "--spec",
        "evals/cases/p0b-manual7-phaseb.json"
      ])
    );
  } else if (requireRealpdf) {
    steps.push(skippedStep("dcs-manual7", "DCS Manual 7 Phase B", "PKRAG_REALPDF_DIR is required but missing or invalid"));
  } else {
    steps.push(skippedStep("dcs-manual7", "DCS Manual 7 Phase B", "PKRAG_REALPDF_DIR not set; run with --require-realpdf for release gates"));
  }

  const reportPath = writeReport(steps, { requireRealpdf, realpdfDir });
  console.log(`\nProduct RAG gate report: ${reportPath}`);

  const failed = steps.some((step) => step.status === "fail");
  const requiredRealpdfMissing = requireRealpdf && steps.some((step) => step.id === "dcs-manual7" && step.status === "skipped");
  if (failed || requiredRealpdfMissing) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

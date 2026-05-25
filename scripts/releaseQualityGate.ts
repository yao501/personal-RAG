import { spawnSync } from "node:child_process";

type Step = {
  label: string;
  command: string[];
};

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function readOption(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
}

function npmCommand(args: string[]): string[] {
  return [process.platform === "win32" ? "npm.cmd" : "npm", ...args];
}

function runStep(step: Step): void {
  console.log(`\n== ${step.label} ==`);
  console.log(step.command.join(" "));
  const result = spawnSync(step.command[0], step.command.slice(1), {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  });
  const status = result.status ?? (result.error ? 1 : 0);
  if (status !== 0) {
    throw new Error(`${step.label} failed with exit code ${status}`);
  }
}

async function main(): Promise<void> {
  const profile = readOption("--profile", "dcs-core");
  const productGateArgs = ["run", "eval:rag:product", "--", "--profile", profile];
  if (hasFlag("--require-realpdf")) {
    productGateArgs.push("--require-realpdf");
  }
  if (hasFlag("--skip-realpdf")) {
    productGateArgs.push("--skip-realpdf");
  }

  const steps: Step[] = [
    { label: "Release metadata consistency", command: npmCommand(["run", "release:metadata-check"]) },
    { label: "Unit tests", command: npmCommand(["test"]) },
    { label: "Production build", command: npmCommand(["run", "build"]) },
    { label: "Product RAG gate", command: npmCommand(productGateArgs) }
  ];

  for (const step of steps) {
    runStep(step);
  }

  console.log("\nRelease quality gate: PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

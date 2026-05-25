import fs from "node:fs";
import path from "node:path";

type PackageJson = {
  version?: string;
  scripts?: Record<string, string>;
  build?: {
    electronDist?: string;
    mac?: {
      hardenedRuntime?: boolean;
      entitlements?: string;
      entitlementsInherit?: string;
    };
  };
};

function readText(filePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

function fail(message: string): never {
  throw new Error(`Release metadata check failed: ${message}`);
}

function requireMatch(label: string, text: string, pattern: RegExp): RegExpMatchArray {
  const match = text.match(pattern);
  if (!match) {
    fail(`Could not find ${label}.`);
  }
  return match;
}

function assertFileExists(filePath: string, label: string): void {
  if (!fs.existsSync(path.resolve(process.cwd(), filePath))) {
    fail(`${label} does not exist: ${filePath}`);
  }
}

function main(): void {
  const pkg = JSON.parse(readText("package.json")) as PackageJson;
  const version = pkg.version ?? "";
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`package.json version must be semver-like, got "${version || "<missing>"}".`);
  }

  const storeSource = readText("src/main/store.ts");
  const migrationDoc = readText("docs/MIGRATION.md");
  const schemaVersion = Number(requireMatch(
    "CURRENT_DATABASE_SCHEMA_VERSION in src/main/store.ts",
    storeSource,
    /CURRENT_DATABASE_SCHEMA_VERSION\s*=\s*(\d+)/
  )[1]);
  const documentedSchemaVersion = Number(requireMatch(
    "current PRAGMA user_version in docs/MIGRATION.md",
    migrationDoc,
    /PRAGMA user_version\s*=\s*(\d+)/
  )[1]);

  if (schemaVersion !== documentedSchemaVersion) {
    fail(`database schema version mismatch: code=${schemaVersion}, docs=${documentedSchemaVersion}.`);
  }

  if (pkg.build?.mac?.hardenedRuntime !== true) {
    fail("package.json build.mac.hardenedRuntime must stay true for macOS release candidates.");
  }

  const entitlements = pkg.build?.mac?.entitlements;
  const entitlementsInherit = pkg.build?.mac?.entitlementsInherit;
  if (!entitlements || !entitlementsInherit) {
    fail("package.json build.mac entitlements and entitlementsInherit must be configured.");
  }
  assertFileExists(entitlements, "macOS entitlements file");
  assertFileExists(entitlementsInherit, "macOS inherited entitlements file");

  if (!pkg.build?.electronDist) {
    fail("package.json build.electronDist must stay configured for restricted-network release repeatability.");
  }

  const requiredScripts = ["release:quality", "release:mac", "release:verify", "release:sign-precheck", "release:notary-precheck"];
  for (const scriptName of requiredScripts) {
    if (!pkg.scripts?.[scriptName]) {
      fail(`package.json scripts.${scriptName} is missing.`);
    }
  }

  console.log("Release metadata check: PASS");
  console.log(`- package version: ${version}`);
  console.log(`- database schema version: ${schemaVersion}`);
  console.log(`- macOS hardened runtime: ${pkg.build.mac.hardenedRuntime ? "enabled" : "disabled"}`);
}

main();

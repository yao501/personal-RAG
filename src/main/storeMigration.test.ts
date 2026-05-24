import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareDatabaseMigration } from "./store";

let tempDirs: string[] = [];
const mockDatabaseVersions = vi.hoisted(() => new Map<string, number>());

vi.mock("better-sqlite3", () => ({
  default: class MockDatabase {
    constructor(private readonly dbPath: string) {}

    prepare() {
      return {
        get: () => ({ user_version: mockDatabaseVersions.get(this.dbPath) ?? 0 })
      };
    }

    close() {}
  }
}));

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pkrag-store-migration-"));
  tempDirs.push(dir);
  return dir;
}

function createDatabaseWithUserVersion(dbPath: string, userVersion: number): void {
  fs.writeFileSync(dbPath, `mock sqlite db v${userVersion}`, "utf8");
  mockDatabaseVersions.set(dbPath, userVersion);
}

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
  mockDatabaseVersions.clear();
});

describe("prepareDatabaseMigration", () => {
  it("creates a pre-migration backup for older non-empty databases", () => {
    const dir = makeTempDir();
    const dbPath = path.join(dir, "knowledge-rag.db");
    createDatabaseWithUserVersion(dbPath, 2);

    const report = prepareDatabaseMigration(dbPath, 3);

    expect(report).toMatchObject({
      currentSchemaVersion: 3,
      databaseUserVersionBefore: 2,
      databaseUserVersionAfter: 2,
      migrationNeeded: true,
      migrationApplied: false,
      backupCreated: true,
      error: null
    });
    expect(report.backupPath).toContain("pre-migration-v2-to-v3");
    expect(report.backupPath && fs.existsSync(report.backupPath)).toBe(true);
  });

  it("refuses databases newer than the supported schema before writing", () => {
    const dir = makeTempDir();
    const dbPath = path.join(dir, "knowledge-rag.db");
    createDatabaseWithUserVersion(dbPath, 4);

    const report = prepareDatabaseMigration(dbPath, 3);

    expect(report).toMatchObject({
      currentSchemaVersion: 3,
      databaseUserVersionBefore: 4,
      databaseUserVersionAfter: 4,
      migrationNeeded: false,
      migrationApplied: false,
      backupCreated: false
    });
    expect(report.error).toContain("newer than this app supports");
  });
});

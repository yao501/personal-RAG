import type { AppSettings, QueryLogFeedbackStatus } from "../lib/shared/types";
import { isAbsoluteLocalPath } from "./security";

export class IpcValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IpcValidationError";
  }
}

function fail(message: string): never {
  throw new IpcValidationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function expectNoArgs(args: unknown[]): [] {
  if (args.length > 0) {
    fail("This IPC call does not accept arguments.");
  }

  return [];
}

export function expectString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    fail(`${fieldName} must be a string.`);
  }

  const normalized = value.trim();
  if (!normalized) {
    fail(`${fieldName} must not be empty.`);
  }

  return normalized;
}

export function expectAbsolutePath(value: unknown, fieldName: string): string {
  const normalized = expectString(value, fieldName);
  if (!isAbsoluteLocalPath(normalized)) {
    fail(`${fieldName} must be an absolute local path.`);
  }

  return normalized;
}

export function expectStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    fail(`${fieldName} must be an array.`);
  }

  const normalized = value.map((item, index) => expectString(item, `${fieldName}[${index}]`));
  if (normalized.length === 0) {
    fail(`${fieldName} must not be empty.`);
  }

  return normalized;
}

export function expectOptionalStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectStringArray(value, fieldName);
}

export function expectOptionalPositiveInt(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    fail(`${fieldName} must be a positive integer.`);
  }

  return value;
}

export function expectOptionalNullableString(value: unknown, fieldName: string): string | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }

  return expectString(value, fieldName);
}

export function expectSettingsPatch(value: unknown): Partial<AppSettings> {
  if (!isRecord(value)) {
    fail("settings must be an object.");
  }

  const allowedKeys = new Set(["libraryPath", "chunkSize", "chunkOverlap"]);
  const patch: Partial<AppSettings> = {};

  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      fail(`settings contains an unsupported key: ${key}.`);
    }
  }

  if ("libraryPath" in value) {
    const libraryPath = value.libraryPath;
    if (libraryPath !== null && libraryPath !== undefined) {
      patch.libraryPath = expectAbsolutePath(libraryPath, "settings.libraryPath");
    } else {
      patch.libraryPath = null;
    }
  }

  if ("chunkSize" in value) {
    patch.chunkSize = expectBoundedInt(value.chunkSize, "settings.chunkSize", 60, 400);
  }

  if ("chunkOverlap" in value) {
    patch.chunkOverlap = expectBoundedInt(value.chunkOverlap, "settings.chunkOverlap", 0, 200);
  }

  return patch;
}

export function expectFeedbackStatus(value: unknown): QueryLogFeedbackStatus {
  const normalized = expectString(value, "status");
  const allowed: QueryLogFeedbackStatus[] = ["pending", "benchmark_candidate", "promoted", "ignored"];
  if (!allowed.includes(normalized as QueryLogFeedbackStatus)) {
    fail(`status must be one of: ${allowed.join(", ")}.`);
  }

  return normalized as QueryLogFeedbackStatus;
}

export function expectBoundedInt(value: unknown, fieldName: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fail(`${fieldName} must be an integer between ${min} and ${max}.`);
  }

  return value;
}

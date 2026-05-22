import { describe, expect, it } from "vitest";
import {
  IpcValidationError,
  expectAbsolutePath,
  expectFeedbackStatus,
  expectOptionalPositiveInt,
  expectQueryDebugExportOptions,
  expectSettingsPatch,
  expectStringArray,
  expectSupportBundleExportOptions
} from "./ipcValidation";

describe("ipcValidation", () => {
  it("validates absolute paths and positive integers", () => {
    expect(expectAbsolutePath("/tmp/file.txt", "filePath")).toBe("/tmp/file.txt");
    expect(expectOptionalPositiveInt(12, "limit")).toBe(12);
  });

  it("rejects relative paths and empty arrays", () => {
    expect(() => expectAbsolutePath("tmp/file.txt", "filePath")).toThrow(IpcValidationError);
    expect(() => expectStringArray([], "documentIds")).toThrow(IpcValidationError);
  });

  it("validates settings patches and feedback status", () => {
    expect(expectSettingsPatch({ chunkSize: 180, chunkOverlap: 40, libraryPath: null })).toEqual({
      chunkSize: 180,
      chunkOverlap: 40,
      libraryPath: null
    });
    expect(expectFeedbackStatus("promoted")).toBe("promoted");
  });

  it("parses support bundle export options", () => {
    expect(expectSupportBundleExportOptions([])).toEqual([false]);
    expect(expectSupportBundleExportOptions([{}])).toEqual([false]);
    expect(expectSupportBundleExportOptions([{ anonymize: true }])).toEqual([true]);
  });

  it("parses query debug export options", () => {
    expect(expectQueryDebugExportOptions([{ logId: "log-1" }])).toEqual(["log-1", true]);
    expect(expectQueryDebugExportOptions([{ logId: "log-1", anonymize: false }])).toEqual(["log-1", false]);
    expect(() => expectQueryDebugExportOptions([])).toThrow(IpcValidationError);
    expect(() => expectQueryDebugExportOptions([{ logId: "log-1", anonymize: "yes" }])).toThrow(IpcValidationError);
  });
});

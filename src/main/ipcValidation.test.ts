import { describe, expect, it } from "vitest";
import {
  IpcValidationError,
  expectAbsolutePath,
  expectFeedbackStatus,
  expectOptionalPositiveInt,
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
});

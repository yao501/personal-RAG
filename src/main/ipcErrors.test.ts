import { describe, expect, it } from "vitest";
import { createImportError } from "./importErrors";
import { IpcValidationError } from "./ipcValidation";
import { IpcForbiddenError, toRendererErrorInfo } from "./ipcErrors";

describe("toRendererErrorInfo", () => {
  it("maps ImportPipelineError fields through", () => {
    const err = createImportError({
      code: "empty_content",
      stage: "parsing",
      message: "no content",
      suggestion: "fix source",
      retryable: false
    });

    const info = toRendererErrorInfo("files:import", err);
    expect(info.code).toBe("empty_content");
    expect(info.stage).toBe("parsing");
    expect(info.message).toBe("no content");
    expect(info.suggestion).toBe("fix source");
    expect(info.retryable).toBe(false);
    expect(info.details?.channel).toBe("files:import");
  });

  it("maps IpcValidationError to ipc_validation", () => {
    const info = toRendererErrorInfo("settings:update", new IpcValidationError("bad args"));
    expect(info.code).toBe("ipc_validation");
    expect(info.stage).toBe("ipc");
    expect(info.retryable).toBe(false);
  });

  it("maps IpcForbiddenError to ipc_forbidden", () => {
    const info = toRendererErrorInfo("snapshot:get", new IpcForbiddenError("nope"));
    expect(info.code).toBe("ipc_forbidden");
    expect(info.stage).toBe("ipc");
    expect(info.retryable).toBe(false);
  });

  it("maps unknown errors to ipc_handler", () => {
    const info = toRendererErrorInfo("chat:ask", new Error("boom"));
    expect(info.code).toBe("ipc_handler");
    expect(info.stage).toBe("ipc");
    expect(info.retryable).toBe(true);
    expect(info.message).toBe("boom");
  });
});


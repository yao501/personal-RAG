import { describe, expect, it } from "vitest";
import { createImportError } from "./importErrors";
import { IpcValidationError } from "./ipcValidation";
import { IpcForbiddenError, toRendererErrorInfo } from "./ipcErrors";

describe("toRendererErrorInfo", () => {
  it("maps ImportPipelineError fields through", () => {
    const err = createImportError({
      code: "task_busy",
      stage: "preflight",
      message: "task already running",
      suggestion: "wait and retry",
      retryable: true
    });

    const info = toRendererErrorInfo("files:import", err);
    expect(info.code).toBe("task_busy");
    expect(info.stage).toBe("preflight");
    expect(info.message).toBe("task already running");
    expect(info.suggestion).toBe("wait and retry");
    expect(info.retryable).toBe(true);
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

import type { RendererErrorInfo } from "../lib/shared/types";
import { ImportPipelineError } from "./importErrors";
import { IpcValidationError } from "./ipcValidation";

export class IpcForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IpcForbiddenError";
  }
}

function asMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
}

export function toRendererErrorInfo(channel: string, error: unknown): RendererErrorInfo {
  if (error instanceof ImportPipelineError) {
    return {
      code: error.code,
      stage: error.stage,
      message: error.message,
      suggestion: error.suggestion,
      retryable: error.retryable,
      details: { channel }
    };
  }

  if (error instanceof IpcValidationError) {
    return {
      code: "ipc_validation",
      stage: "ipc",
      message: error.message,
      suggestion: "请检查输入参数；若问题持续，建议重启应用后再试。",
      retryable: false,
      details: { channel }
    };
  }

  if (error instanceof IpcForbiddenError) {
    return {
      code: "ipc_forbidden",
      stage: "ipc",
      message: error.message,
      suggestion: "该请求来源不受信任。请重启应用，避免从外部页面触发该操作。",
      retryable: false,
      details: { channel }
    };
  }

  return {
    code: "ipc_handler",
    stage: "ipc",
    message: asMessage(error),
    suggestion: "请重试一次；若问题持续，请复制诊断信息并联系支持。",
    retryable: true,
    details: { channel }
  };
}

export function isIpcResult(value: unknown): value is { ok: boolean } {
  return typeof value === "object" && value !== null && "ok" in value;
}


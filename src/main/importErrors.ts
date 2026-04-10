import path from "node:path";
import type { AppErrorCode, AppErrorInfo, AppErrorStage, ImportIssueDetail } from "../lib/shared/types";

type AppErrorInput = {
  code: AppErrorCode;
  stage: AppErrorStage;
  message: string;
  suggestion?: string | null;
  retryable?: boolean;
};

export class ImportPipelineError extends Error implements AppErrorInfo {
  code: AppErrorCode;
  stage: AppErrorStage;
  suggestion: string | null;
  retryable: boolean;

  constructor(input: AppErrorInput) {
    super(input.message);
    this.name = "ImportPipelineError";
    this.code = input.code;
    this.stage = input.stage;
    this.suggestion = input.suggestion ?? null;
    this.retryable = input.retryable ?? false;
  }
}

export function createImportError(input: AppErrorInput): ImportPipelineError {
  return new ImportPipelineError(input);
}

export function isImportPipelineError(error: unknown): error is ImportPipelineError {
  return error instanceof ImportPipelineError;
}

export function normalizeImportError(error: unknown, filePath: string, stage: AppErrorStage): ImportPipelineError {
  if (isImportPipelineError(error)) {
    return error;
  }

  const fileName = path.basename(filePath);
  const errno = error as NodeJS.ErrnoException;

  if (errno?.code === "ENOENT") {
    return createImportError({
      code: "file_not_found",
      stage: "preflight",
      message: `找不到文件：${fileName}`,
      suggestion: "请确认文件仍在原路径，或重新选择文件后再导入。",
      retryable: false
    });
  }

  if (errno?.code === "EACCES" || errno?.code === "EPERM") {
    return createImportError({
      code: "permission_denied",
      stage: "preflight",
      message: `没有权限读取文件：${fileName}`,
      suggestion: "请检查文件权限，或将文件移动到当前账号可访问的位置后重试。",
      retryable: false
    });
  }

  if (error instanceof Error && /Unsupported file type/i.test(error.message)) {
    return createImportError({
      code: "unsupported_file_type",
      stage: "preflight",
      message: `暂不支持该文件类型：${fileName}`,
      suggestion: "请导入 pdf、md、txt 或 docx 文件。",
      retryable: false
    });
  }

  if (error instanceof Error && /password|encrypted|cipher/i.test(error.message)) {
    return createImportError({
      code: "pdf_unreadable",
      stage: "parsing",
      message: `PDF 无法解析：${fileName}`,
      suggestion: "文件可能已加密或内容受保护，请导出为可读取版本后再导入。",
      retryable: false
    });
  }

  if (error instanceof Error && /sqlite|database|constraint/i.test(error.message)) {
    return createImportError({
      code: "sqlite_write_failed",
      stage: "storage",
      message: `写入本地数据库失败：${fileName}`,
      suggestion: "请稍后重试；如果问题持续，请检查数据目录权限并导出诊断信息。",
      retryable: true
    });
  }

  if (error instanceof Error && /embed|embedding|transformers|model/i.test(error.message)) {
    return createImportError({
      code: "embedding_failed",
      stage: "embedding",
      message: `向量生成失败：${fileName}`,
      suggestion: "请检查本地 embedding 模型是否可用；如果问题持续，请导出诊断包。",
      retryable: true
    });
  }

  if (error instanceof Error && /lance|vector index|rebuild index|index rebuild/i.test(error.message)) {
    return createImportError({
      code: "vector_index_failed",
      stage: "indexing",
      message: `向量索引构建失败：${fileName}`,
      suggestion: "请稍后重试；如果问题持续，请运行健康检查并导出诊断包。",
      retryable: true
    });
  }

  if (error instanceof Error && /pdf|docx|parse|mammoth/i.test(error.message)) {
    return createImportError({
      code: "file_corrupted",
      stage: "parsing",
      message: `文件内容无法解析：${fileName}`,
      suggestion: "文件可能损坏或格式异常，请重新导出后再试。",
      retryable: false
    });
  }

  return createImportError({
    code: "unknown_import_error",
    stage,
    message: error instanceof Error ? error.message : `导入失败：${fileName}`,
    suggestion: "请重试一次；如果仍失败，建议记录错误码并导出诊断包。",
    retryable: true
  });
}

export function toImportIssueDetail(
  filePath: string,
  disposition: "skipped" | "failed",
  error: AppErrorInfo
): ImportIssueDetail {
  return {
    filePath,
    disposition,
    reason: error.message,
    code: error.code,
    stage: error.stage,
    suggestion: error.suggestion,
    retryable: error.retryable,
    message: error.message
  };
}

import { isFullWorkflowInstallQuery } from "./fullWorkflowBias";

/**
 * Coarse, reviewable buckets for retrieval bias and debug (P0-B B1).
 * Prefer conservative classification: when unsure, use `default`.
 */
export type QueryRetrievalType =
  | "procedural_full_flow"
  | "compile_order"
  | "definition"
  | "troubleshooting"
  | "default";

/**
 * Map a user question to a single retrieval type. Order matters: earlier branches win.
 */
export function resolveQueryRetrievalType(question: string): QueryRetrievalType {
  const q = question.trim();
  if (!q) {
    return "default";
  }

  if (
    isFullWorkflowInstallQuery(q) ||
    /(?:完整步骤|全流程|整体流程|主链路|完整使用步骤|从\s*安装\s*到|投运|环节|依次)/.test(q)
  ) {
    return "procedural_full_flow";
  }

  if (/(?:编译|下装)/.test(q) && /(?:顺序|先后)/.test(q)) {
    return "compile_order";
  }

  if (
    /(?:无法|不能|失败|报错|错误|异常|故障|没反应|失效|启动失败|服务启动失败)/.test(q) ||
    /(?:怎么(?:办|处理)|如何(?:处理|修复|排查))/.test(q)
  ) {
    return "troubleshooting";
  }

  if (/(?:什么是|是什么|定义|含义|原理|介绍\?|介绍？)/.test(q) || /^何谓|^啥是/.test(q)) {
    return "definition";
  }

  return "default";
}

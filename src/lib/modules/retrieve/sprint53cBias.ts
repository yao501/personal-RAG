import type { SearchResult } from "../../shared/types";
import type { QueryRetrievalType } from "./queryRetrievalType";
import { resolveQueryRetrievalType } from "./queryRetrievalType";
import { isFullWorkflowInstallQuery } from "./fullWorkflowBias";
import { computeSourcePriorDelta, matchManualFamily } from "./sourcePrior";

function rescore(results: SearchResult[], deltaFor: (r: SearchResult) => number): SearchResult[] {
  const scored = results.map((r) => {
    const d = deltaFor(r);
    const adj = r.score + d;
    return { r: { ...r, score: adj }, adj };
  });
  scored.sort((a, b) => b.adj - a.adj);
  return scored.map((x) => x.r);
}

/**
 * Sprint 5.3c：chunk 内容层启发（顺序链、TRUE/FALSE 对齐等），**不包含**分册 fileName 路由。
 * 分册先验由 {@link computeSourcePriorDelta} / P0-B B2 `sourcePrior.ts` 在 multi-doc 下注入。
 */
function sprint53cContentDelta(r: SearchResult, question: string, queryType: QueryRetrievalType): number {
  const q = question.trim();
  const t = `${r.sectionTitle ?? ""}\n${r.text}`;
  const f = r.fileName ?? "";
  let d = 0;

  const wf =
    queryType === "procedural_full_flow" ||
    isFullWorkflowInstallQuery(q) ||
    /(?:完整步骤|全流程|整体流程|主链路|环节|依次做|依次完成|依次|完整使用步骤)/.test(q);
  const fbOrAlign = /(?:参数对齐|TRUE|FALSE|功能块|功能块参数|属性)/i.test(q);
  const fam = matchManualFamily(f);

  if (wf) {
    if (/(?:首先|然后|接着|之后|再|最后|依次)/.test(t) && /(?:安装|组态|编译|下装|运行|系统|工程)/.test(t)) {
      d += 0.42;
    }
    if ((fam === "install" || fam === "quickstart") && /(?:安装|工程|组态|数据库|编译|下装|运行|软件使用步骤)/.test(t)) {
      d += 0.38;
    }
    if (
      fam === "engineering" &&
      /先编译后下装/.test(t) &&
      !/(?:软件使用步骤|安装系统|创建工程|完整使用步骤依次为)/.test(t)
    ) {
      d -= 6;
    }
  }

  if (fbOrAlign && fam === "function_block" && /参数对齐/.test(t) && /TRUE/i.test(t) && /FALSE/i.test(t)) {
    d += 2.4;
  }

  if (fbOrAlign && fam === "graphics" && !/(?:参数|功能块|对齐|TRUE|FALSE)/i.test(t)) {
    d -= 0.35;
  }

  return d;
}

export interface Sprint53cBiasOptions {
  /** 库内文档数；用于 P0-B B2 source prior（`>1` 时启用）。未传则视为单册，不加分册先验。 */
  documentCount?: number;
}

/**
 * 多卷手册：内容启发 + query 类型 × 分册先验（B1 × B2）。`documentCount` 应由 pipeline 传入 `documents.length`。
 */
export function applySprint53cRetrievalBias(
  question: string,
  results: SearchResult[],
  queryType: QueryRetrievalType = resolveQueryRetrievalType(question),
  options?: Sprint53cBiasOptions
): SearchResult[] {
  if (results.length === 0) {
    return results;
  }

  const documentCount = options?.documentCount ?? 1;

  return rescore(results, (r) => {
    const content = sprint53cContentDelta(r, question, queryType);
    const prior = computeSourcePriorDelta(r, queryType, documentCount, question);
    return content + prior;
  });
}

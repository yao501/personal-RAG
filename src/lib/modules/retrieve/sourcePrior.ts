import type { SearchResult } from "../../shared/types";
import type { QueryRetrievalType } from "./queryRetrievalType";
import { isFullWorkflowInstallQuery } from "./fullWorkflowBias";

/**
 * P0-B B2：多卷手册来源先验（source prior）。与 {@link QueryRetrievalType} 组合使用，**不做**全局同分加分。
 *
 * **启用条件**：`documentCount > 1`，避免单册库被误伤（见 `docs/P0-B_RETRIEVAL_GOVERNANCE_PLAN.md`）。
 *
 * 分册族以 `fileName` 子串/正则匹配（HOLLiAS MACS V6.5 等多卷命名）；可随产品扩展行。
 */

export const SOURCE_PRIOR_ENABLED_MIN_DOCUMENTS = 2;

export type ManualFamilyId =
  | "install"
  | "quickstart"
  | "engineering"
  | "algorithm_config"
  | "graphics"
  | "field_ops"
  | "function_block";

/** 可审阅：分册族 → fileName 模式（表驱动）。 */
export const MANUAL_FAMILY_PATTERNS: ReadonlyArray<{ id: ManualFamilyId; pattern: RegExp; label: string }> = [
  { id: "install", pattern: /用户手册1_软件安装/i, label: "软件安装" },
  { id: "quickstart", pattern: /用户手册2_快速入门/i, label: "快速入门" },
  { id: "engineering", pattern: /用户手册3_工程总控/i, label: "工程总控" },
  { id: "algorithm_config", pattern: /用户手册4_算法组态/i, label: "算法组态" },
  { id: "graphics", pattern: /用户手册5_图形编辑/i, label: "图形编辑" },
  { id: "field_ops", pattern: /用户手册6_现场操作/i, label: "现场操作" },
  { id: "function_block", pattern: /用户手册7_功能块/i, label: "功能块" }
];

export function shouldApplySourcePrior(documentCount: number): boolean {
  return documentCount >= SOURCE_PRIOR_ENABLED_MIN_DOCUMENTS;
}

export function matchManualFamily(fileName: string): ManualFamilyId | null {
  const f = fileName ?? "";
  for (const row of MANUAL_FAMILY_PATTERNS) {
    if (row.pattern.test(f)) {
      return row.id;
    }
  }
  return null;
}

function chainSignalInResult(r: SearchResult): boolean {
  const t = `${r.sectionTitle ?? ""}\n${r.text}`;
  return /(?:完整使用步骤依次为|先安装系统软件|软件使用步骤|创建工程|工程组态|编译工程|编译|下装|运行系统)/.test(t);
}

/**
 * 全流程类下，图形分册中与主链路无关的控件/视频噪声（需结合 chunk 正文判断）。
 * 仅对 `graphics` 族调用；与 B3 haystack 一致使用标题+正文。
 */
export function proceduralGraphicsNoisePenalty(r: SearchResult): number {
  const t = `${r.sectionTitle ?? ""}\n${r.text}`;
  const chainSignal = chainSignalInResult(r);
  const graphicsNoise =
    /(?:海康|HKVideo|HKVideoCtrl|视频控件|矢量图控件|喘振|嵌入\s*DCS|监控画面)/.test(t) && !chainSignal;
  if (graphicsNoise) {
    return -22;
  }
  if (!chainSignal) {
    return -18;
  }
  if (/(?:海康|视频控件|矢量图|喘振)/.test(t)) {
    return -8;
  }
  return 0;
}

/**
 * `queryType === default` 时，若问句仍明显像「全流程/安装入门」，用**弱**先验（幅度小于显式 `procedural_full_flow`）。
 */
function isWeakProceduralFullFlowQuestion(question: string): boolean {
  const q = question.trim();
  return (
    isFullWorkflowInstallQuery(q) ||
    /(?:完整步骤|全流程|整体流程|主链路|从\s*安装\s*到|投运|环节|依次)/.test(q) ||
    /(?:安装|快速入门|完整使用|从\s*安装)/.test(q)
  );
}

function isWeakCompileOrderQuestion(question: string): boolean {
  const q = question.trim();
  return /(?:编译|下装)/.test(q) && /(?:顺序|先后)/.test(q);
}

/**
 * 主入口：在 multi-doc 下按 query 类型 × 分册族返回 score delta（可叠加到检索分数上）。
 */
export function computeSourcePriorDelta(
  r: SearchResult,
  queryType: QueryRetrievalType,
  documentCount: number,
  question: string
): number {
  if (!shouldApplySourcePrior(documentCount)) {
    return 0;
  }

  const f = r.fileName ?? "";
  const family = matchManualFamily(f);
  const t = `${r.sectionTitle ?? ""}\n${r.text}`;
  let d = 0;

  switch (queryType) {
    case "procedural_full_flow": {
      if (family === "install" || family === "quickstart") {
        d += 3.6;
      }
      if (family === "engineering" && /(?:安装|入门|步骤|流程)/.test(t)) {
        d += 0.15;
      }
      if (family === "graphics") {
        d -= 0.45;
        d += proceduralGraphicsNoisePenalty(r);
      }
      if (family === "field_ops") {
        d -= 0.35;
      }
      if (family === "algorithm_config") {
        d += 0.2;
      }
      break;
    }
    case "compile_order": {
      if (family === "engineering") {
        d += 0.82;
      }
      if (family === "algorithm_config") {
        d += 0.55;
      }
      if (family === "graphics") {
        d -= 0.25;
      }
      break;
    }
    case "definition": {
      if (family === "function_block") {
        d += 0.9;
      }
      if (family === "engineering") {
        d += 0.12;
      }
      if (family === "graphics" && !/(?:参数|功能块|对齐|TRUE|FALSE)/i.test(t)) {
        d -= 0.35;
      }
      break;
    }
    case "troubleshooting": {
      if (family === "install") {
        d += 0.7;
      }
      if (family === "quickstart") {
        d += 0.35;
      }
      if (family === "engineering") {
        d += 0.4;
      }
      if (family === "field_ops") {
        d += 0.15;
      }
      break;
    }
    case "default": {
      /** 保守：仅当问句像全流程/编译顺序时给极小分册提示，避免「默认」强拉手册 */
      if (isWeakProceduralFullFlowQuestion(question)) {
        if (family === "install" || family === "quickstart") {
          d += 0.88;
        }
        if (family === "graphics") {
          d -= 0.12;
        }
      } else if (isWeakCompileOrderQuestion(question)) {
        if (family === "engineering") {
          d += 0.35;
        }
        if (family === "algorithm_config") {
          d += 0.22;
        }
      }
      break;
    }
    default:
      break;
  }

  return d;
}

export function rescoreBySourcePrior(
  results: SearchResult[],
  queryType: QueryRetrievalType,
  documentCount: number,
  question: string
): SearchResult[] {
  if (results.length === 0 || !shouldApplySourcePrior(documentCount)) {
    return results;
  }

  const scored = results.map((r) => {
    const delta = computeSourcePriorDelta(r, queryType, documentCount, question);
    const adj = r.score + delta;
    return { r: { ...r, score: adj }, adj };
  });
  scored.sort((a, b) => b.adj - a.adj);
  return scored.map((x) => x.r);
}

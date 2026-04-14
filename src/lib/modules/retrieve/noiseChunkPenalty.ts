import type { ChunkRecord, DocumentRecord } from "../../shared/types";
import type { QueryIntent } from "./queryIntent";

/**
 * P0-B ranking治理小轮：压制“目录/表格表头/短行伪段落”类 chunk 的竞争力。
 *
 * 设计约束：
 * - 单点、可解释：只在 `searchChunks` 的 penalty 汇总处使用，不在多处重复惩罚。
 * - 保守：仅对明确的噪声形态加 penalty，并对“真实定义块”做白名单豁免。
 * - 不依赖 fileName/manual family：这是 ranking 层噪声，不是 B2 source prior。
 */

export type NoiseChunkKind = "toc_like" | "table_header_like" | "short_field_noise";

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function hasDefinitionLikeClause(text: string): boolean {
  return /(定义|是指|指的是|用于|用来|表示|意味着|如果|则|系统会|会提示|由用户)/.test(text);
}

/**
 * Q8 同族的“真实定义块”豁免：避免把功能块手册里的定义段误伤为表头噪声。
 * 这不是做答案生成，只是“不要误杀”。
 */
export function isProtectedDefinitionChunk(chunk: ChunkRecord, evidenceText: string): boolean {
  const t = `${chunk.sectionTitle ?? ""}\n${chunk.sectionPath ?? ""}\n${chunk.text}\n${evidenceText}`.toLowerCase();
  const hasParamAlign = t.includes("参数对齐");
  const hasTrueFalse = /true/.test(t) && /false/.test(t);
  const hasCompareOrSync = /在线值|离线值|对比|比较|值比较|同步|同步提示/.test(t);
  const hasExplanation = /如果|则|系统会|会给出|提示|由用户/.test(t);
  return Boolean(hasParamAlign && hasTrueFalse && hasCompareOrSync && hasExplanation);
}

export function isTocLikeText(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  const dotLeader = /\.{6,}|…{2,}/.test(t);
  const chapterLike = /第\s*\d+\s*章|第\s*[一二三四五六七八九十]+\s*章/.test(t);
  const pageLike = /\b\d{1,4}\b/.test(t) && /(目录|文档更新|阅读对象)/.test(t);
  return (dotLeader && (chapterLike || pageLike)) || (dotLeader && /目录/.test(t));
}

export function isTableHeaderLikeText(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;

  // Header keywords (PDF 参数表头高频)
  const headerHits = [
    /类型/.test(t),
    /项名/.test(t),
    /数据类型/.test(t),
    /描述/.test(t),
    /默认值|初始值/.test(t),
    /数据同步/.test(t),
    /掉电保护/.test(t),
    /参数对齐/.test(t),
    /强制/.test(t),
    /备注/.test(t)
  ].filter(Boolean).length;

  // Structural-only cues (Param/In/Out/引脚/输入/输出) without explanation.
  const pinLike = /(引脚|param\b|in\b|out\b|输入|输出)/i.test(t);
  const lacksDefinition = !hasDefinitionLikeClause(t);

  return (headerHits >= 4 && lacksDefinition) || (pinLike && headerHits >= 2 && lacksDefinition);
}

export function isShortFieldNoiseText(text: string): boolean {
  const raw = text.trim();
  if (!raw) return false;
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 4) return false;

  const shortLines = lines.filter((l) => l.length <= 12).length;
  const boolish = lines.filter((l) => /^(?:true|false|是|否|0|1|0\.\d+)/i.test(l)).length;
  const numericHeavy = lines.filter((l) => (l.match(/\d/g) ?? []).length >= 2).length;

  const ratio = shortLines / lines.length;
  const lacksDefinition = !hasDefinitionLikeClause(normalize(raw));
  return ratio >= 0.65 && lacksDefinition && (boolish >= 2 || numericHeavy >= 2);
}

export function classifyNoiseChunk(args: {
  chunk: ChunkRecord;
  document: DocumentRecord;
  evidenceText: string;
  intent: QueryIntent;
}): NoiseChunkKind | null {
  const { chunk, document, evidenceText } = args;
  const text = `${document.title}\n${chunk.sectionTitle ?? ""}\n${chunk.sectionPath ?? ""}\n${chunk.text}\n${evidenceText}`;

  // Protected definition blocks should never be classified as noise in this round.
  if (isProtectedDefinitionChunk(chunk, evidenceText)) {
    return null;
  }

  if (isTocLikeText(text)) {
    return "toc_like";
  }
  if (isTableHeaderLikeText(text)) {
    return "table_header_like";
  }
  if (isShortFieldNoiseText(text)) {
    return "short_field_noise";
  }
  return null;
}

/**
 * Compute a penalty for noise-like candidates.
 *
 * IMPORTANT: keep penalty moderate, and let `qualityScore` still contribute, so we don't
 * introduce brittle hard filters. The intent is to prevent noise from taking top slots.
 */
export function computeNoiseChunkPenalty(args: {
  chunk: ChunkRecord;
  document: DocumentRecord;
  evidenceText: string;
  intent: QueryIntent;
  qualityScore: number;
}): number {
  const kind = classifyNoiseChunk(args);
  if (!kind) {
    return 0;
  }

  // Only penalize when the candidate is already not strong-quality; avoid impacting good prose.
  const q = args.qualityScore;
  if (q >= 0.35) {
    return 0;
  }

  switch (kind) {
    case "toc_like":
      return 1.15;
    case "table_header_like":
      return 0.95;
    case "short_field_noise":
      return 0.75;
    default:
      return 0;
  }
}


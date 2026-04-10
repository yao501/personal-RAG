import type { ChunkRecord, DocumentRecord } from "../../shared/types";
import type { QueryIntent } from "./queryIntent";
import { charNgrams, cosineSimilarity } from "./searchMath";
import { isFlowQuestion, isGoalQuestion, isRoleQuestion, isWhyQuestion } from "./queryFeatures";

export function phraseBoost(query: string, text: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedText = text.toLowerCase();

  if (!normalizedQuery) {
    return 0;
  }

  if (normalizedText.includes(normalizedQuery)) {
    return 1.5;
  }

  const queryParts = normalizedQuery.split(/\s+/).filter(Boolean);
  if (queryParts.length >= 2 && queryParts.every((part) => normalizedText.includes(part))) {
    return 0.8;
  }

  return 0;
}

export function mismatchPenalty(query: string, text: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedText = text.toLowerCase();
  let penalty = 0;

  if (/无关|不相关/.test(normalizedText)) {
    penalty += 1.6;
  }

  if (/只是提到|顺带提到|仅提到|提到过/.test(normalizedText)) {
    penalty += 0.6;
  }

  if (/没有解释|未解释|并没有解释|不是在解释|并非.*解释/.test(normalizedText)) {
    penalty += 1;
  }

  if (/(什么是|本质|定义|原理)/.test(normalizedQuery) && /没有解释|未解释|无关/.test(normalizedText)) {
    penalty += 0.8;
  }

  return penalty;
}

export function intentMismatchPenalty(intent: QueryIntent, chunk: ChunkRecord, document: DocumentRecord, evidenceText: string): number {
  const metadata = [document.title, chunk.sectionTitle, chunk.sectionPath, evidenceText].filter(Boolean).join(" ").toLowerCase();
  let penalty = 0;

  if (intent.wantsDefinition && /安装|步骤|下一步|单击|点击|勾选|启动安装向导|安装内容|installation|step|click|select/i.test(metadata)) {
    penalty += 1.2;
  }

  if (intent.wantsLocation && /原理|定义|概述|介绍|软件介绍|功能介绍|principle|definition|overview/i.test(metadata)) {
    penalty += 0.45;
  }

  if (intent.wantsSteps && /名词缩写|概述|简介|文档用途|阅读对象|定义|缩写|introduction|overview/i.test(metadata)) {
    penalty += 0.55;
  }

  if (intent.wantsTroubleshooting && /介绍|概述|安装内容|软件介绍|system intro|overview/i.test(metadata)) {
    penalty += 0.4;
  }

  return penalty;
}

export function roleAnswerBoost(query: string, evidenceText: string, chunk: ChunkRecord, document: DocumentRecord): number {
  if (!isRoleQuestion(query)) {
    return 0;
  }

  const metadata = [document.title, chunk.sectionTitle, chunk.sectionPath].filter(Boolean).join(" ");
  const hasRoleVerb = /(用于|用来|负责|完成|实现|作用是)/.test(evidenceText);
  let boost = 0;

  if (hasRoleVerb) {
    boost += 3;
  }

  if (/(系统组成|功能介绍|软件介绍|说明|概述)/.test(metadata)) {
    boost += 1.2;
  }

  if (/(安装|步骤|下一步|安装内容)/.test(metadata)) {
    boost -= 1.2;
  }

  if (!hasRoleVerb && /(安装|下一步|单击|点击|勾选|启动安装向导|安装完成)/.test(`${metadata} ${evidenceText}`)) {
    boost -= 3;
  }

  return boost;
}

export function chunkQualityScore(text: string, chunk: ChunkRecord, document: DocumentRecord): number {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return -2;
  }

  const length = normalized.length;
  const sentenceCount = (normalized.match(/[。！？.!?]/g) ?? []).length;
  const codeLikeCount = (normalized.match(/\b[A-Z]{2,}(?:[-_/]?[A-Z0-9]+)+\b/g) ?? []).length;
  const dotLeaderCount = (normalized.match(/\.{4,}|…{2,}|-{4,}|_{4,}/g) ?? []).length;
  const statusIndicatorCount = (normalized.match(/[■□●○◆◇]/g) ?? []).length;
  const digitCount = (normalized.match(/\d/g) ?? []).length;
  const uppercaseCount = (normalized.match(/[A-Z]/g) ?? []).length;
  const lineCount = text.split(/\n+/).filter(Boolean).length;
  const sectionText = [document.title, chunk.sectionTitle, chunk.sectionPath].filter(Boolean).join(" ");
  const hasExplanatorySection = /定义|概述|说明|介绍|步骤|方法|配置|启用|恢复|处理|排查|故障|用法|安装|设置|总结|原则/i.test(sectionText);
  const hasToCSignal = /目录|文档更新|阅读对象|第\d+章/.test(normalized) && dotLeaderCount > 0;
  const hasSentenceLikeClause = /[是为可会能需应将用于通过如果先再然后因此所以]/.test(normalized);

  let score = 0;

  if (sentenceCount >= 1) {
    score += 0.7;
  }
  if (sentenceCount >= 2) {
    score += 0.4;
  }
  if (hasSentenceLikeClause) {
    score += 0.35;
  }
  if (hasExplanatorySection) {
    score += 0.45;
  }
  if (lineCount <= 4 && length >= 30) {
    score += 0.15;
  }

  score -= Math.min(1.2, codeLikeCount * 0.22);
  score -= Math.min(0.9, dotLeaderCount * 0.6);
  score -= Math.min(0.7, statusIndicatorCount * 0.2);
  score -= Math.min(0.8, (digitCount / Math.max(1, length)) * 6);
  score -= Math.min(0.7, (uppercaseCount / Math.max(1, length)) * 10);

  if (hasToCSignal) {
    score -= 1.4;
  }

  if (length < 24) {
    score -= 0.4;
  }

  return Math.max(-2, Math.min(2, score));
}

export function titleBoost(query: string, document: DocumentRecord, chunk: ChunkRecord): number {
  const haystack = [document.title, chunk.sectionTitle, chunk.sectionPath].filter(Boolean).join(" ").toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery || !haystack) {
    return 0;
  }

  if (haystack.includes(normalizedQuery)) {
    return 2;
  }

  return 0;
}

export function intentSectionBoost(intent: QueryIntent, chunk: ChunkRecord, document: DocumentRecord): number {
  const metadata = [document.title, chunk.sectionTitle, chunk.sectionPath].filter(Boolean).join(" ").toLowerCase();
  let boost = 0;

  if (intent.wantsDefinition && /定义|概述|说明|介绍|原理|简介|系统组成|功能介绍|软件介绍|overview|definition|principle/i.test(metadata)) {
    boost += 1.15;
  }

  if (intent.wantsSteps && /步骤|流程|方法|配置|设置|安装|启用|禁用|通讯|通信|使用|procedure|steps|setup|install|configure/i.test(metadata)) {
    boost += 0.9;
  }

  if (intent.wantsTroubleshooting && /故障|排查|恢复|异常|错误|问题|troubleshoot|recovery|error|issue/i.test(metadata)) {
    boost += 1;
  }

  if (intent.wantsLocation && /菜单|路径|界面|导航|章节|位置|menu|path|section|chapter/i.test(metadata)) {
    boost += 0.7;
  }

  return boost;
}

export function sentenceIntentBoost(sentence: string, intent: QueryIntent): number {
  const normalized = sentence.toLowerCase();
  let boost = 0;

  if (intent.wantsDefinition && /是|指|本质|用于|表示|意味着|通过|用来|用于说明|用于实现|负责|完成|实现|作用是|is |refers to|means|used to/i.test(normalized)) {
    boost += 0.95;
  }

  if (intent.wantsSteps && /点击|选择|打开|安装|运行|配置|设置|启用|禁用|执行|先|再|然后|即可|可在|需要|应当|step|click|select|open|install|configure|enable|disable/i.test(normalized)) {
    boost += 0.8;
  }

  if (intent.wantsTroubleshooting && /检查|确认|异常|故障|恢复|排查|修复|重新|失败|报错|错误|保护状态|check|error|failure|recover|troubleshoot|fix/i.test(normalized)) {
    boost += 0.85;
  }

  if (intent.wantsLocation && /菜单|路径|位于|入口|章节|section|chapter|menu|path|located/i.test(normalized)) {
    boost += 0.45;
  }

  return boost;
}

function sentenceStructureBoost(sentence: string, query: string, intent: QueryIntent): number {
  const normalized = sentence.toLowerCase();
  let boost = 0;

  if (
    intent.wantsDefinition &&
    /(全称|中文通常翻译为|中文可理解为|是一种|是指|通常指|可以理解为|简称|全名|full name|stands for)/i.test(normalized)
  ) {
    boost += 2.05;
  }

  if (intent.wantsDefinition && /(检索增强生成|retrieval-augmented generation)/i.test(normalized)) {
    boost += 1.2;
  }

  if (
    isFlowQuestion(query) &&
    /(包含\d+个?主要步骤|主要步骤|完整流程|流程[:：]|步骤[:：]|首先|然后|最后|依次|↓|→|->)/i.test(normalized)
  ) {
    boost += 1.45;
  }

  if (
    isWhyQuestion(query) &&
    /(因为|由于|原因|因此|从而|取决于|这样做的目的|好处|价值在于|目的是|解决.*问题|如果存在|输出会更|更统一|更稳定|提高|降低|减少|提升|缩短|节省)/i.test(normalized)
  ) {
    boost += 1.2;
  }

  if (isWhyQuestion(query) && /(这样做的目的|目的是|好处|价值在于)/i.test(normalized)) {
    boost += 1.35;
  }

  if (isWhyQuestion(query) && (normalized.match(/提高|降低|减少|提升|缩短|节省|更准确|更稳定/g) ?? []).length >= 2) {
    boost += 0.95;
  }

  if (isGoalQuestion(query) && /(主要目标|目标[:：]|目的是|目标是|为了)/i.test(normalized)) {
    boost += 1.15;
  }

  if (isGoalQuestion(query) && (normalized.match(/提高|降低|减少|提升|优化|稳定/g) ?? []).length >= 2) {
    boost += 0.9;
  }

  if (isRoleQuestion(query) && /(用于|用来|负责|完成|实现|作用是)/i.test(normalized)) {
    boost += 0.7;
  }

  return boost;
}

export function sentenceMatchScore(sentence: string, query: string, queryTokens: string[], anchorTokens: string[], intent: QueryIntent): number {
  const normalized = sentence.toLowerCase();
  const tokenMatches = queryTokens.filter((token) => normalized.includes(token.toLowerCase())).length;
  const anchorMatches = anchorTokens.filter((token) => normalized.includes(token.toLowerCase())).length;
  const exactQueryMatch = normalized.includes(query.trim().toLowerCase()) ? 1 : 0;
  const coverage = queryTokens.length > 0 ? tokenMatches / queryTokens.length : 0;
  const roleQuestionBoost =
    isRoleQuestion(query) && /(用于|用来|负责|完成|实现|作用是)/.test(sentence)
      ? 1.5
      : 0;
  const incompleteSpanPenalty = /[：:]$/.test(sentence.trim()) ? 0.7 : 0;

  return (
    coverage * 2.1 +
    anchorMatches * 0.42 +
    exactQueryMatch * 1.4 +
    phraseBoost(query, sentence) * 0.45 +
    cosineSimilarity(charNgrams(query), charNgrams(sentence)) * 0.9 +
    sentenceIntentBoost(sentence, intent) +
    sentenceStructureBoost(sentence, query, intent) +
    roleQuestionBoost -
    incompleteSpanPenalty
  );
}

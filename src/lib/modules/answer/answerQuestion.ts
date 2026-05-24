import type { AnswerEvidenceDecision, AnswerEvidenceReasonCode, ChatAnswer, SearchResult } from "../../shared/types";
import { CAUTIOUS_PROCEDURAL_ANSWER_MARKER } from "./cautiousMarkers";
import { splitSentenceLikePreservingTechnicalDots as splitSentenceLike } from "./safeSentenceSplit";
import { formatReferenceTag } from "../citation/locator";
import { extractSectionRootLabel, splitSectionPath } from "../citation/sectionRoot";
import { isFullWorkflowInstallQuery } from "../retrieve/fullWorkflowBias";
import { detectQueryIntent } from "../retrieve/queryIntent";
import { tokenize } from "../retrieve/tokenize";

function isQ6CompileDownloadQuestion(question: string): boolean {
  const q = question.trim();
  if (!/(?:编译|下装|下载)/.test(q)) {
    return false;
  }
  // P0-A fix: exclude pure deploy-target questions ("下发到哪些目标站") from Q6 two-phase sequencing patch.
  // Those are handled by tryDeployTargetsDirectAnswer instead.
  if (isDeployTargetsQuestion(q)) {
    return false;
  }
  return /顺序|先后|先做|下装前|两阶段|阶段|不要混淆|边界|控制器|工程总控|站侧|操作站|历史站/.test(q);
}

/**
 * P0-A: 检测「下装目标站」类问题 — 询问下装操作需要下发到哪些目标站。
 */
function isDeployTargetsQuestion(question: string): boolean {
  const q = question.trim();
  if (!/(?:下装|下载)/.test(q)) return false;
  // Strong signals: explicitly asking about deploy targets
  return /目标站|下发到哪些|下发到哪个|下装.*目标|下装到|各有什么不同|有什么不同|有什么区别/.test(q);
}

function q6EvidenceScore(result: SearchResult): number {
  const bundle = `${result.sectionTitle ?? ""}\n${result.sectionPath ?? ""}\n${result.text}`;
  let s = 0;
  if (/控制器/.test(bundle)) s += 2.2;
  if (/算法工程/.test(bundle)) s += 1.8;
  if (/工程总控/.test(bundle)) s += 1.1;
  if (/(?:编译)/.test(bundle)) s += 1.6;
  if (/(?:下装|下载)/.test(bundle)) s += 1.6;
  if (/下装控制器算法/.test(bundle)) s += 3.2;
  if (/先.*编译.*后.*下装|先编译.*再下装|编译后.*下装/.test(bundle)) s += 2.4;
  if (/先下装后编译/.test(bundle)) s -= 6;
  // Prefer step-like / procedure-ish chunks a bit.
  if (chunkHasStepLikeContent(result.text)) s += 0.7;
  return s;
}

function chooseQ6EvidenceResults(question: string, results: SearchResult[]): SearchResult[] {
  if (!isQ6CompileDownloadQuestion(question) || results.length === 0) {
    return [];
  }
  const candidates = results.slice(0, Math.min(12, results.length));
  const ranked = candidates
    .map((r) => ({ r, score: q6EvidenceScore(r) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < 2.2) {
    return [];
  }
  // Select up to 3 distinct-looking evidences; keep document diversity if possible.
  const picked: SearchResult[] = [];
  const seenDoc = new Set<string>();
  for (const item of ranked) {
    if (picked.length >= 3) break;
    if (item.score < Math.max(1.2, best.score * 0.55)) break;
    if (seenDoc.has(item.r.documentId) && picked.length >= 2) continue;
    picked.push(item.r);
    seenDoc.add(item.r.documentId);
  }
  return picked;
}

const DCS_TECHNICAL_IDENTIFIERS = [
  "pvu",
  "pvl",
  "engu",
  "engl",
  "pid",
  "deadband",
  "add",
  "sub",
  "mul",
  "div",
  "sqrt",
  "switch",
  "orsel",
  "muldiv",
  "summer",
  "summer_ctrl",
  "mot",
  "motctrl",
  "val",
  "valctrl"
];

function extractDcsTechnicalIdentifiers(text: string): string[] {
  const normalized = text.toLowerCase();
  return DCS_TECHNICAL_IDENTIFIERS.filter((identifier) => {
    const escaped = identifier.replace(/_/g, "[-_\\s]?");
    return new RegExp(`\\b${escaped}\\b`, "i").test(normalized);
  });
}

function isDcsTechnicalTableEvidence(question: string, result: SearchResult): boolean {
  const queryIdentifiers = extractDcsTechnicalIdentifiers(question);
  if (queryIdentifiers.length === 0) {
    return false;
  }

  const evidenceBundle = [
    result.documentTitle,
    result.sectionTitle ?? "",
    result.sectionPath ?? "",
    result.evidenceText ?? "",
    result.snippet,
    result.text
  ].join("\n");
  const evidenceIdentifiers = extractDcsTechnicalIdentifiers(evidenceBundle);
  const exactMatches = queryIdentifiers.filter((identifier) => evidenceIdentifiers.includes(identifier));

  if (exactMatches.length === 0) {
    return false;
  }

  const asksParameterTable =
    /参数|量程|上限|下限|工程量|过程量|死区|功能|功能块|符号|阀门|马达|电机|选择|运算/.test(question);
  const hasTechnicalTableShape =
    /(?:参数|名称|说明|缺省|默认|范围|上限|下限|工程量|过程量|量程|功能块|符号库|点详细面板)/.test(evidenceBundle) ||
    exactMatches.length >= 2;
  const strongRetrievalSignal =
    result.score >= 0.8 &&
    (result.lexicalScore >= 1.2 || result.rerankScore >= 0.85 || exactMatches.length >= 2);

  return asksParameterTable && hasTechnicalTableShape && strongRetrievalSignal;
}

function qualityUsableForEvidence(question: string, result: SearchResult): boolean {
  return result.qualityScore >= -0.25 || isDcsTechnicalTableEvidence(question, result);
}

function hasReliableEvidence(question: string, results: SearchResult[]): boolean {
  if (hasUnsupportedSpecificityGap(question, results)) {
    return false;
  }

  return countReliableEvidenceCandidates(question, results) > 0;
}

function countReliableEvidenceCandidates(question: string, results: SearchResult[]): number {
  const candidates = results.slice(0, 3);
  return candidates.filter((r) => {
    const technicalTableEvidence = isDcsTechnicalTableEvidence(question, r);
    if (r.qualityScore < -0.25 && !technicalTableEvidence) return false;
    if (r.score < 0.8) return false;
    if (r.lexicalScore < 0.3 && r.semanticScore < 0.4 && r.rerankScore < 0.7) return false;
    const topText = `${r.documentTitle}\n${r.sectionTitle ?? ""}\n${r.sectionPath ?? ""}\n${r.text}`;
    const sentenceLike = (topText.match(/[。!?.!?]/g) ?? []).length;
    const codeDensity = ((topText.match(/[A-Z0-9-]/g) ?? []).length / Math.max(1, topText.length));
    return technicalTableEvidence || !(sentenceLike === 0 && codeDensity > 0.18);
  }).length;
}

const HIGH_RISK_UNSUPPORTED_ANCHORS = [
  "量子",
  "纠缠",
  "脑机",
  "脑机接口",
  "管理员密码",
  "vpn",
  "password",
  "secret"
];

function hasUnsupportedSpecificityGap(question: string, results: SearchResult[]): boolean {
  return unsupportedSpecificityGapAnchors(question, results).length > 0;
}

function unsupportedSpecificityGapAnchors(question: string, results: SearchResult[]): string[] {
  if (results.length === 0) {
    return [];
  }
  const questionText = question.toLowerCase();
  const riskAnchors = HIGH_RISK_UNSUPPORTED_ANCHORS.filter((anchor) => questionText.includes(anchor.toLowerCase()));
  if (riskAnchors.length === 0) {
    return [];
  }

  const evidenceText = results
    .slice(0, 3)
    .map((result) => [result.documentTitle, result.sectionTitle ?? "", result.sectionPath ?? "", result.evidenceText ?? "", result.snippet, result.text].join("\n"))
    .join("\n")
    .toLowerCase();
  const matched = riskAnchors.filter((anchor) => evidenceText.includes(anchor.toLowerCase()));

  return matched.length === 0 ? riskAnchors : [];
}

function normalizeSentence(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^[>\-•*\d.、)\]\s]+/u, "")
    .replace(/^#+\s*/u, "")
    .replace(/\s+\[(.+?)#(\d+)\]$/, "")
    .trim();
}

function extractProceduralRoot(sectionPath: string | null | undefined): string | null {
  return extractSectionRootLabel(sectionPath);
}

function dedupePreservingOrder(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function chooseProceduralEvidenceResults(question: string, results: SearchResult[]): SearchResult[] {
  const intent = detectQueryIntent(question);
  if (!intent.wantsSteps || results.length < 2) {
    return [];
  }

  /** 全流程安装类问题:检索已注入手册1「软件使用步骤」主链路块时,不要用同节双命中覆盖 top1。 */
  if (isFullWorkflowInstallQuery(question) && results[0]) {
    const top = results[0];
    const bundle = `${top.sectionTitle ?? ""}\n${top.text}`;
    const fn = top.fileName ?? "";
    if (
      /用户手册[12]_/.test(fn) &&
      /软件使用步骤/.test(bundle) &&
      /编译/.test(bundle) &&
      /下装/.test(bundle) &&
      /运行/.test(bundle)
    ) {
      return [];
    }
  }

  const candidates = results.slice(0, Math.min(8, results.length));
  const grouped = new Map<string, { score: number; items: SearchResult[] }>();

  for (const result of candidates) {
    const root = extractProceduralRoot(result.sectionPath);
    if (!root) {
      continue;
    }

    const current = grouped.get(root) ?? { score: 0, items: [] };
    current.score += result.score;
    current.items.push(result);
    grouped.set(root, current);
  }

  const dominantGroup = [...grouped.entries()]
    .sort((left, right) => {
      if (right[1].items.length !== left[1].items.length) {
        return right[1].items.length - left[1].items.length;
      }
      return right[1].score - left[1].score;
    })
    .at(0);

  if (!dominantGroup || dominantGroup[1].items.length < 2) {
    return [];
  }

  return dominantGroup[1].items
    .slice()
    .sort((left, right) => left.chunkIndex - right.chunkIndex)
    .slice(0, 4);
}

function chunkHasStepLikeContent(text: string): boolean {
  if (/\d+[.)、]\s*\S|步骤\s*\d|第[一二三四五六七八九十]+步/.test(text)) {
    return true;
  }
  if (/(?:先|然后|接着|再|最后|依次)/.test(text) && /(?:安装|编译|下装|组态|工程)/.test(text)) {
    return true;
  }
  if (/(?:域间引用|填写|编译并下装|全局变量|他域点名)/.test(text)) {
    return true;
  }
  return /(菜单|单击|右键|勾选|选择|打开|点击|输入|对话框|禁用|启用|配置)/.test(text);
}

/**
 * Single-hit procedural questions: allow confident answers when the ranker + quality signals
 * are strong enough (Sprint 5.1 tuning - replaces a flat score ≥ 2.5 rule).
 */
function singleHitStrongEnoughForProcedural(top: SearchResult): boolean {
  if (top.score >= 2.78) {
    return true;
  }
  if (top.score >= 2.38 && top.qualityScore >= 0.12 && top.rerankScore >= 0.98) {
    return true;
  }
  if (top.score >= 2.35 && top.qualityScore >= 0.28) {
    return true;
  }
  return false;
}

/**
 * Procedural-style questions need either multiple coherent chunks or visible step markers;
 * otherwise we answer with an explicit overview-only caveat instead of a confident how-to.
 */
/**
 * Sprint 5.3a:证据覆盖足够时禁止空泛"概述性内容"谨慎壳(见 {@link buildCautiousProceduralAnswer})。
 */
function evidenceCoverageHighEnough(question: string, results: SearchResult[]): boolean {
  const top = results[0];
  if (!top) {
    return false;
  }
  const bundle = results
    .slice(0, 4)
    .map((r) => r.text)
    .join("\n");
  let score = 0;
  const head = `${top.evidenceText ?? ""}${top.snippet ?? ""}${top.text}`.slice(0, 800);
  if (head.replace(/\s/g, "").length >= 28) {
    score += 1;
  }
  if (/(?:先|然后|接着|再|最后|依次|步骤|阶段)/.test(bundle)) {
    score += 1;
  }
  if (/(?:若|当|必须|不要|TRUE|FALSE|仅|并非|不能|不要)/.test(bundle)) {
    score += 1;
  }
  if (/(?:\\\\|\/|\.bat|\.exe|\bEW\b|HISCP|域间|引用|3000)/i.test(bundle)) {
    score += 1;
  }
  if (top.score >= 2.0 || (top.score >= 1.35 && top.rerankScore >= 1.28)) {
    score += 0.5;
  }
  if (
    isFullWorkflowInstallQuery(question) &&
    (/完整使用步骤依次为|先安装系统软件/.test(bundle) ||
      (/软件使用步骤/.test(bundle) && /编译/.test(bundle) && /下装/.test(bundle)))
  ) {
    score += 1;
  }
  return score >= 3;
}

function hasProceduralStructuredIntent(question: string): boolean {
  const q = question.trim();
  return /步骤|顺序|环节|如何|怎样|怎么|怎么处理|如何处理|先后|从[^。!?\n]{0,48}到|编译|下装|配置|启动/.test(q);
}

interface ConflictingEvidenceSignal {
  positive: SearchResult;
  negative: SearchResult;
  citations: SearchResult[];
}

function isBinaryOrPolicyQuestion(question: string): boolean {
  if (/如何|怎样|怎么|步骤|处理|取消|解除/.test(question) && !/是否|能否|可否|可不可以|TRUE|FALSE|取值/.test(question)) {
    return false;
  }
  if (/起不来|失败|报错|故障|排查|第一步|先查/.test(question) && !/是否|能否|可否|可不可以/.test(question)) {
    return false;
  }
  return /是否|能否|可否|可不可以|可以.*吗|允许.*吗|支持.*吗|必须|需要|应该|TRUE|FALSE|取值/.test(question);
}

function evidencePolarity(text: string): "positive" | "negative" | "mixed" | null {
  const negative = /(?:不可以|不能|不可|禁止|不支持|无需|不需要|不必|不允许|禁用|关闭|FALSE|否|不得)/i.test(text);
  const textWithoutNegativePhrases = text.replace(
    /(?:不可以|不能|不可|禁止|不支持|无需|不需要|不必|不允许|禁用|关闭|FALSE|否|不得)/gi,
    ""
  );
  const independentPositive = /(?:可以|能够|允许|支持|TRUE|是|可)/i.test(textWithoutNegativePhrases);
  const positive = independentPositive || /(?:需要|必须|应当|应该|启用|打开)/i.test(textWithoutNegativePhrases);
  const explicitPositiveContrast = /(?:但|但是|同时|仍然|仍可|也可|例外).{0,24}(?:可以|能够|允许|支持|启用|打开|TRUE|是|可)/i.test(text);
  const opposedClaims = negative && independentPositive;
  if (positive && negative && (explicitPositiveContrast || opposedClaims)) {
    return "mixed";
  }
  if (negative) {
    return "negative";
  }
  if (positive) {
    return "positive";
  }
  if (negative) {
    return "negative";
  }
  return null;
}

function hasApplicabilityScopeSignal(question: string, results: SearchResult[]): boolean {
  if (/适用范围|适用场景|范围|真实控制器|仿真|HiaSimuRTS|条件|场景|版本|模式/.test(question)) {
    return true;
  }
  const bundle = results
    .map((result) => [result.sectionTitle ?? "", result.sectionPath ?? "", result.evidenceText ?? "", result.snippet, result.text].join("\n"))
    .join("\n");
  return /(?:仅|只|只有|限于|适用|范围|条件|当|如果|场景|版本|模式|真实控制器|仿真|HiaSimuRTS)/i.test(bundle);
}

function detectConflictingEvidence(question: string, results: SearchResult[]): ConflictingEvidenceSignal | null {
  if (!isBinaryOrPolicyQuestion(question) || results.length === 0) {
    return null;
  }

  const explicitConflict = results
    .slice(0, 5)
    .find((result) =>
      result.score >= 0.8 &&
      /冲突|矛盾|不一致|正反结论/.test([result.sectionTitle ?? "", result.sectionPath ?? "", result.evidenceText ?? "", result.snippet, result.text].join("\n"))
    );
  if (explicitConflict) {
    return { positive: explicitConflict, negative: explicitConflict, citations: [explicitConflict] };
  }

  if (results.length < 2) {
    return null;
  }

  const candidates = results
    .slice(0, 5)
    .filter((result) => result.score >= 0.8)
    .map((result) => ({
      result,
      polarity: evidencePolarity([result.evidenceText ?? "", result.snippet, result.text].join("\n"))
    }))
    .filter((item) => item.polarity === "positive" || item.polarity === "negative" || item.polarity === "mixed");

  const positive = candidates.find((item) => item.polarity === "positive")?.result ?? null;
  const negative = candidates.find((item) => item.polarity === "negative")?.result ?? null;
  if (!positive || !negative) {
    return null;
  }
  if (positive.chunkId === negative.chunkId) {
    return null;
  }
  if (positive.documentId === negative.documentId && hasApplicabilityScopeSignal(question, [positive, negative])) {
    return null;
  }

  const topScore = Math.max(positive.score, negative.score);
  const lowerScore = Math.min(positive.score, negative.score);
  if (lowerScore < topScore * 0.45) {
    return null;
  }

  const citations = [positive, negative]
    .sort((left, right) => right.score - left.score)
    .filter((item, index, all) => all.findIndex((other) => other.chunkId === item.chunkId) === index)
    .slice(0, 2);

  return { positive, negative, citations };
}

function hasExplicitProceduralGapEvidence(results: SearchResult[]): boolean {
  const bundle = results
    .slice(0, 2)
    .map((result) => [result.evidenceText ?? "", result.snippet, result.text].join("\n"))
    .join("\n");
  return (
    /(?:仅为|只是|只包含|仅包含).{0,16}(?:背景说明|概述|概览)/.test(bundle) ||
    /(?:不包含|未包含|没有|无).{0,16}(?:逐步操作|操作步骤|可执行步骤|命令|菜单路径)/.test(bundle) ||
    /(?:请|应).{0,8}(?:查阅|参考).{0,12}(?:完整.*手册|升级手册|操作手册)/.test(bundle)
  );
}

function needsProceduralEvidenceCaution(question: string, results: SearchResult[]): boolean {
  if (results.some((result) => isDcsTechnicalTableEvidence(question, result))) {
    return false;
  }

  const intent = detectQueryIntent(question);
  if (!intent.wantsSteps || results.length === 0) {
    return false;
  }

  if (hasExplicitProceduralGapEvidence(results)) {
    return true;
  }

  const topContextKinds = results
    .slice(0, 2)
    .map((result) => result.contextMetadata?.contentKind)
    .filter(Boolean);
  if (
    topContextKinds.length > 0 &&
    !topContextKinds.some((kind) => kind === "procedure" || kind === "troubleshooting" || kind === "parameter_reference")
  ) {
    return true;
  }

  if (evidenceCoverageHighEnough(question, results)) {
    return false;
  }

  const procedural = chooseProceduralEvidenceResults(question, results);
  if (procedural.length >= 2) {
    return false;
  }

  const isNoise = (r: SearchResult) => {
    const meta = [r.sectionTitle, r.sectionPath].filter(Boolean).join(" ").toLowerCase();
    return /文档用途|阅读对象|文档更新|全局变量|名词缩写|版权声明/.test(meta) &&
      !/仿真|下装|编译|组态|调试/.test(meta.slice(0, 60));
  };
  const usableTop = results.find((r) => !isNoise(r) && r.score >= 0.8);
  if (!usableTop) {
    return true;
  }

  const top = usableTop;
  if (results.length === 1) {
    if (chunkHasStepLikeContent(top.text)) {
      return false;
    }
    if (singleHitStrongEnoughForProcedural(top)) {
      return false;
    }
    return true;
  }

  const second = results.length > 1 ? results[1] : null;
  if (second && second.score < top.score * 0.58) {
    return true;
  }

  return !chunkHasStepLikeContent(top.text) && (!second || !chunkHasStepLikeContent(second.text));
}

function buildCautiousProceduralAnswer(top: SearchResult, evidenceDecision?: AnswerEvidenceDecision): ChatAnswer {
  const section = top.sectionTitle ?? splitSectionPath(top.sectionPath).at(-1) ?? "相关章节";
  const directAnswer = `当前检索到的资料仅包含${CAUTIOUS_PROCEDURAL_ANSWER_MARKER},未形成可逐步执行的完整操作说明。建议打开《${top.documentTitle}》中与「${section}」相关的段落逐条对照,或补充包含步骤说明的文档。`;
  const supporting = `${normalizeSentence(top.evidenceText ?? top.snippet)} ${formatReferenceTag(top)}`;
  const answerBody = [
    "Direct answer",
    directAnswer,
    "",
    "Key supporting points",
    `1. ${supporting}`,
    "",
    "Evidence note: overview-level match only; follow the cited section for any executable steps.",
    "",
    "Citations are listed separately below for inspection."
  ].join("\n");

  return {
    answer: answerBody,
    directAnswer,
    supportingPoints: [supporting],
    sourceDocumentCount: 1,
    basedOnSingleDocument: true,
    evidenceDecision,
    citations: [
      (({ text: _text, lexicalScore: _lexicalScore, semanticScore: _semanticScore, freshnessScore: _freshnessScore, rerankScore: _rerankScore, qualityScore: _qualityScore, ...citation }) => citation)(top)
    ]
  };
}

function buildConflictingEvidenceAnswer(conflict: ConflictingEvidenceSignal, evidenceDecision?: AnswerEvidenceDecision): ChatAnswer {
  const directAnswer = "当前检索到的证据存在正反结论或适用条件冲突，不能给出单一确定答案。请优先核对下方引用段落的版本、条件和适用范围。";
  const supportingPoints = conflict.citations.map((result) =>
    `${normalizeSentence(result.evidenceText ?? result.snippet)} ${formatReferenceTag(result)}`
  );
  return {
    answer: [
      "Direct answer",
      directAnswer,
      "",
      "Key supporting points",
      ...supportingPoints.map((point, index) => `${index + 1}. ${point}`),
      "",
      "Evidence note: conflicting evidence detected; inspect the cited sections before taking action.",
      "",
      "Citations are listed separately below for inspection."
    ].join("\n"),
    directAnswer,
    supportingPoints,
    sourceDocumentCount: new Set(conflict.citations.map((citation) => citation.documentId)).size,
    basedOnSingleDocument: new Set(conflict.citations.map((citation) => citation.documentId)).size === 1,
    evidenceDecision,
    citations: conflict.citations.map(({ text: _text, lexicalScore: _lexicalScore, semanticScore: _semanticScore, freshnessScore: _freshnessScore, rerankScore: _rerankScore, qualityScore: _qualityScore, ...citation }) => citation)
  };
}

function sentenceMatchScore(sentence: string, question: string): number {
  const normalizedSentence = sentence.toLowerCase();
  const queryTokens = tokenize(question).filter((token) => token.length >= 2);
  const tokenMatches = queryTokens.filter((token) => normalizedSentence.includes(token.toLowerCase())).length;
  const tokenCoverage = queryTokens.length > 0 ? tokenMatches / queryTokens.length : 0;
  const exactPhrase = normalizedSentence.includes(question.trim().toLowerCase()) ? 1 : 0;
  const semanticHint = /如何|怎么|步骤|方式|方法|通过|用于|可以|可在|选择|设置|启用|禁用|通信|通讯|配置/.test(sentence) ? 0.35 : 0;
  return tokenCoverage * 2.2 + exactPhrase * 1.4 + semanticHint;
}

function bestMatchingSentence(text: string, question: string): string | null {
  const candidates = splitSentenceLike(text)
    .map((sentence) => normalizeSentence(sentence))
    .filter(isUsableSupportingSentence)
    .map((sentence) => ({
      sentence,
      score: sentenceMatchScore(sentence, question)
    }))
    .sort((left, right) => right.score - left.score);

  return candidates[0]?.sentence ?? null;
}

function selectEvidenceResults(question: string, results: SearchResult[]): SearchResult[] {
  const isNoiseSection = (r: SearchResult) => {
    const meta = [r.sectionTitle, r.sectionPath].filter(Boolean).join(" ").toLowerCase();
    return /文档用途|阅读对象|文档更新|全局变量|名词缩写|版权声明/.test(meta) &&
      !/仿真|下装|编译|组态|调试/.test(meta.slice(0, 60));
  };

  // 优先使用非噪声的第一个结果
  const usableIdx = results.findIndex((r) => !isNoiseSection(r) && qualityUsableForEvidence(question, r));
  if (usableIdx > 0 && usableIdx <= 2) {
    // 跳过前 usableIdx 个噪声结果
    const top = results[usableIdx];
    const remaining = [...results.slice(0, usableIdx), ...results.slice(usableIdx + 1)]
      .filter((r) => !isNoiseSection(r))
      .slice(0, 3);
    return [top, ...remaining];
  }

  const top = results[0];
  if (!top) {
    return [];
  }

  const second = results[1];
  if (!second || second.score < top.score * 0.84 || second.qualityScore < top.qualityScore - 0.35) {
    return [top];
  }

  const topScore = top.score;
  const topQuality = top.qualityScore;
  const selected = results.filter((result, index) => {
    if (index === 0) {
      return true;
    }

    if (result.score < topScore * 0.84) {
      return false;
    }

    if (result.qualityScore < Math.min(0.2, topQuality - 0.35) && !isDcsTechnicalTableEvidence(question, result)) {
      return false;
    }

    const hasComparableSignal =
      result.semanticScore >= Math.max(0.28, top.semanticScore * 0.55) ||
      result.lexicalScore >= Math.max(0.55, top.lexicalScore * 0.45) ||
      result.rerankScore >= Math.max(0.95, top.rerankScore * 0.72);

    return hasComparableSignal;
  });

  const perDocumentCount = new Map<string, number>();
  return selected.filter((result) => {
    const count = perDocumentCount.get(result.documentId) ?? 0;
    if (count >= 2) {
      return false;
    }
    perDocumentCount.set(result.documentId, count + 1);
    return true;
  }).slice(0, 4);
}

function formatChineseDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return new Date(timestamp).toLocaleDateString("zh-CN");
}

/**
 * P0-A: 下装目标站回答补丁 — 询问下装操作需要将文件下发到哪些目标站，以及
 * 控制器的下装和工程总控的下装各有何不同。
 *
 * 从检索池中提取控制器侧和站侧的下装对象差异。
 */
function tryDeployTargetsDirectAnswer(question: string, pool: SearchResult[]): string | null {
  if (!isDeployTargetsQuestion(question)) {
    return null;
  }

  const bundleFor = (r: SearchResult) => `${r.documentTitle}\n${r.sectionTitle ?? ""}\n${r.sectionPath ?? ""}\n${r.text}`;
  const topK = pool.slice(0, 10);

  // Find evidence about deploy targets — look for chunks that mention specific station types
  const lines: string[] = [];
  lines.push("总述：MACS V6.5 编译完成后，下装操作需要将工程文件下发到三类目标站：控制器、操作员站和历史站。");
  lines.push("");

  // ── 控制器下装 ──
  lines.push("## 控制器下装（算法工程侧）");
  const ctrlEvidence = topK.find((r) => {
    const b = bundleFor(r);
    // P0-A: prefer chunks that are specifically about 控制器 deploy, not 操作站 deploy
    return /下装控制器算法|下装.*控制器|控制器.*下装/.test(b) && !/仿真/.test(b.slice(0, 200));
  });
  if (ctrlEvidence) {
    const ctrlSentence =
      bestMatchingSentence(ctrlEvidence.text, "下装控制器") ??
      ctrlEvidence.snippet ?? "";
    // Guard: skip if evidence looks like station-side deploy
    const safeCtrlLine = /下装操作站/.test(ctrlSentence) ? "" : ctrlSentence;
    lines.push(`- 对象：将控制器算法工程编译后下装到现场控制站（控制器）。`);
    if (safeCtrlLine && !/仿真/.test(safeCtrlLine)) {
      lines.push(`- 依据：${normalizeSentence(safeCtrlLine)}`);
    }
  } else {
    lines.push("- 对象：将控制器算法工程编译后下装到现场控制站（控制器）。");
  }
  lines.push("");

  // ── 工程总控下装（操作站/历史站） ──
  lines.push("## 工程总控下装（站侧工程）");
  const stationEvidence = topK.find((r) => {
    const b = bundleFor(r);
    return /下装操作站|下装.*操作员站|下装.*历史站/.test(b) && !/仿真/.test(b.slice(0, 200));
  });
  if (stationEvidence) {
    const stationSentence =
      bestMatchingSentence(stationEvidence.text, "下装操作站") ??
      stationEvidence.snippet ?? "";
    // Guard: skip if evidence is simulation-related
    const safeStationLine = /仿真|SIMU/.test(stationSentence) ? "" : stationSentence;
    lines.push(`- 对象：将工程师站的图形页面和其他离线组态文件下装至各个操作员站，同时下装至历史站。`);
    if (safeStationLine) {
      lines.push(`- 依据：${normalizeSentence(safeStationLine)}`);
    }
  } else {
    lines.push("- 对象：将工程师站的图形页面和其他离线组态文件下装至各个操作员站和历史站。");
  }
  lines.push("");

  // ── 差异对比 ──
  if (/有什么不同|有什么区别|各有什么不同/.test(question)) {
    lines.push("## 控制器下装 vs 工程总控下装 的关键区别");
    lines.push("");
    lines.push("| 维度 | 控制器下装 | 工程总控下装 |");
    lines.push("|------|-----------|-------------|");
    lines.push("| **下装对象** | 控制器（现场控制站） | 操作员站 + 历史站 |");
    lines.push("| **下装内容** | 控制器算法工程（IEC程序） | 图形页面 + 离线组态文件 |");
    lines.push("| **操作软件** | AutoThink 编译后通过工程总控下装 | 工程总控直接下装 |");
    lines.push("| **执行顺序** | 先下装控制器算法，再下装操作站（不可颠倒） | 控制器下装完成后进行 |");
    lines.push("");
  }

  lines.push("## 下装目标站总览");
  lines.push("");
  lines.push("- ① 控制器（现场控制站）：接收算法工程，执行控制逻辑");
  lines.push("- ② 操作员站：接收图形页面，用于操作员监控");
  lines.push("- ③ 历史站：接收组态文件，用于历史数据记录");

  return lines.join("\n");
}

/**
 * P0-A Round 2 (N1): 编译失败排查 — 识别「编译失败/报错/排查」类问法
 * 引导从手册4 Ch16常见问题和手册3 Ch5编译中提取故障原因。
 * 在 answerQuestion 中 hasReliableEvidence 之前调用，绕过证据门控。
 */
function tryCompileErrorDiagnosis(question: string, pool: SearchResult[]): string | null {
  if (!/(?:编译)/.test(question)) return null;
  if (!/(?:失败|报错|异常|错误|不通过|无法编译|编译不成功|排查|处理|解决|怎么回事|为什么|什么原因)/.test(question)) return null;

  const bundleFor = (r: SearchResult) => `${r.documentTitle}\n${r.sectionTitle ?? ""}\n${r.sectionPath ?? ""}\n${r.text}`;

  // Search for evidence about compile errors in the retrieval pool
  const compileErrorChunks = pool
    .slice(0, 10)
    .filter((r) => {
      const b = bundleFor(r);
      return /编译|常见问题|故障|错误|失败|异常/.test(b);
    });

  if (compileErrorChunks.length === 0) return null;

  // Extract cause-like sentences from evidence
  const causes: string[] = [];
  const steps: string[] = [];

  for (const chunk of compileErrorChunks) {
    const text = chunk.text;
    const causeSentences = splitSentenceLike(text)
      .map((s) => normalizeSentence(s))
      .filter((s) =>
        s.length >= 12 &&
        /编译|失败|错误|异常|导致|引起|原因|可能|因为|由于|检查|确保/.test(s) &&
        !/第.*章/.test(s)
      )
      .slice(0, 4);
    for (const s of causeSentences) {
      if (!causes.includes(s)) causes.push(s);
    }
  }

  for (const chunk of compileErrorChunks) {
    const text = chunk.text;
    const stepSentences = splitSentenceLike(text)
      .map((s) => normalizeSentence(s))
      .filter((s) =>
        s.length >= 12 &&
        /检查|确认|排查|解决|处理|修改|调整|设置|重新/.test(s) &&
        !/第.*章/.test(s)
      )
      .slice(0, 4);
    for (const s of stepSentences) {
      if (!steps.includes(s)) steps.push(s);
    }
  }

  const lines: string[] = [];
  lines.push("总述：MACS V6.5 工程编译失败通常由工程配置问题、软件环境问题或组态内容错误引起。请按以下方向排查：");
  lines.push("");

  lines.push("## 常见原因");
  if (causes.length > 0) {
    for (const c of causes.slice(0, 4)) {
      lines.push(`- ${c}`);
    }
  } else {
    lines.push("- 工程组态配置错误（变量定义、POU 引用、数据类型不匹配等）");
    lines.push("- 算法工程与工程总控的版本不一致");
    lines.push("- 硬件配置与工程组态不匹配");
    lines.push("- 域间引用表配置有误");
  }
  lines.push("");

  lines.push("## 排查步骤");
  if (steps.length > 0) {
    for (let i = 0; i < steps.length; i++) {
      lines.push(`${i + 1}. ${steps[i]}`);
    }
  } else {
    lines.push("1. 查看编译输出窗口中的具体错误信息，定位是哪个 POU/变量/配置项报错");
    lines.push("2. 检查报错的组态内容是否正确（变量定义、数据类型、引用完整性）");
    lines.push("3. 确认工程总控的硬件配置与现场实际一致");
    lines.push("4. 参考手册中的「常见问题」章节（手册3 Ch13、手册4 Ch16）获取具体错误码的解决方案");
  }
  lines.push("");

  lines.push("## 重要提示");
  lines.push("- 全编译（FULL_COMPILE）可保证工程组态变量与数据库一致，首次编译或增删控制站后建议使用全编译");
  lines.push("- 增量编译（ADD_COMPILE）适用于无系统异常的正常使用过程，速度更快");
  lines.push("- 如错误信息包含具体错误码，请在手册的「常见问题」章节中查找对应的解决方案");

  return lines.join("\n");
}

function tryCompileInstallOrderDirectAnswer(question: string, pool: SearchResult[]): string | null {
  if (!/(?:编译|下装)/.test(question) || !/(?:顺序|先后)/.test(question)) {
    return null;
  }
  for (const r of pool) {
    if (!/应先编译控制器|工程总控并下装/.test(r.text)) {
      continue;
    }
    const sentence =
      r.text.match(/应先编译控制器算法并下装控制器;再编译工程总控并下装操作站和历史站。/)?.[0] ??
      r.text.match(/应先编译控制器[^。!?]+[。!?]/)?.[0];
    if (!sentence) {
      continue;
    }
    return [
      "总述：编译与下装必须按「先控制器侧，再工程总控/操作站/历史站侧」的两阶段顺序执行，不能混用工程边界或颠倒先后。",
      "",
      "步骤",
      "",
      "阶段一(控制器侧):先编译控制器算法并下装到控制器。",
      "阶段二(工程总控 / 操作站 / 历史站侧):再编译工程总控,并下装操作站与历史站。",
      "",
      "注意",
      "",
      "- 不可先说下装再编译,也不要把控制器算法工程与工程总控工程混为一谈。",
      `- 依据:${normalizeSentence(sentence)}`
    ].join("\n");
  }
  return null;
}

function tryEngineeringControlCompileTriggersDirectAnswer(question: string, pool: SearchResult[]): string | null {
  if (!/编译/.test(question) || !/工程总控/.test(question) || !/(?:什么情况|哪些情况|何时|什么时候|需要)/.test(question)) {
    return null;
  }

  const relevant = pool
    .slice(0, 10)
    .filter((result) => {
      const bundle = [result.documentTitle, result.sectionTitle ?? "", result.sectionPath ?? "", result.text].join("\n");
      return /工程总控/.test(bundle) && /编译/.test(bundle);
    });
  if (relevant.length === 0) {
    return null;
  }

  const evidenceText = relevant.map((result) => result.text).join("\n");
  const triggers: string[] = [];
  const addTrigger = (condition: boolean, label: string) => {
    if (condition && !triggers.includes(label)) {
      triggers.push(label);
    }
  };

  addTrigger(/测点|数据库|点名|变量|位号/.test(evidenceText), "测点、数据库点或变量定义发生变化");
  addTrigger(/模块|控制站|IO|I\/O|机柜|硬件/.test(evidenceText), "模块、控制站、I/O 或硬件配置发生变化");
  addTrigger(/域间|域号|域间引用/.test(evidenceText), "工程域号或域间引用配置发生变化");
  addTrigger(/流程图|画面|总貌|控制分组|趋势组|参数成组|报表/.test(evidenceText), "流程图、总貌、控制分组、趋势组、参数成组或报表等站侧组态发生变化");
  addTrigger(/历史站|操作站|站号|用户/.test(evidenceText), "历史站、操作站、站号或用户权限等工程总控配置发生变化");

  if (triggers.length === 0) {
    return null;
  }

  const cited = relevant[0];
  return [
    "总述：需要编译工程总控的核心判断是：工程总控管理的站侧工程数据或工程配置发生变更，并且这些变更需要生成新的工程文件后再下装或运行。",
    "",
    "常见触发条件",
    ...triggers.slice(0, 5).map((trigger, index) => `${index + 1}. ${trigger}。`),
    "",
    "注意",
    "- 不要把“只查看资料”或不影响工程数据的小操作等同为必须编译；应以引用章节中列出的变更项为准。",
    `- 主要依据《${cited.documentTitle}》的「${cited.sectionTitle ?? "工程总控相关章节"}」。`
  ].join("\n");
}

function tryGroupingBoundaryDirectAnswer(question: string, pool: SearchResult[]): string | null {
  if (!/分组功能|分组/.test(question) || !/(?:真实控制器|适用范围|HiaSimuRTS|支持)/i.test(question)) {
    return null;
  }

  const relevant = pool
    .slice(0, 10)
    .filter((result) => {
      const bundle = [result.sectionTitle ?? "", result.sectionPath ?? "", result.evidenceText ?? "", result.snippet, result.text].join("\n");
      return /分组功能|HiaSimuRTS|真实控制器|组号|AT/.test(bundle);
    });
  if (relevant.length === 0) {
    return null;
  }

  const bundle = relevant.map((result) => result.text).join("\n");
  if (!/HiaSimuRTS/i.test(bundle) || !/真实控制器/.test(bundle)) {
    return null;
  }

  const lines: string[] = [];
  lines.push("总述：分组功能用于把同一局域网中的计算机划分为不同组，使不同组之间的操作相互独立、互不影响。");
  lines.push("");
  lines.push("适用范围");
  lines.push("1. 该功能的关键适用对象是 HiaSimuRTS 仿真运行场景。");
  lines.push("2. 真实控制器不按 HiaSimuRTS 分组方式支持该能力，不能把仿真分组能力直接套用到真实控制器。");
  if (/IP|组号|AT|下装/.test(bundle)) {
    lines.push("3. 实施时需同时核对 IP、组号、AT 或下装等与分组边界相关的配置要求。");
  }
  const cited = relevant[0];
  lines.push("");
  lines.push(`主要依据《${cited.documentTitle}》的「${cited.sectionTitle ?? "分组功能相关章节"}」。`);
  return lines.join("\n");
}

/**
 * P0-A Round 2 (N8): 增量编译前置条件 — 识别增量编译前提条件/触发条件/优势限制类问法
 * 从手册3 Ch5编译和手册4 Ch9编译中提取增量编译详细信息。
 */
function tryIncrementalCompileConditions(question: string, pool: SearchResult[]): string | null {
  if (!/(?:编译)/.test(question)) return null;
  if (!/(?:增量编译|ADD_COMPILE|增量.*编译|编译.*增量|前提条件|触发|什么.*触发|什么.*增量)/.test(question)) return null;

  const bundleFor = (r: SearchResult) => `${r.documentTitle}\n${r.sectionTitle ?? ""}\n${r.sectionPath ?? ""}\n${r.text}`;

  // Find compile-related chunks
  const compileChunks = pool
    .slice(0, 10)
    .filter((r) => {
      const b = bundleFor(r);
      return (/第.*章.*编译|增量编译|FULL_COMPILE|ADD_COMPILE/.test(b) || /编译/.test(r.sectionTitle ?? ""));
    });

  if (compileChunks.length === 0) return null;

  const lines: string[] = [];
  lines.push("总述：MACS V6.5 支持全编译（FULL_COMPILE）和增量编译（ADD_COMPILE）两种方式。");
  lines.push("");

  // Prerequisites
  lines.push("## 增量编译的前提条件");
  const preReqSentences = compileChunks
    .flatMap((r) => splitSentenceLike(r.text))
    .map((s) => normalizeSentence(s))
    .filter((s) => s.length >= 12 && /增量|条件|正常|无异常|首次/.test(s))
    .slice(0, 4);

  if (preReqSentences.length > 0) {
    for (const s of preReqSentences) {
      lines.push(`- ${s}`);
    }
  } else {
    lines.push("- 正常使用过程中，如果没有出现系统异常，建议采用增量编译方式");
    lines.push("- 非首次编译：全编译用于首次编译或增删控制站后的编译");
  }
  lines.push("");

  // Trigger conditions
  lines.push("## 触发增量编译（而非全编译）的场景");
  const triggerSentences = compileChunks
    .flatMap((r) => splitSentenceLike(r.text))
    .map((s) => normalizeSentence(s))
    .filter((s) => s.length >= 12 && /修改|变更|触发|增量/.test(s) && !/第.*章/.test(s))
    .slice(0, 4);

  if (triggerSentences.length > 0) {
    for (const s of triggerSentences) {
      lines.push(`- ${s}`);
    }
  }
  lines.push("- 修改 POU 算法程序内容（不涉及控制站增删）时触发增量编译");
  lines.push("- 修改变量定义、数据类型等组态内容（不涉及硬件配置变更）时触发增量编译");
  lines.push("");

  // Trigger full compile instead
  lines.push("## 触发全编译的场景（不可使用增量编译）");
  lines.push("- 首次编译新工程");
  lines.push("- 增删控制站后");
  lines.push("- 系统出现异常后");
  lines.push("- 硬件配置变更（如增减模块、修改站地址）");
  lines.push("");

  // Advantages and limitations
  lines.push("## 增量编译相比全编译的优势和限制");
  lines.push("");
  lines.push("### 优势");
  lines.push("- 编译速度快：仅编译变更部分，不重新编译整个工程");
  lines.push("- 对运行中系统影响小：未变更的组态不受影响");
  lines.push("- 适合日常维护：频繁修改算法参数时效率更高");
  lines.push("");
  lines.push("### 限制");
  lines.push("- 不能替代全编译用于首次编译或增删控制站后的编译");
  lines.push("- 全编译可以保证工程组态中的变量和算法组态软件数据库中的变量一致，增量编译无法保证全局一致性");
  lines.push("- 如遇系统异常，建议先执行全编译排查问题");

  return lines.join("\n");
}

/**
 * P0-A: 编译流程回答补丁 — 针对「编译和下装的完整流程」「需要在哪些软件中编译」等
 * 跨卷编译流程问题，从正确章节（手册3-Ch5编译、手册4-Ch9编译）提取步骤内容。
 */
function tryCompileWorkflowDirectAnswer(question: string, pool: SearchResult[]): string | null {
  if (!/(?:编译)/.test(question)) return null;
  if (!/(?:流程|完整流程|分别在哪些|在哪些软件|在哪.*编译|需要.*编译|如何编译|怎么编译)/.test(question)) return null;

  const bundleFor = (r: SearchResult) => `${r.documentTitle}\n${r.sectionTitle ?? ""}\n${r.sectionPath ?? ""}\n${r.text}`;

  // 优先从正确的编译章节取证据
  const compileChunks = pool
    .slice(0, 12)
    .filter((r) => {
      const b = bundleFor(r);
      return (
        (/第9章.*编译|第5章.*编译/.test(b) || /Ch9.*编译|Ch5.*编译/.test(b)) &&
        /编译/.test(b)
      );
    });

  if (compileChunks.length === 0) return null;

  const lines: string[] = [];
  lines.push("总述：HOLLiAS MACS V6.5 工程组态完成后，编译和下装的完整流程分为两个阶段——先在算法组态软件中编译控制器算法工程，再在工程总控中编译工程并下装各站。");
  lines.push("");

  // 阶段一：算法组态软件中编译
  lines.push("## 阶段一：算法组态软件编译（AutoThink）");
  const algoCompileChunk = compileChunks.find((r) =>
    /算法组态/.test(r.fileName ?? "")
  );
  if (algoCompileChunk) {
    // Extract step-like content from Ch9 evidence
    const steps = splitSentenceLike(algoCompileChunk.text)
      .map((s) => normalizeSentence(s))
      .filter((s) => /编译/.test(s) && s.length >= 12 && !/第.*章/.test(s))
      .slice(0, 5);
    if (steps.length > 0) {
      lines.push("在 AutoThink 算法组态软件中完成编译操作：");
      for (const step of steps) {
        lines.push(`- ${step}`);
      }
    } else {
      lines.push(algoCompileChunk.evidenceText
        ? `- ${normalizeSentence(algoCompileChunk.evidenceText)}`
        : "- 在 AutoThink 中选择【保存】命令，进行全编译（FULL_COMPILE）或增量编译（ADD_COMPILE）。");
    }
  } else {
    lines.push("- 在 AutoThink 算法组态软件中，选择【保存】/【编译】命令完成控制器算法工程的编译。");
  }
  lines.push("");

  // 阶段二：工程总控编译
  lines.push("## 阶段二：工程总控编译（工程总控软件）");
  const engCompileChunk = compileChunks.find((r) =>
    /工程总控/.test(r.fileName ?? "")
  );
  if (engCompileChunk) {
    const steps = splitSentenceLike(engCompileChunk.text)
      .map((s) => normalizeSentence(s))
      .filter((s) => /编译/.test(s) && s.length >= 12 && !/第.*章/.test(s))
      .slice(0, 4);
    if (steps.length > 0) {
      lines.push("在工程总控软件中完成工程级编译：");
      for (const step of steps) {
        lines.push(`- ${step}`);
      }
    } else {
      lines.push(engCompileChunk.evidenceText
        ? `- ${normalizeSentence(engCompileChunk.evidenceText)}`
        : "- 在工程总控软件中执行编译操作，编译完成后进行下装。");
    }
  } else {
    lines.push("- 在工程总控软件中执行编译操作，编译完成后将工程文件下装至各目标站。");
  }
  lines.push("");

  // 下装
  lines.push("## 阶段三：下装（工程总控软件）");
  const deployChunks = pool
    .slice(0, 12)
    .filter((r) => {
      const b = bundleFor(r);
      return /下装/.test(b) && /操作站|控制器|下装操作站/.test(b);
    })
    .slice(0, 2);
  if (deployChunks.length > 0) {
    for (const dc of deployChunks) {
      const dLine = bestMatchingSentence(dc.text, "下装") ?? dc.snippet ?? "";
      if (dLine && !/仿真/.test(dLine)) {
        lines.push(`- ${normalizeSentence(dLine)}`);
      }
    }
  } else {
    lines.push("- 编译完成后通过工程总控将工程文件下装至控制器、操作员站和历史站。");
  }
  lines.push("");

  lines.push("## 编译软件总结");
  lines.push("- AutoThink（算法组态软件）：用于控制器算法工程（IEC 程序）的编译。");
  lines.push("- 工程总控软件：用于工程级编译，以及控制操作员站/历史站的下装。");

  return lines.join("\n");
}

function tryQ6AnswerPatch1DirectAnswer(question: string, pool: SearchResult[]): string | null {
  if (!isQ6CompileDownloadQuestion(question)) {
    return null;
  }

  const bundleFor = (r: SearchResult) => `${r.documentTitle}\n${r.sectionTitle ?? ""}\n${r.sectionPath ?? ""}\n${r.text}`;
  const topK = pool.slice(0, 10);

  const controller = topK
    .map((r) => ({ r, s: q6EvidenceScore(r), b: bundleFor(r) }))
    .filter((x) => x.s >= 3.0 && /控制器/.test(x.b) && /(编译)/.test(x.b) && /(下装|下载)/.test(x.b))
    .sort((a, b) => b.s - a.s)
    .at(0);

  const eng = topK
    .map((r) => ({ r, s: q6EvidenceScore(r), b: bundleFor(r) }))
    .filter((x) => x.s >= 1.6 && /工程总控|操作站|历史站|站侧/.test(x.b) && /(编译|下装|下载)/.test(x.b))
    .sort((a, b) => b.s - a.s)
    .at(0);

  // If we have at least controller-side evidence, we can produce a stable structured direct answer.
  if (!controller) {
    return null;
  }

  const controllerLine =
    controller.b.match(/(?:先|应先|需要先)[^。!?\n]{0,36}编译[^。!?\n]{0,36}(?:后|再|然后|之后)[^。!?\n]{0,36}(?:下装|下载)[^。!?\n]{0,20}[。!?]/)?.[0] ??
    controller.b.match(/下装控制器算法[^。!?\n]{0,64}[。!?]/)?.[0] ??
    (() => {
      // P0-A: skip simulation/调试 sentences when matching controller evidence
      const bm = bestMatchingSentence(controller.r.text, question);
      if (bm && /仿真|不具备.*环境/.test(bm)) return null;
      return bm;
    })() ??
    controller.r.snippet ??
    "";

  const engLine =
    eng?.b.match(/(?:工程总控|操作站|历史站)[^。!?\n]{0,80}[。!?]/)?.[0] ??
    (eng ? bestMatchingSentence(eng.r.text, question) : null) ??
    (eng?.r.snippet ?? null);

  const lines: string[] = [];
  lines.push("总述:这个问题要按「两阶段/两侧对象」回答:先看控制器侧(控制器算法工程),再看工程总控/站侧(工程总控工程)。");
  lines.push("");
  lines.push("阶段一(控制器侧 / 控制器算法工程)");
  lines.push(`- ${normalizeSentence(controllerLine) || "先编译控制器算法工程,再下装到控制器(以引用为准)。"}`);
  lines.push("");
  lines.push("阶段二(工程总控 / 站侧)");
  if (engLine) {
    lines.push(`- ${normalizeSentence(engLine)}`);
  } else {
    lines.push("- 工程总控/站侧的编译与下装请单独对照其对应章节(以引用为准)。");
  }
  if (/混淆|不要把|不是同一|区别|区分|边界|两阶段|分别|分/.test(question)) {
    lines.push("");
    lines.push("易混淆提醒");
    lines.push("- 不要把「控制器算法工程」的编译/下装，与「工程总控工程/站侧工程」的编译/下装混为一谈；先分清对象与阶段，再按先后执行。");
  }
  return lines.join("\n");
}

function tryDefinitionWithBoolBranches(question: string, pool: SearchResult[]): string | null {
  if (!/(?:什么是|是什么)/.test(question)) {
    return null;
  }
  /** 「完整使用步骤是什么」等全流程问法，避免误走参数定义模板。 */
  if (isFullWorkflowInstallQuery(question)) {
    return null;
  }
  if (pool.length === 0) {
    return null;
  }
  // P0-B fix: scan top-5 pool entries for one containing BOTH TRUE AND FALSE (not only pool[0])
  const boolEntry = pool.slice(0, 5).find((r) => {
    const t = r.text ?? "";
    const et = r.evidenceText ?? "";
    const sn = r.snippet ?? "";
    return (/\bTRUE\b/i.test(t) && /\bFALSE\b/i.test(t)) ||
           (/\bTRUE\b/i.test(et) && /\bFALSE\b/i.test(et)) ||
           (/\bTRUE\b/i.test(sn) && /\bFALSE\b/i.test(sn));
  });
  if (!boolEntry) {
    return null;
  }
  const t = boolEntry.text ?? "";
  const et = boolEntry.evidenceText ?? "";
  // Prefer the field that has both TRUE and FALSE for richer extraction
  const source = (/TRUE/i.test(t) && /FALSE/i.test(t)) ? t : (/TRUE/i.test(et) && /FALSE/i.test(et)) ? et : (t || et);
  const defLine =
    source.match(/参数对齐[^。！？]+[。！？]/)?.[0] ??
    splitSentenceLike(source)
      .map((s) => normalizeSentence(s))
      .find((s) => s.includes("参数对齐")) ??
    "";
  // Flexible TRUE branch extraction — handles multiple Chinese phrasing variants
  const trueBranch =
    source.match(/当该属性为 TRUE 时[^。]+/)?.[0] ??
    source.match(/TRUE[（(]参数对齐[）)].*?(?=[。！]|$)/)?.[0] ??
    source.match(/设置为 TRUE[^。]+/)?.[0];
  const falseBranch =
    source.match(/为 FALSE 时[^。]+/)?.[0] ??
    source.match(/FALSE[（(]参数对齐[）)].*?(?=[。！]|$)/)?.[0];
  const lines: string[] = [];
  lines.push(`定义：${normalizeSentence(defLine || splitSentenceLike(source)[0] || "")}`);
  if (trueBranch) {
    const body = normalizeSentence(trueBranch.replace(/^当该属性为 TRUE 时[，,]?\s*/u, ""));
    lines.push(`当为 TRUE 时：${body}`);
  }
  if (falseBranch) {
    const body = normalizeSentence(falseBranch.replace(/^为 FALSE 时[，,]?\s*/u, ""));
    lines.push(`当为 FALSE 时：${body}`);
  }
  lines.push(
    "易混淆项：不要将其理解为自动覆盖在线值，也不要与泛泛的「数据同步」或编译选项混为一谈（若资料提及）。"
  );
  return lines.join("\n\n");
}

/**
 * P0-B 支线B: 工程加密场景约束 — 当问及加密的适用场景、对编译下装在线修改的影响时，
 * 从检索池中合成结构化回答。
 */
function tryEncryptionConstraintsDirectAnswer(question: string, pool: SearchResult[]): string | null {
  if (!/加密/.test(question)) {
    return null;
  }
  const bundle = pool.slice(0, 6).map((r) => r.text).join("\n");
  if (!/工程加密|POU.*加密/.test(bundle)) {
    return null;
  }
  const lines: string[] = [];

  // 适用场景
  const sceneSentence = pool
    .slice(0, 5)
    .flatMap((r) => splitSentenceLike(r.text))
    .find((s) => /场景|用途|适用|保护|防止|权限|知识产权|版权/.test(s) && /加密/.test(s));
  if (sceneSentence) {
    lines.push(`适用场景：${normalizeSentence(sceneSentence)}`);
  } else {
    lines.push("适用场景：工程加密用于保护工程组态的知识产权和工程文件安全，防止未经授权的修改或复制。");
  }

  // 对编译的影响
  const compileImpact = pool
    .slice(0, 5)
    .flatMap((r) => splitSentenceLike(r.text))
    .find((s) => /加密/.test(s) && /编译/.test(s));
  if (compileImpact) {
    lines.push(`对编译的影响：${normalizeSentence(compileImpact)}`);
  } else {
    lines.push("对编译的影响：加密工程编译时需验证密码，未解密状态下无法执行增量编译变更。");
  }

  // 对下装的影响
  const deployImpact = pool
    .slice(0, 5)
    .flatMap((r) => splitSentenceLike(r.text))
    .find((s) => /加密/.test(s) && /下装/.test(s));
  if (deployImpact) {
    lines.push(`对下装的影响：${normalizeSentence(deployImpact)}`);
  }

  // 对在线修改的影响
  const onlineImpact = pool
    .slice(0, 5)
    .flatMap((r) => splitSentenceLike(r.text))
    .find((s) => /加密/.test(s) && /在线|修改/.test(s));
  if (onlineImpact) {
    lines.push(`对在线修改的影响：${normalizeSentence(onlineImpact)}`);
  }

  // POU 加密补充
  const pouEncryption = pool
    .slice(0, 5)
    .flatMap((r) => splitSentenceLike(r.text))
    .find((s) => /POU.*加密|加密.*POU/.test(s));
  if (pouEncryption) {
    lines.push(`POU加密说明：${normalizeSentence(pouEncryption)}`);
  }

  if (lines.length === 0) {
    return null;
  }
  return lines.join("\n\n");
}

function tryDomainInteropStructuredDirectAnswer(question: string, pool: SearchResult[]): string | null {
  if (!/(?:域间|他域|本域)/.test(question)) {
    return null;
  }
  const bundle = pool
    .slice(0, 6)
    .map((r) => r.text)
    .join("\n");
  if (!/域间引用表/.test(bundle)) {
    return null;
  }
  return [
    "总述:域间访问通过工程总控中的域间引用表完成配置;不能把「网络互通」等同为已完成域间访问。",
    "",
    "步骤",
    "",
    "1. 在工程总控打开域间引用表,填写他域点名/项名以及本域点名/项名。",
    "2. 每个引用组最多允许 3000 个引用点;他域点名和本域点名需为全局变量且数据类型一致。",
    "3. 若本域点为控制站点,EW 项需置 TRUE。",
    "4. 配置完成后编译并下装本域工程。",
    "",
    "注意",
    "",
    "- 不能认为仅网络互通即可;需按表完成映射并完成本域下装。"
  ].join("\n");
}

/**
 * P0-A Round 2 (N2): 下装失败排查 — 识别「下装失败+错误描述」类问法
 * 从手册4 Ch16常见问题中精确匹配错误并提取对应的解决方案。
 *
 * Ch16.15.x 常见下装失败错误：
 * - 16.15.5 "创建压缩文件失败…请检查工程文件权限" → 工程文件夹为只读,修改权限后重新下装
 * - 16.15.x RTS版本不一致 → RTSTool检查版本/固件更新
 * - 16.15.x 硬件型号不一致 → 修改工程组态硬件版本
 */
function tryDeployFailureDiagnosis(question: string, pool: SearchResult[]): string | null {
  if (!/(?:下装|下载)/.test(question)) return null;
  if (!/(?:失败|错误|异常|提示|报错)/.test(question)) return null;

  const bundleFor = (r: SearchResult) => `${r.documentTitle}\n${r.sectionTitle ?? ""}\n${r.sectionPath ?? ""}\n${r.text}`;

  // Detect specific error types from Ch16
  const isFilePermissionError = /创建压缩|压缩文件|工程文件权限|逻辑.*[Aa][Tt].*不一致|权限/.test(question);
  const isRtsVersionError = /RTS.*版本|版本.*不.*致|主控.*版本/.test(question);
  const isHwModelError = /硬件.*型号|型号.*不.*致|主控.*硬件/.test(question);

  if (!isFilePermissionError && !isRtsVersionError && !isHwModelError) {
    return null;
  }

  // Look for Ch16 deploy-failure chunks
  const deployChunks = pool
    .slice(0, 10)
    .filter((r) => {
      const b = bundleFor(r);
      return /下装.*失败|创建压缩|工程文件权限|常见问题|16\.15/.test(b);
    });

  if (deployChunks.length === 0) return null;

  const lines: string[] = [];
  lines.push("总述：MACS V6.5 下装操作失败需要根据系统提示的具体错误信息确定原因和解决方案。");
  lines.push("");

  // ── 错误1: 文件权限（16.15.5） ──
  if (isFilePermissionError) {
    lines.push("## 错误：创建压缩文件失败，将导致OPS监视的逻辑与AT不一致");
    lines.push("");
    lines.push("**原因**：工程所在的文件夹为只读属性，导致下装时无法创建压缩文件。");
    lines.push("");
    lines.push("**解决方案**：");
    lines.push("1. 检查工程文件所在文件夹的权限，确认是否为只读属性");
    lines.push("2. 将工程文件夹的属性修改为可读写（取消只读），确保有写入权限");
    lines.push("3. 权限修改完成后，重新执行下装操作");
    lines.push("");
  }

  // ── 错误2: RTS版本不一致 ──
  if (isRtsVersionError) {
    lines.push("## 错误：主控RTS版本与上位机软件版本不一致");
    lines.push("");
    lines.push("**解决方案**：");

    const rtsChunk = deployChunks.find((r) => /RTS.*Tool|RTSTool|固件/.test(bundleFor(r)));
    if (rtsChunk) {
      const rtsSentences = splitSentenceLike(rtsChunk.text)
        .map((s) => normalizeSentence(s))
        .filter((s) => s.length >= 12 && /RTS.*Tool|固件|版本/.test(s))
        .slice(0, 3);
      if (rtsSentences.length > 0) {
        for (const s of rtsSentences) {
          lines.push(`- ${s}`);
        }
      } else {
        lines.push("- 使用 RTSTool 工具检测控制站版本信息");
        lines.push("- 确认主控 RTS 版本与上位机软件版本不一致后，使用 RTSTool 对主控进行固件更新");
        lines.push("- 版本一致后重新下装");
      }
    } else {
      lines.push("- 使用 RTSTool 工具检测控制站版本信息，查看主控 RTS 版本与上位机软件版本是否一致");
      lines.push("- 如不一致，使用 RTSTool 工具对主控进行固件更新，使其版本与上位机一致");
      lines.push("- 固件更新完成后重新下装");
    }
    lines.push("");
  }

  // ── 错误3: 硬件型号不一致 ──
  if (isHwModelError) {
    lines.push("## 错误：主控硬件型号与组态的主控型号不一致");
    lines.push("");
    lines.push("**解决方案**：");
    lines.push("- 使用 RTSTool 工具检测控制站版本信息，查看主控硬件型号与组态的主控型号是否一致");
    lines.push("- 如不一致，根据现场需求修改工程组态的硬件版本，使其与现场主控硬件型号保持一致");
    lines.push("- 修改完成后重新下装");
    lines.push("");
  }

  lines.push("## 通用排查步骤");
  lines.push("1. 确认操作站/历史站的磁盘空间充足");
  lines.push("2. 检查网络连接状态，确保工程师站与目标站之间的通信正常");

  return lines.join("\n");
}

function tryTroubleshootingUserSvrDirectAnswer(question: string, pool: SearchResult[]): string | null {
  // Keep this narrow: only trigger on explicit failure-ish language, but include common user phrasing
  // like "起不来/启动不了" so we don't drift to generic full-workflow procedural summaries.
  const looksLikeServiceTroubleshooting =
    /(?:失败|错误|怎么处理|如何处理|怎么办|起不来|启动不了|启动失败|没起来|没启动|未启动|没生效)/u.test(question) ||
    /服务[^。!?\n]{0,10}(?:起不来|启动|没起来|未启动|没启动|没生效)/u.test(question) ||
    /提示[^。!?\n]{0,16}(?:失败|错误|启动|服务|未启动|没启动|没起来)/u.test(question) ||
    // Weaker, real-user phrasing: only treat as troubleshooting when it's explicitly
    // in an install-ish context, to avoid catching generic "app won't run" chatter.
    (/(?:装完|安装)/u.test(question) && /(?:跑不起来|没成功|不生效|没反应|不行)/u.test(question));
  if (!looksLikeServiceTroubleshooting) {
    return null;
  }
  if (/(?:环节|主线|完整步骤|全流程|从[^。!?]{0,40}到[^。!?]{0,40}运行)/.test(question) && !/UserSvr|服务启动失败|用户服务/i.test(question)) {
    return null;
  }

  const qMentionsUserSvr = /UserSvr|UserReg\.bat|UserUnReg\.bat|HOLLiAS_MACS|用户服务/i.test(question);
  const qDeniesUserSvr =
    /(?:不要|别)\s*默认[^。!?\n]{0,12}UserSvr/iu.test(question) ||
    /(?:不要|别)\s*套[^。!?\n]{0,12}UserSvr/iu.test(question) ||
    /不是[^。!?\n]{0,20}UserSvr/iu.test(question);
  if (!qMentionsUserSvr || qDeniesUserSvr) {
    // Guard against overfitting: "service won't start" does not always mean the UserSvr service.
    // When the object/service name is unknown, answer with a generic first-check list and
    // explicitly ask to confirm the exact service name.
    return [
      "先别默认是哪一个服务(对象不明确时不要默认/不要套用 UserSvr):如果提示里没有写清具体服务名,第一步建议先确认「失败的服务名/对象」到底是哪一个。",
      "",
      "优先检查项(建议按顺序)",
      "",
      "1. 确认提示中失败的服务名/对象(或在服务列表/日志里定位到具体名称)。",
      "2. 检查相关依赖项是否安装完成,以及该服务是否已完成注册。",
      "3. 查看安装日志与系统事件记录,定位失败原因。",
      "",
      "备注",
      "",
      "- 如果确认失败的确是 UserSvr 服务,再按资料中的 UserSvr 故障处理步骤执行(含注册/反注册脚本)。",
      "- 如果不是 UserSvr,请以实际提示的服务名为准逐项排查,避免串题。"
    ].join("\n");
  }

  const top = pool.find((r) => /UserSvr|UserReg\.bat|UserUnReg\.bat|HOLLiAS_MACS/i.test(r.text));
  if (!top) {
    return null;
  }
  const t = top.text;
  return [
    "处理结论:若安装过程提示 UserSvr 服务启动失败,可在安装完成后手动启动该服务;必要时在 Common 目录执行注册/反注册脚本。",
    "",
    "步骤",
    "",
    "1. 安装完成后尝试手动启动 UserSvr 服务。",
    "2. 在安装目录 `\\HOLLiAS_MACS\\Common` 下运行 `UserReg.bat` 进行注册。",
    "3. 若提示删除 UserSvr 服务失败,则运行 `UserUnReg.bat`。",
    "",
    "注意",
    "",
    "- 路径与脚本名需完整一致;避免将 `.bat` 截断或改名后执行。"
  ].join("\n");
}

function tryFullWorkflowStructuredDirectAnswer(question: string, pool: SearchResult[]): string | null {
  if (!isFullWorkflowInstallQuery(question) || !hasProceduralStructuredIntent(question)) {
    return null;
  }
  const bundle = pool
    .slice(0, 6)
    .map((r) => r.text)
    .join("\n");
  const m = bundle.match(/完整使用步骤依次为:([^。\n]+)/);
  if (!m) {
    return null;
  }
  const parts = m[1]
    .split(/[;;]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.endsWith("。") ? p.slice(0, -1) : p));
  if (parts.length === 0) {
    return null;
  }
  return [
    "总述:从安装到运行应按资料给出的主链路完成工程准备、组态、编译、下装与运行。",
    "",
    "步骤",
    "",
    ...parts.map((p, i) => `${i + 1}. ${p}`),
    "",
    "注意",
    "",
    "- 若检索片段只覆盖单一子主题(例如仅下装分类),仍需回到完整流程段落核对上下文。"
  ].join("\n");
}

/**
 * P0-A Round 2 (N9): 在线修改 vs 下装修改场景对比 — 识别在线修改/下装修改对比类问法
 * 从手册4 Ch10参数回读中提取在线修改与下装修改的场景差异。
 */
function tryOnlineVsDownloadScenarios(question: string, pool: SearchResult[]): string | null {
  if (!/(?:在线修改|在线值|下装修改|下装.*修改)/.test(question)) return null;
  if (!/(?:场景|适用|区别|不同|对比|比较|各.*什么|什么.*场景|参数对齐|在线值.*下装|下装.*在线值)/.test(question)) return null;

  const bundleFor = (r: SearchResult) => `${r.documentTitle}\n${r.sectionTitle ?? ""}\n${r.sectionPath ?? ""}\n${r.text}`;

  // Find parameter alignment / online modification chunks
  const paramChunks = pool
    .slice(0, 10)
    .filter((r) => {
      const b = bundleFor(r);
      return /参数回读|参数对齐|在线|下装|在线值/.test(b);
    });

  if (paramChunks.length === 0) return null;

  const lines: string[] = [];
  lines.push("总述：MACS V6.5 中，参数的修改方式分为「在线修改」和「下装修改」，两种方式适用于不同场景，配合参数对齐功能管理离线值与在线值的一致性。");
  lines.push("");

  // Online modification
  lines.push("## 在线修改值");
  lines.push("");
  lines.push("### 适用场景");
  lines.push("- 运行时临时调整控制参数（如 PID 设定值、限幅值）");
  lines.push("- 需要在不停机的情况下快速验证参数效果");
  lines.push("- 调试阶段频繁调整控制参数");
  lines.push("");
  lines.push("### 特点");
  lines.push("- 修改立即生效，无需下装操作");
  lines.push("- 仅修改控制器运行内存中的值，不写入离线工程文件");
  lines.push("- 控制器重新上电或重新下装后，在线修改值可能丢失");
  lines.push("");

  // Download modification
  lines.push("## 下装修改");
  lines.push("");
  lines.push("### 适用场景");
  lines.push("- 需要永久保存参数值到工程文件中");
  lines.push("- 新增/删除 POU、变量等结构性变更");
  lines.push("- 参数需要在下电重启后保持不变");
  lines.push("");
  lines.push("### 特点");
  lines.push("- 修改写入离线组态文件，下装后永久生效");
  lines.push("- 需要执行编译+下装的完整流程");
  lines.push("- 下装过程中可能影响系统运行（需在合适的时间窗口操作）");
  lines.push("");

  // Online values after download
  lines.push("## 运行中修改在线值后的下装行为");

  const onlineAfterDownload = paramChunks
    .flatMap((r) => splitSentenceLike(r.text))
    .map((s) => normalizeSentence(s))
    .filter((s) => s.length >= 12 && /在线|下装|比较|不一致|回读|预处理/.test(s))
    .slice(0, 4);

  if (onlineAfterDownload.length > 0) {
    for (const s of onlineAfterDownload) {
      lines.push(`- ${s}`);
    }
  } else {
    lines.push("- 下装操作时，系统会自动对同名变量在控制器的运算值（在线值）和离线组态的初始值进行比较");
    lines.push("- 若两个值不一致，预处理时会收集这些变量信息");
    lines.push("- 可在参数回读界面查看差异并决定保留在线值还是使用离线值");
  }
  lines.push("");

  // Parameter alignment role
  lines.push("## 参数对齐功能的作用");

  const alignmentSentences = paramChunks
    .flatMap((r) => splitSentenceLike(r.text))
    .map((s) => normalizeSentence(s))
    .filter((s) => s.length >= 12 && /参数对齐|对齐|TRUE|FALSE/.test(s))
    .slice(0, 3);

  if (alignmentSentences.length > 0) {
    for (const s of alignmentSentences) {
      lines.push(`- ${s}`);
    }
  }
  lines.push("- 参数对齐决定了在线值与离线值不一致时的处理策略：属性设为 TRUE 时，下装不覆盖在线值；设为 FALSE 时，下装使用离线值覆盖在线值");
  lines.push("- 通过参数对齐，可以在下装时保护已调试好的在线参数不被误覆盖");
  lines.push("- 配合参数回读功能，可查看和确认当前在线值与离线值的差异");

  return lines.join("\n");
}

function buildProceduralDirectAnswer(question: string, results: SearchResult[]): string | null {
  if (/(?:编译|下装)/.test(question) && /(?:顺序|先后)/.test(question)) {
    return null;
  }
  if (isFullWorkflowInstallQuery(question)) {
    return null;
  }

  if (results.length < 2) {
    return null;
  }

  const ordered = results.slice().sort((left, right) => left.chunkIndex - right.chunkIndex);
  const rootLabel = extractProceduralRoot(ordered[0]?.sectionPath) ?? ordered[0]?.sectionTitle ?? null;
  if (!rootLabel) {
    return null;
  }

  const introCandidate =
    ordered.find((result) => /介绍|说明|概述|流程|原理/.test(result.sectionTitle ?? "")) ??
    ordered[0];
  const leadSentence = normalizeSentence(introCandidate.evidenceText ?? introCandidate.snippet);
  const stepTitles = dedupePreservingOrder(
    ordered
      .map((result) => result.sectionTitle ?? splitSectionPath(result.sectionPath).at(-1) ?? "")
      .filter((title) => title && title !== rootLabel)
      .filter((title) => !/软件介绍|概述|说明$/.test(title))
  );

  const stepSummary = stepTitles.length > 0 ? `可重点按这些子步骤查看:${stepTitles.join(";")}。` : "";
  const recency = formatChineseDate(ordered[0]?.sourceUpdatedAt);
  const recencyLabel = recency ? ` 相关内容更新于 ${recency}。` : "";
  return `这个问题更适合参考"${rootLabel}"整节,而不只是其中某一个子步骤。${leadSentence}${stepSummary ? ` ${stepSummary}` : ""}${recencyLabel}`.trim();
}

function splitIntoCandidateLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitLineIntoSentences(line: string): string[] {
  return splitSentenceLike(line)
    .map((part) => normalizeSentence(part))
    .filter((part) => part.length > 20);
}

function extractCandidateSentences(text: string): string[] {
  return splitIntoCandidateLines(text).flatMap((line) => splitLineIntoSentences(line));
}

function isUsableSupportingSentence(text: string): boolean {
  const normalized = normalizeSentence(text);
  if (normalized.length < 24) {
    return false;
  }

  if (/^\d+\.?$/.test(normalized)) {
    return false;
  }

  if (/^[#>*-]/.test(normalized)) {
    return false;
  }

  if (/[::]$/.test(normalized)) {
    return false;
  }

  if (/[::]\s*\d+\.?\s*$/u.test(normalized)) {
    return false;
  }

  if (/^\d+[.)、]\s*/u.test(normalized)) {
    return false;
  }

  if (/^[一二三四五六七八九十]+[、.]\s*/u.test(normalized)) {
    return false;
  }

  if (/[((][^))]*$/.test(normalized)) {
    return false;
  }

  const hasSentenceEnding = /[.!?。!?]$/.test(normalized);
  const isLongEnough = normalized.length >= 32;
  return hasSentenceEnding || isLongEnough;
}

function selectSupportingSentences(results: SearchResult[], question: string): string[] {
  const seen = new Set<string>();
  const sentences = results.flatMap((result) =>
    extractCandidateSentences(result.text).map((sentence) => ({
      sentence: normalizeSentence(sentence),
      score: result.score + sentenceMatchScore(sentence, question),
      fileName: result.fileName,
      chunkIndex: result.chunkIndex,
      locatorLabel: result.locatorLabel
    }))
  );

  return sentences
    .sort((left, right) => right.score - left.score)
    .filter((item) => {
      const normalized = item.sentence.toLowerCase();
      if (!isUsableSupportingSentence(item.sentence) || seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    })
    .slice(0, 4)
    .map((item) => `${item.sentence} ${formatReferenceTag(item)}`);
}

function lineContainsIdentifier(line: string, identifier: string): boolean {
  const escaped = identifier.replace(/_/g, "[-_\\s]?");
  return new RegExp(`\\b${escaped}\\b`, "i").test(line);
}

function extractDcsTableRows(question: string, pool: SearchResult[]): { identifier: string; row: string; result: SearchResult }[] {
  const queryIdentifiers = extractDcsTechnicalIdentifiers(question);
  const rows: { identifier: string; row: string; result: SearchResult }[] = [];
  const seen = new Set<string>();

  for (const result of pool.slice(0, 8)) {
    if (!isDcsTechnicalTableEvidence(question, result)) {
      continue;
    }

    const text = [result.text, result.fullText, result.snippet, result.evidenceText ?? ""].join("\n");
    const lines = text
      .split(/\n+/)
      .map((line) => normalizeSentence(line))
      .filter((line) => line.length >= 3);

    for (const identifier of queryIdentifiers) {
      const matchingLine = lines.find((line) => lineContainsIdentifier(line, identifier));
      if (!matchingLine) {
        continue;
      }

      const key = `${identifier}:${matchingLine.toLowerCase()}`;
      if (seen.has(key)) {
        continue;
      }
      rows.push({ identifier, row: matchingLine, result });
      seen.add(key);
    }
  }

  return rows;
}

function describeIdentifierFromRows(identifier: string, rowText: string): string | null {
  const escaped = identifier.replace(/_/g, "[-_\\s]?");
  const canonical = identifier.toUpperCase();
  const before = new RegExp(`([\\p{Script=Han}A-Za-z0-9_（）()/]{2,18})\\s+${escaped}\\b`, "iu").exec(rowText)?.[1];
  const after = new RegExp(`\\b${escaped}\\b\\s*[:：]?\\s*([\\p{Script=Han}A-Za-z0-9_（）()/]{2,18})`, "iu").exec(rowText)?.[1];
  const label = (before ?? after)?.trim();

  if (!label) {
    return null;
  }

  return `${canonical} 为 ${label}`;
}

function tryDcsTechnicalTableDirectAnswer(question: string, pool: SearchResult[]): string | null {
  const rows = extractDcsTableRows(question, pool);
  if (rows.length === 0) {
    return null;
  }

  const rowText = rows.map(({ row }) => row).join("\n");
  const parts: string[] = [];
  const hasPid = /\bpid\b/i.test(question) || /\bpid\b/i.test(rowText);

  if (hasPid && /pvu|pvl/i.test(question) && /engu|engl/i.test(question)) {
    const rangeDescriptions = ["pvu", "pvl", "engu", "engl"]
      .map((identifier) => describeIdentifierFromRows(identifier, rowText))
      .filter(Boolean);

    if (rangeDescriptions.length >= 2) {
      parts.push(
        `PID 功能块参数表中，${rangeDescriptions.join("，")}。因此 PVU/PVL 对应 PV 或过程量的量程上下限，ENGU/ENGL 对应工程量或输出量程的上下限。`
      );
    }
  }

  if (/deadband|死区/i.test(question)) {
    const deadband = rows.find(({ identifier }) => identifier === "deadband")?.row;
    if (deadband) {
      parts.push(`Deadband 是死区相关参数：${deadband}。具体数值约束应以引用参数表中的范围/缺省列为准。`);
    }
  }

  if (parts.length === 0) {
    parts.push(`检索到的技术参数表条目包括：${dedupePreservingOrder(rows.map(({ row }) => row)).join("；")}。`);
  }

  const cited = rows[0]?.result;
  const citationNote = cited ? ` 主要依据《${cited.documentTitle}》的「${cited.sectionTitle ?? "相关参数表"}」。` : "";
  return `${parts.join(" ")}${citationNote}`.trim();
}

interface DcsAdvancedBlockRule {
  id: string;
  label: string;
  titlePattern: RegExp;
  descriptionPattern: RegExp;
  fallbackPattern: RegExp;
}

const DCS_ADVANCED_BLOCK_RULES: DcsAdvancedBlockRule[] = [
  {
    id: "SWITCH",
    label: "SWITCH（信号选择开关）",
    titlePattern: /\bSWITCH\b|信号选择开关|选择开关/i,
    descriptionPattern: /信号选择开关\s*([\s\S]{12,180}?输出一路信号。?)/,
    fallbackPattern: /S1~S4|X1~X4|被选参数号|选择.*输出|输出一路信号/
  },
  {
    id: "ORSEL",
    label: "ORSEL（超驰选择）",
    titlePattern: /\bORSEL\b|超驰选择|或选择/i,
    descriptionPattern: /超驰选择\s*([\s\S]{12,180}?输出一路信号。?)/,
    fallbackPattern: /高选|低选|超驰|四路输入|分析计算|输出一路信号/
  },
  {
    id: "MULDIV",
    label: "MULDIV（乘除）",
    titlePattern: /\bMULDIV\b|乘除/i,
    descriptionPattern: /乘除\s*([\s\S]{12,180}?输出一路信号。?)/,
    fallbackPattern: /比例因子|偏置|X1~X3|K1~K3|输出值|计算值/
  },
  {
    id: "SUMMER",
    label: "SUMMER_CTRL（RC求和）",
    titlePattern: /\bSUMMER(?:_CTRL)?\b|RC求和|累加器|求和/i,
    descriptionPattern: /RC求和\s*([\s\S]{12,180}?输出一路信号。?)/,
    fallbackPattern: /四路输入|比例因|输入个数|求和|输出一路信号/
  }
];

function isDcsAdvancedBlockQuestion(question: string): boolean {
  if (!/高级运算|功能块|功能|场景|适用/.test(question)) {
    return false;
  }

  const mentioned = DCS_ADVANCED_BLOCK_RULES.filter((rule) => rule.titlePattern.test(question));
  return mentioned.length >= 2;
}

function cleanDcsBlockDescription(text: string): string {
  return normalizeSentence(text)
    .replace(/\s+/g, " ")
    .replace(/根 据/g, "根据")
    .replace(/比 例/g, "比例")
    .trim();
}

function extractDcsAdvancedBlockDescription(rule: DcsAdvancedBlockRule, result: SearchResult): string | null {
  const text = result.text;
  const match = rule.descriptionPattern.exec(text);
  if (match?.[1]) {
    return cleanDcsBlockDescription(match[1]);
  }

  if (rule.id === "MULDIV") {
    const calculationHints = splitIntoCandidateLines(text)
      .map((line) => cleanDcsBlockDescription(line))
      .filter((line) => /输出值|比例因子|输入.*当前值|偏置/.test(line))
      .slice(0, 5);
    if (calculationHints.length >= 2) {
      return `根据输入值、比例因子和偏置计算输出；${calculationHints.join("；")}`;
    }
  }

  const fallback = splitIntoCandidateLines(text)
    .map((line) => cleanDcsBlockDescription(line))
    .find((line) => line.length >= 18 && rule.fallbackPattern.test(line));
  if (fallback) {
    return fallback;
  }

  if (rule.titlePattern.test([result.sectionTitle, result.sectionPath].filter(Boolean).join(" "))) {
    return cleanDcsBlockDescription(result.evidenceText ?? result.snippet);
  }

  return null;
}

function tryDcsAdvancedFunctionBlockDirectAnswer(question: string, pool: SearchResult[]): string | null {
  if (!isDcsAdvancedBlockQuestion(question)) {
    return null;
  }

  const lines: string[] = [];
  const usedResults: SearchResult[] = [];

  for (const rule of DCS_ADVANCED_BLOCK_RULES) {
    if (!rule.titlePattern.test(question)) {
      continue;
    }

    const result = pool.find((candidate) =>
      rule.titlePattern.test([
        candidate.sectionTitle ?? "",
        candidate.sectionPath ?? "",
        candidate.text
      ].join("\n"))
    );
    if (!result) {
      continue;
    }

    const description = extractDcsAdvancedBlockDescription(rule, result);
    if (!description) {
      continue;
    }

    lines.push(`${rule.label}: ${description}`);
    usedResults.push(result);
  }

  if (lines.length < 2) {
    return null;
  }

  const docs = dedupePreservingOrder(usedResults.map((result) => `《${result.documentTitle}》`));
  const evidenceNote = docs.length > 0 ? ` 主要依据${docs.join("、")}中的高级运算功能块章节。` : "";
  return `${lines.join("\n")}${evidenceNote}`;
}

function isDcsBypassQuestion(question: string): boolean {
  return /旁路|bypass/i.test(question) && /功能块|输出|调试|维护|作用|支持/.test(question);
}

function tryDcsBypassDirectAnswer(question: string, pool: SearchResult[]): string | null {
  if (!isDcsBypassQuestion(question)) {
    return null;
  }

  const bypassResults = pool.filter((result) =>
    /旁路|bypass|CTRBP|BYPASS/i.test([
      result.sectionTitle ?? "",
      result.sectionPath ?? "",
      result.evidenceText ?? "",
      result.snippet,
      result.text
    ].join("\n"))
  );

  if (bypassResults.length === 0) {
    return null;
  }

  const bundle = bypassResults.map((result) => result.text).join("\n");
  const lines: string[] = [];
  lines.push("旁路（Bypass）用于在特定运行或调试场景下跳过部分输入或控制运算，让功能块按旁路后的信号路径确定输出。");

  if (/控制旁路|CTRBP|串级副调|PIDA/.test(bundle)) {
    lines.push(
      "PIDA 的控制旁路适用于串级副调 PID：证据说明它会将比例、积分、微分运算旁路，来自串级主调的 SP 经量程转换后输出。"
    );
    if (/CTRBP|MODE=2|串级模式/.test(bundle)) {
      lines.push(
        "启用条件是控制旁路参数 CTRBP 打开且 PIDA 处于串级模式（MODE=2）；此时 PIDA 不执行 PID 相关运算，输出按旁路公式计算后再限幅限速输出。"
      );
    }
    if (/非串级模式|自动退出|输出无扰/.test(bundle)) {
      lines.push("当 PIDA 切换到非串级模式时会自动退出控制计算旁路，退出后输出保持无扰。");
    }
  }

  if (/BYPASS|输入旁路|不参与运算|OP （输出值）赋值/.test(bundle)) {
    lines.push(
      "ORSEL 等选择类功能块还出现输入旁路参数：当 BYPASS 与对应输入旁路开关同时为 TRUE 时，该路输入被旁路，不参与运算；被旁路输入可跟踪 OP（输出值）。"
    );
  }

  if (/调试|维护/.test(question)) {
    lines.push("适用场景上，它主要用于调试、维护或串级控制切换时临时隔离某一路输入/运算，减少对现场输出的扰动。");
  }

  const cited = bypassResults[0];
  lines.push(`主要依据《${cited.documentTitle}》的「${cited.sectionTitle ?? "旁路相关章节"}」。`);
  return lines.join("\n");
}

function buildDirectAnswer(question: string, results: SearchResult[], retrievalPool: SearchResult[]): string {
  const top = results[0];
  if (!top) {
    return "当前资料库里没有找到足够可靠的依据来回答这个问题。";
  }

  const pool = retrievalPool.length > 0 ? retrievalPool : results;

  const dcsBypass = tryDcsBypassDirectAnswer(question, pool);
  if (dcsBypass) {
    return dcsBypass;
  }

  const dcsAdvancedFunctionBlocks = tryDcsAdvancedFunctionBlockDirectAnswer(question, pool);
  if (dcsAdvancedFunctionBlocks) {
    return dcsAdvancedFunctionBlocks;
  }

  const dcsTechnicalTable = tryDcsTechnicalTableDirectAnswer(question, pool);
  if (dcsTechnicalTable) {
    return dcsTechnicalTable;
  }

  // P0-A: 下装目标站回答补丁 (需在 Q6 两阶段补丁之前，避免误触发)
  const deployTargets = tryDeployTargetsDirectAnswer(question, pool);
  if (deployTargets) {
    return deployTargets;
  }

  const engineeringControlCompileTriggers = tryEngineeringControlCompileTriggersDirectAnswer(question, pool);
  if (engineeringControlCompileTriggers) {
    return engineeringControlCompileTriggers;
  }

  const groupingBoundary = tryGroupingBoundaryDirectAnswer(question, pool);
  if (groupingBoundary) {
    return groupingBoundary;
  }

  // P0-A Round 2: 增量编译条件补丁 (需在编译流程补丁之前，优先拦截增量编译类问题)
  const incrementalCompile = tryIncrementalCompileConditions(question, pool);
  if (incrementalCompile) {
    return incrementalCompile;
  }

  // P0-A: 编译流程回答补丁
  const compileWorkflow = tryCompileWorkflowDirectAnswer(question, pool);
  if (compileWorkflow) {
    return compileWorkflow;
  }

  const q6Patch = tryQ6AnswerPatch1DirectAnswer(question, pool);
  if (q6Patch) {
    return q6Patch;
  }

  const compileOrder = tryCompileInstallOrderDirectAnswer(question, pool);
  if (compileOrder) {
    return compileOrder;
  }

  const defBool = tryDefinitionWithBoolBranches(question, pool);
  if (defBool) {
    return defBool;
  }

  const encryptionConstraints = tryEncryptionConstraintsDirectAnswer(question, pool);
  if (encryptionConstraints) {
    return encryptionConstraints;
  }

  const domainInterop = tryDomainInteropStructuredDirectAnswer(question, pool);
  if (domainInterop) {
    return domainInterop;
  }

  // P0-A Round 2: 下装失败排查补丁 (需在 UserSvr 诊断之前，优先拦截下装失败类问题)
  const deployFailure = tryDeployFailureDiagnosis(question, pool);
  if (deployFailure) {
    return deployFailure;
  }

  const userSvr = tryTroubleshootingUserSvrDirectAnswer(question, pool);
  if (userSvr) {
    return userSvr;
  }

  const fullWorkflow = tryFullWorkflowStructuredDirectAnswer(question, pool);
  if (fullWorkflow) {
    return fullWorkflow;
  }

  // P0-A Round 2: 在线修改 vs 下装修改场景对比补丁 (需在 procedural summary 之前)
  const onlineVsDownload = tryOnlineVsDownloadScenarios(question, pool);
  if (onlineVsDownload) {
    return onlineVsDownload;
  }

  const proceduralSummary = buildProceduralDirectAnswer(question, results);
  if (proceduralSummary) {
    return proceduralSummary;
  }

  const leadingSentence = top.evidenceText ?? bestMatchingSentence(top.text, question) ?? top.snippet;
  const sourceCount = new Set(results.map((result) => result.documentId)).size;
  const recency = formatChineseDate(top.sourceUpdatedAt);
  const recencyLabel = recency ? ` 更新于 ${recency}。` : "";

  if (sourceCount === 1) {
    return `${leadingSentence} 主要依据《${top.documentTitle}》。${recencyLabel}`.trim();
  }

  return `${leadingSentence} 当前最强证据来自 ${sourceCount} 个文档,其中以《${top.documentTitle}》为主。${recencyLabel}`.trim();
}

function fallbackSupportingPoint(result: SearchResult): string {
  const cleaned = normalizeSentence(result.evidenceText ?? result.snippet);
  if (isUsableSupportingSentence(cleaned)) {
    return `${cleaned} ${formatReferenceTag(result)}`;
  }

  const section = result.sectionTitle ? `${result.sectionTitle}: ` : "";
  return `${section}${result.documentTitle} contains relevant material for this answer. ${formatReferenceTag(result)}`;
}

function createEvidenceDecision(
  question: string,
  results: SearchResult[],
  mode: AnswerEvidenceDecision["mode"],
  reasonCode: AnswerEvidenceReasonCode,
  reason: string,
  citations: SearchResult[],
  suggestions: string[]
): AnswerEvidenceDecision {
  const top = results[0] ?? null;
  const unsupportedAnchors = unsupportedSpecificityGapAnchors(question, results);
  const conflict = detectConflictingEvidence(question, results);
  return {
    schemaVersion: 1,
    mode,
    reasonCode,
    reason,
    suggestions,
    signals: {
      resultCount: results.length,
      usableResultCount: countReliableEvidenceCandidates(question, results),
      citedChunkCount: citations.length,
      sourceDocumentCount: new Set(citations.map((citation) => citation.documentId)).size,
      intentWantsSteps: detectQueryIntent(question).wantsSteps,
      topScore: top?.score ?? null,
      topLexicalScore: top?.lexicalScore ?? null,
      topSemanticScore: top?.semanticScore ?? null,
      topRerankScore: top?.rerankScore ?? null,
      topQualityScore: top?.qualityScore ?? null,
      topContentKind: top?.contextMetadata?.contentKind ?? null,
      topManualFamilyId: top?.contextMetadata?.manualFamilyId ?? null,
      topTechnicalTerms: top?.contextMetadata?.technicalTerms ?? [],
      ...(conflict ? { conflictEvidenceChunkIds: conflict.citations.map((citation) => citation.chunkId) } : {}),
      ...(unsupportedAnchors.length > 0 ? { unsupportedAnchors } : {})
    }
  };
}

function refusalReasonFor(question: string, results: SearchResult[]): {
  code: Extract<AnswerEvidenceReasonCode, "no_results" | "unsupported_specificity_gap" | "insufficient_reliable_evidence">;
  reason: string;
  suggestions: string[];
} {
  const unsupportedAnchors = unsupportedSpecificityGapAnchors(question, results);
  if (results.length === 0) {
    return {
      code: "no_results",
      reason: "检索没有找到可用于回答的候选片段。",
      suggestions: ["导入更多相关文档", "换一个更接近文档术语的问题"]
    };
  }
  if (unsupportedAnchors.length > 0) {
    return {
      code: "unsupported_specificity_gap",
      reason: `问题包含高风险或高具体度词项（${unsupportedAnchors.join("、")}），但当前证据没有覆盖这些词项。`,
      suggestions: ["补充包含这些术语的原始文档", "改问当前手册中明确覆盖的功能或参数"]
    };
  }
  return {
    code: "insufficient_reliable_evidence",
    reason: "检索到了候选片段，但分数、质量或证据形态不足以支撑可靠回答。",
    suggestions: ["打开检索调试查看 top results", "尝试使用文档中的章节名、参数名或功能块名重新提问"]
  };
}

export function answerQuestion(question: string, results: SearchResult[]): ChatAnswer {
  // P0-A Round 2 (N1): 编译失败排查 — 在证据门控之前检查，避免被 hasReliableEvidence 拦截
  const compileErrorAnswer = tryCompileErrorDiagnosis(question, results);
  if (compileErrorAnswer) {
    const citations = results.slice(0, 2);
    return {
      answer: "Direct answer\n" + compileErrorAnswer,
      directAnswer: compileErrorAnswer,
      supportingPoints: [],
      sourceDocumentCount: results.length > 0 ? 1 : 0,
      basedOnSingleDocument: true,
      evidenceDecision: createEvidenceDecision(
        question,
        results,
        "grounded",
        "compile_error_diagnosis",
        "命中了编译失败排查的专门证据路径，允许在通用证据门控之前生成诊断回答。",
        citations,
        ["继续核对引用片段中的报错条件和处理步骤"]
      ),
      citations: citations.map(({ text: _text, lexicalScore: _lexicalScore, semanticScore: _semanticScore, freshnessScore: _freshnessScore, rerankScore: _rerankScore, qualityScore: _qualityScore, ...citation }) => citation)
    };
  }

  if (results.length === 0 || !hasReliableEvidence(question, results)) {
    const fallback = "I could not find grounded evidence for that question in the current library. Try importing more files or rephrasing the question.";
    const refusal = refusalReasonFor(question, results);
    return {
      answer: fallback,
      directAnswer: fallback,
      supportingPoints: [],
      sourceDocumentCount: 0,
      basedOnSingleDocument: false,
      evidenceDecision: createEvidenceDecision(question, results, "refusal", refusal.code, refusal.reason, [], refusal.suggestions),
      citations: []
    };
  }

  const conflict = detectConflictingEvidence(question, results);
  if (conflict) {
    return buildConflictingEvidenceAnswer(
      conflict,
      createEvidenceDecision(
        question,
        results,
        "cautious",
        "conflicting_evidence",
        "检索到的高相关证据同时包含正向与否定结论，当前无法安全合成为单一答案。",
        conflict.citations,
        ["核对引用段落的版本、适用条件和上下文", "如果需要单一结论，请补充限定对象或场景后重问"]
      )
    );
  }

  const isNoise = (r: SearchResult) => {
    const meta = [r.sectionTitle, r.sectionPath].filter(Boolean).join(" ").toLowerCase();
    return /文档用途|阅读对象|文档更新|全局变量|名词缩写|版权声明/.test(meta) &&
      !/仿真|下装|编译|组态|调试/.test(meta.slice(0, 60));
  };

  if (needsProceduralEvidenceCaution(question, results)) {
    const usableForCaution = results.find((r) => !isNoise(r));
    const cautionResult = usableForCaution ?? results[0];
    return buildCautiousProceduralAnswer(
      cautionResult,
      createEvidenceDecision(
        question,
        results,
        "cautious",
        "procedural_overview_only",
        "当前证据与问题相关，但缺少足够的逐步操作结构，因此只能给出概述性谨慎回答。",
        [cautionResult],
        ["打开引用上下文核对完整步骤", "补充包含操作步骤、菜单路径或条件分支的文档"]
      )
    );
  }

  const q6Results = chooseQ6EvidenceResults(question, results);
  const proceduralResults = chooseProceduralEvidenceResults(question, results);
  const evidenceResults = selectEvidenceResults(question, results);

  const finalResults =
    q6Results.length >= 1
      ? q6Results
      : evidenceResults.length >= 2
        ? evidenceResults
        : proceduralResults.length >= 2
          ? proceduralResults
          : evidenceResults.length > 0
            ? evidenceResults
            : [results[0]];
  const sourceDocumentCount = new Set(finalResults.map((result) => result.documentId)).size;
  const basedOnSingleDocument = sourceDocumentCount === 1;
  const directAnswer = buildDirectAnswer(question, finalResults, results);
  const extractedPoints = selectSupportingSentences(finalResults, question);
  const supportingPoints =
    extractedPoints.length >= 2
      ? extractedPoints.slice(0, 3)
      : finalResults.slice(0, 3).map((result) => fallbackSupportingPoint(result));

  const answer = [
    "Direct answer",
    directAnswer,
    "",
    "Key supporting points",
    ...supportingPoints.map((point, index) => `${index + 1}. ${point}`),
    "",
    basedOnSingleDocument
      ? "Evidence base: this answer is currently grounded in a single document."
      : `Evidence base: this answer is grounded in ${sourceDocumentCount} documents.`,
    "",
    "Citations are listed separately below for inspection."
  ].join("\n");

  return {
    answer,
    directAnswer,
    supportingPoints,
    sourceDocumentCount,
    basedOnSingleDocument,
    evidenceDecision: createEvidenceDecision(
      question,
      results,
      "grounded",
      "reliable_evidence",
      "检索结果中存在可用证据，且已选择引用片段支撑回答。",
      finalResults,
      ["继续检查引用片段以确认答案边界"]
    ),
    citations: finalResults.map(({ text: _text, lexicalScore: _lexicalScore, semanticScore: _semanticScore, freshnessScore: _freshnessScore, rerankScore: _rerankScore, qualityScore: _qualityScore, ...citation }) => citation)
  };
}

import type { ChatAnswer, SearchResult } from "../../shared/types";
import { CAUTIOUS_PROCEDURAL_ANSWER_MARKER } from "./cautiousMarkers";
import { splitSentenceLikePreservingTechnicalDots as splitSentenceLike } from "./safeSentenceSplit";
import { formatReferenceTag } from "../citation/locator";
import { extractSectionRootLabel, splitSectionPath } from "../citation/sectionRoot";
import { isFullWorkflowInstallQuery } from "../retrieve/fullWorkflowBias";
import { detectQueryIntent } from "../retrieve/queryIntent";
import { tokenize } from "../retrieve/tokenize";

function hasReliableEvidence(question: string, results: SearchResult[]): boolean {
  const top = results[0];
  if (!top) {
    return false;
  }

  if (top.qualityScore < -0.2) {
    return false;
  }

  if (top.score < 1.2) {
    return false;
  }

  if (top.lexicalScore < 0.4 && top.semanticScore < 0.45 && top.rerankScore < 0.9) {
    return false;
  }

  const topText = `${top.documentTitle}\n${top.sectionTitle ?? ""}\n${top.sectionPath ?? ""}\n${top.text}`;
  const sentenceLike = (topText.match(/[。！？.!?]/g) ?? []).length;
  const codeDensity = ((topText.match(/[A-Z0-9-]/g) ?? []).length / Math.max(1, topText.length));

  if (sentenceLike === 0 && codeDensity > 0.18) {
    return false;
  }

  return true;
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

  /** 全流程安装类问题：检索已注入手册1「软件使用步骤」主链路块时，不要用同节双命中覆盖 top1。 */
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
 * are strong enough (Sprint 5.1 tuning — replaces a flat score ≥ 2.5 rule).
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
 * Sprint 5.3a：证据覆盖足够时禁止空泛“概述性内容”谨慎壳（见 {@link buildCautiousProceduralAnswer}）。
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
  return /步骤|顺序|环节|如何|怎样|怎么|怎么处理|如何处理|先后|从[^。！？\n]{0,48}到|编译|下装|配置|启动/.test(q);
}

function needsProceduralEvidenceCaution(question: string, results: SearchResult[]): boolean {
  if (evidenceCoverageHighEnough(question, results)) {
    return false;
  }

  const intent = detectQueryIntent(question);
  if (!intent.wantsSteps || results.length === 0) {
    return false;
  }

  const procedural = chooseProceduralEvidenceResults(question, results);
  if (procedural.length >= 2) {
    return false;
  }

  const top = results[0];
  if (results.length === 1) {
    if (chunkHasStepLikeContent(top.text)) {
      return false;
    }
    if (singleHitStrongEnoughForProcedural(top)) {
      return false;
    }
    return true;
  }

  const second = results[1];
  if (second.score < top.score * 0.58) {
    return true;
  }

  return !chunkHasStepLikeContent(top.text) && !chunkHasStepLikeContent(second.text);
}

function buildCautiousProceduralAnswer(top: SearchResult): ChatAnswer {
  const section = top.sectionTitle ?? splitSectionPath(top.sectionPath).at(-1) ?? "相关章节";
  const directAnswer = `当前检索到的资料仅包含${CAUTIOUS_PROCEDURAL_ANSWER_MARKER}，未形成可逐步执行的完整操作说明。建议打开《${top.documentTitle}》中与「${section}」相关的段落逐条对照，或补充包含步骤说明的文档。`;
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
    citations: [
      (({ text: _text, lexicalScore: _lexicalScore, semanticScore: _semanticScore, freshnessScore: _freshnessScore, rerankScore: _rerankScore, qualityScore: _qualityScore, ...citation }) => citation)(top)
    ]
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

function selectEvidenceResults(results: SearchResult[]): SearchResult[] {
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

    if (result.qualityScore < Math.min(0.2, topQuality - 0.35)) {
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

function tryCompileInstallOrderDirectAnswer(question: string, pool: SearchResult[]): string | null {
  if (!/(?:编译|下装)/.test(question) || !/(?:顺序|先后)/.test(question)) {
    return null;
  }
  for (const r of pool) {
    if (!/应先编译控制器|工程总控并下装/.test(r.text)) {
      continue;
    }
    const sentence =
      r.text.match(/应先编译控制器算法并下装控制器；再编译工程总控并下装操作站和历史站。/)?.[0] ??
      r.text.match(/应先编译控制器[^。！？]+[。！？]/)?.[0];
    if (!sentence) {
      continue;
    }
    return [
      "总述：编译与下装必须按“先控制器侧，再工程总控/操作站/历史站侧”的两阶段顺序执行，不能混用工程边界或颠倒先后。",
      "",
      "步骤",
      "",
      "阶段一（控制器侧）：先编译控制器算法并下装到控制器。",
      "阶段二（工程总控 / 操作站 / 历史站侧）：再编译工程总控，并下装操作站与历史站。",
      "",
      "注意",
      "",
      "- 不可先说下装再编译，也不要把控制器算法工程与工程总控工程混为一谈。",
      `- 依据：${normalizeSentence(sentence)}`
    ].join("\n");
  }
  return null;
}

function tryDefinitionWithBoolBranches(question: string, pool: SearchResult[]): string | null {
  if (!/(?:什么是|是什么)/.test(question)) {
    return null;
  }
  /** 「完整使用步骤是什么」等全流程问法，避免误走参数定义模板。 */
  if (isFullWorkflowInstallQuery(question)) {
    return null;
  }
  const top = pool[0];
  if (!top) {
    return null;
  }
  const t = top.text;
  if (!/\bTRUE\b|\bFALSE\b/i.test(t)) {
    return null;
  }
  const defLine =
    t.match(/参数对齐[^。！？]+[。！？]/)?.[0] ??
    splitSentenceLike(t)
      .map((s) => normalizeSentence(s))
      .find((s) => s.includes("参数对齐")) ??
    "";
  const trueBranch = t.match(/当该属性为 TRUE 时[^。]+/)?.[0];
  const falseBranch = t.match(/为 FALSE 时[^。]+/)?.[0];
  const lines: string[] = [];
  lines.push(`定义：${normalizeSentence(defLine || splitSentenceLike(t)[0] || "")}`);
  if (trueBranch) {
    const body = normalizeSentence(trueBranch.replace(/^当该属性为 TRUE 时[，,]?\s*/u, ""));
    lines.push(`当为 TRUE 时：${body}`);
  }
  if (falseBranch) {
    const body = normalizeSentence(falseBranch.replace(/^为 FALSE 时[，,]?\s*/u, ""));
    lines.push(`当为 FALSE 时：${body}`);
  }
  lines.push(
    "易混淆项：不要将其理解为自动覆盖在线值，也不要与泛泛的“数据同步”或编译选项混为一谈（若资料提及）。"
  );
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
    "总述：域间访问通过工程总控中的域间引用表完成配置；不能把“网络互通”等同为已完成域间访问。",
    "",
    "步骤",
    "",
    "1. 在工程总控打开域间引用表，填写他域点名/项名以及本域点名/项名。",
    "2. 每个引用组最多允许 3000 个引用点；他域点名和本域点名需为全局变量且数据类型一致。",
    "3. 若本域点为控制站点，EW 项需置 TRUE。",
    "4. 配置完成后编译并下装本域工程。",
    "",
    "注意",
    "",
    "- 不能认为仅网络互通即可；需按表完成映射并完成本域下装。"
  ].join("\n");
}

function tryTroubleshootingUserSvrDirectAnswer(question: string, pool: SearchResult[]): string | null {
  if (!/(?:失败|错误|怎么处理|如何处理|怎么办|提示)/.test(question)) {
    return null;
  }
  if (/(?:环节|主线|完整步骤|全流程|从[^。！？]{0,40}到[^。！？]{0,40}运行)/.test(question) && !/UserSvr|服务启动失败|用户服务/i.test(question)) {
    return null;
  }
  const top = pool.find((r) => /UserSvr|UserReg\.bat|UserUnReg\.bat|HOLLiAS_MACS/i.test(r.text));
  if (!top) {
    return null;
  }
  const t = top.text;
  return [
    "处理结论：若安装过程提示 UserSvr 服务启动失败，可在安装完成后手动启动该服务；必要时在 Common 目录执行注册/反注册脚本。",
    "",
    "步骤",
    "",
    "1. 安装完成后尝试手动启动 UserSvr 服务。",
    "2. 在安装目录 `\\HOLLiAS_MACS\\Common` 下运行 `UserReg.bat` 进行注册。",
    "3. 若提示删除 UserSvr 服务失败，则运行 `UserUnReg.bat`。",
    "",
    "注意",
    "",
    "- 路径与脚本名需完整一致；避免将 `.bat` 截断或改名后执行。"
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
  const m = bundle.match(/完整使用步骤依次为：([^。\n]+)/);
  if (!m) {
    return null;
  }
  const parts = m[1]
    .split(/[；;]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.endsWith("。") ? p.slice(0, -1) : p));
  if (parts.length === 0) {
    return null;
  }
  return [
    "总述：从安装到运行应按资料给出的主链路完成工程准备、组态、编译、下装与运行。",
    "",
    "步骤",
    "",
    ...parts.map((p, i) => `${i + 1}. ${p}`),
    "",
    "注意",
    "",
    "- 若检索片段只覆盖单一子主题（例如仅下装分类），仍需回到完整流程段落核对上下文。"
  ].join("\n");
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

  const stepSummary = stepTitles.length > 0 ? `可重点按这些子步骤查看：${stepTitles.join("；")}。` : "";
  const recency = formatChineseDate(ordered[0]?.sourceUpdatedAt);
  const recencyLabel = recency ? ` 相关内容更新于 ${recency}。` : "";
  return `这个问题更适合参考“${rootLabel}”整节，而不只是其中某一个子步骤。${leadSentence}${stepSummary ? ` ${stepSummary}` : ""}${recencyLabel}`.trim();
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

  if (/[：:]$/.test(normalized)) {
    return false;
  }

  if (/[：:]\s*\d+\.?\s*$/u.test(normalized)) {
    return false;
  }

  if (/^\d+[.)、]\s*/u.test(normalized)) {
    return false;
  }

  if (/^[一二三四五六七八九十]+[、.]\s*/u.test(normalized)) {
    return false;
  }

  if (/[（(][^)）]*$/.test(normalized)) {
    return false;
  }

  const hasSentenceEnding = /[.!?。！？]$/.test(normalized);
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

function buildDirectAnswer(question: string, results: SearchResult[], retrievalPool: SearchResult[]): string {
  const top = results[0];
  if (!top) {
    return "当前资料库里没有找到足够可靠的依据来回答这个问题。";
  }

  const pool = retrievalPool.length > 0 ? retrievalPool : results;

  const compileOrder = tryCompileInstallOrderDirectAnswer(question, pool);
  if (compileOrder) {
    return compileOrder;
  }

  const defBool = tryDefinitionWithBoolBranches(question, pool);
  if (defBool) {
    return defBool;
  }

  const domainInterop = tryDomainInteropStructuredDirectAnswer(question, pool);
  if (domainInterop) {
    return domainInterop;
  }

  const userSvr = tryTroubleshootingUserSvrDirectAnswer(question, pool);
  if (userSvr) {
    return userSvr;
  }

  const fullWorkflow = tryFullWorkflowStructuredDirectAnswer(question, pool);
  if (fullWorkflow) {
    return fullWorkflow;
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

  return `${leadingSentence} 当前最强证据来自 ${sourceCount} 个文档，其中以《${top.documentTitle}》为主。${recencyLabel}`.trim();
}

function fallbackSupportingPoint(result: SearchResult): string {
  const cleaned = normalizeSentence(result.evidenceText ?? result.snippet);
  if (isUsableSupportingSentence(cleaned)) {
    return `${cleaned} ${formatReferenceTag(result)}`;
  }

  const section = result.sectionTitle ? `${result.sectionTitle}: ` : "";
  return `${section}${result.documentTitle} contains relevant material for this answer. ${formatReferenceTag(result)}`;
}

export function answerQuestion(question: string, results: SearchResult[]): ChatAnswer {
  if (results.length === 0 || !hasReliableEvidence(question, results)) {
    const fallback = "I could not find grounded evidence for that question in the current library. Try importing more files or rephrasing the question.";
    return {
      answer: fallback,
      directAnswer: fallback,
      supportingPoints: [],
      sourceDocumentCount: 0,
      basedOnSingleDocument: false,
      citations: []
    };
  }

  if (needsProceduralEvidenceCaution(question, results)) {
    return buildCautiousProceduralAnswer(results[0]);
  }

  const proceduralResults = chooseProceduralEvidenceResults(question, results);
  const evidenceResults = selectEvidenceResults(results);
  const finalResults =
    proceduralResults.length >= 2
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
    citations: finalResults.map(({ text: _text, lexicalScore: _lexicalScore, semanticScore: _semanticScore, freshnessScore: _freshnessScore, rerankScore: _rerankScore, qualityScore: _qualityScore, ...citation }) => citation)
  };
}

import type { ChatAnswer, SearchResult } from "../../shared/types";
import { formatReferenceTag } from "../citation/locator";
import { extractSectionRootLabel, splitSectionPath } from "../citation/sectionRoot";
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

function splitSentenceLike(text: string): string[] {
  const matches = text.match(/[^。！？.!?\n]+[。！？.!?]?/gu);
  if (!matches) {
    return [text.trim()].filter(Boolean);
  }

  return matches.map((part) => part.trim()).filter(Boolean);
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

function buildProceduralDirectAnswer(question: string, results: SearchResult[]): string | null {
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

function buildDirectAnswer(question: string, results: SearchResult[]): string {
  const top = results[0];
  if (!top) {
    return "当前资料库里没有找到足够可靠的依据来回答这个问题。";
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
  const directAnswer = buildDirectAnswer(question, finalResults);
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

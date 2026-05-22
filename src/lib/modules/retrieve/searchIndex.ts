import type { ChunkRecord, DocumentRecord, SearchResult, SearchScoreBreakdown } from "../../shared/types";
import { cosineSimilarity as cosineSimilarityVector } from "../embed/localEmbedder";
import { formatEvidenceAnchorLabel } from "../citation/locator";
import { extractSectionRootLabel } from "../citation/sectionRoot";
import { detectQueryIntent } from "./queryIntent";
import { retrievalHaystack } from "./retrievalHaystack";
import { computeNoiseChunkPenalty } from "./noiseChunkPenalty";
import { normalizeForLexicalMatch } from "./termNormalize";
import { buildChunkContextMetadata } from "./chunkContextMetadata";
import { expandQueryTokens, isRoleQuestion, maxConsecutiveTokenMatch, selectAnchorTokens } from "./queryFeatures";
import {
  chunkQualityScore,
  intentMismatchPenalty,
  intentSectionBoost,
  mismatchPenalty,
  phraseBoost,
  roleAnswerBoost,
  sentenceMatchScore,
  titleBoost
} from "./rankingSignals";
import { charNgrams, cosineSimilarity, jaccardSimilarity, termFrequency } from "./searchMath";
import { tokenize } from "./tokenize";

interface CandidateScore {
  chunk: ChunkRecord;
  document: DocumentRecord;
  sectionRootLabel: string | null;
  lexicalScore: number;
  semanticScore: number;
  freshnessScore: number;
  rerankScore: number;
  qualityScore: number;
  score: number;
  scoreBreakdown: SearchScoreBreakdown;
  penalty: number;
  coverage: number;
  evidenceCoverage: number;
  matchedAnchorCount: number;
  evidenceText: string;
  evidenceScore: number;
}

export type SearchRejectionReason =
  | "very_low_score"
  | "high_penalty"
  | "role_question_without_role_evidence"
  | "low_quality_weak_match"
  | "low_query_coverage"
  | "anchor_tokens_not_satisfied";

export interface SearchRejectedCandidateDiagnostic {
  chunkId: string;
  fileName: string;
  sectionTitle: string | null;
  score: number;
  lexicalScore: number;
  semanticScore: number;
  rerankScore: number;
  qualityScore: number;
  penalty: number;
  coverage: number;
  evidenceCoverage: number;
  matchedAnchorCount: number;
  reasons: SearchRejectionReason[];
}

export interface SearchDiagnostics {
  evaluatedCandidateCount: number;
  primaryCandidateCount: number;
  rejectedCandidateCount: number;
  sampledRejected: SearchRejectedCandidateDiagnostic[];
}

interface EvidenceCandidate {
  text: string;
  index: number;
}

interface SectionRootGroupStats {
  count: number;
  topScore: number;
  aggregateScore: number;
}

export function createEmptySearchDiagnostics(): SearchDiagnostics {
  return {
    evaluatedCandidateCount: 0,
    primaryCandidateCount: 0,
    rejectedCandidateCount: 0,
    sampledRejected: []
  };
}

function buildSearchRejectionReasons(input: {
  score: number;
  penalty: number;
  roleQuestionWithoutRoleEvidence: boolean;
  lowQualityWeakMatch: boolean;
  coverage: number;
  minimumCoverage: number;
  hasStrongSignal: boolean;
  anchorSatisfied: boolean;
  highPenaltyAllowed: boolean;
}): SearchRejectionReason[] {
  const reasons: SearchRejectionReason[] = [];
  if (input.score <= 0.02) reasons.push("very_low_score");
  if (input.penalty >= 1.4 && !input.highPenaltyAllowed) reasons.push("high_penalty");
  if (input.roleQuestionWithoutRoleEvidence) reasons.push("role_question_without_role_evidence");
  if (input.lowQualityWeakMatch) reasons.push("low_quality_weak_match");
  if (input.coverage < input.minimumCoverage && !input.hasStrongSignal) reasons.push("low_query_coverage");
  if (!input.anchorSatisfied && !input.hasStrongSignal) reasons.push("anchor_tokens_not_satisfied");
  return reasons;
}

function toRejectedCandidateDiagnostic(
  candidate: CandidateScore,
  reasons: SearchRejectionReason[]
): SearchRejectedCandidateDiagnostic {
  return {
    chunkId: candidate.chunk.id,
    fileName: candidate.document.fileName,
    sectionTitle: candidate.chunk.sectionTitle ?? null,
    score: candidate.score,
    lexicalScore: candidate.lexicalScore,
    semanticScore: candidate.semanticScore,
    rerankScore: candidate.rerankScore,
    qualityScore: candidate.qualityScore,
    penalty: candidate.penalty,
    coverage: candidate.coverage,
    evidenceCoverage: candidate.evidenceCoverage,
    matchedAnchorCount: candidate.matchedAnchorCount,
    reasons
  };
}

function findHighlightRange(fullText: string, evidenceText: string | null | undefined): {
  highlightText: string | null;
  highlightStart: number | null;
  highlightEnd: number | null;
  sentenceIndex: number | null;
} {
  const normalizedEvidence = evidenceText?.trim();
  if (!normalizedEvidence) {
    return {
      highlightText: null,
      highlightStart: null,
      highlightEnd: null,
      sentenceIndex: null
    };
  }

  const directIndex = fullText.indexOf(normalizedEvidence);
  if (directIndex >= 0) {
    const sentenceIndex = findSentenceIndex(fullText, normalizedEvidence, directIndex, directIndex + normalizedEvidence.length);
    return {
      highlightText: normalizedEvidence,
      highlightStart: directIndex,
      highlightEnd: directIndex + normalizedEvidence.length,
      sentenceIndex
    };
  }

  const compactFullText = fullText.replace(/\s+/g, " ");
  const compactEvidence = normalizedEvidence.replace(/\s+/g, " ");
  const compactIndex = compactFullText.indexOf(compactEvidence);
  if (compactIndex >= 0) {
    const sentenceIndex = findSentenceIndex(fullText, normalizedEvidence, null, null);
    return {
      highlightText: compactEvidence,
      highlightStart: null,
      highlightEnd: null,
      sentenceIndex
    };
  }

  return {
    highlightText: normalizedEvidence,
    highlightStart: null,
    highlightEnd: null,
    sentenceIndex: findSentenceIndex(fullText, normalizedEvidence, null, null)
  };
}

function splitSentenceSpans(text: string): Array<{ text: string; start: number; end: number }> {
  const matches = text.matchAll(/[^。！？.!?\n]+[。！？.!?\n]?/gu);
  const spans: Array<{ text: string; start: number; end: number }> = [];

  for (const match of matches) {
    const rawText = match[0] ?? "";
    const rawStart = match.index ?? 0;
    const leadingTrimmed = rawText.match(/^\s*/u)?.[0].length ?? 0;
    const trailingTrimmed = rawText.match(/\s*$/u)?.[0].length ?? 0;
    const trimmedText = rawText.trim();

    if (!trimmedText) {
      continue;
    }

    spans.push({
      text: trimmedText,
      start: rawStart + leadingTrimmed,
      end: rawStart + rawText.length - trailingTrimmed
    });
  }

  return spans;
}

function normalizeComparableText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function findSentenceIndex(
  fullText: string,
  evidenceText: string,
  highlightStart: number | null,
  highlightEnd: number | null
): number | null {
  const sentenceSpans = splitSentenceSpans(fullText);
  if (sentenceSpans.length === 0) {
    return null;
  }

  if (highlightStart !== null && highlightEnd !== null) {
    const directMatchIndex = sentenceSpans.findIndex((span) => highlightStart < span.end && highlightEnd > span.start);
    if (directMatchIndex >= 0) {
      return directMatchIndex + 1;
    }
  }

  const normalizedEvidence = normalizeComparableText(evidenceText);
  if (!normalizedEvidence) {
    return null;
  }

  const fallbackIndex = sentenceSpans.findIndex((span) => {
    const normalizedSentence = normalizeComparableText(span.text);
    return normalizedSentence.includes(normalizedEvidence) || normalizedEvidence.includes(normalizedSentence);
  });

  return fallbackIndex >= 0 ? fallbackIndex + 1 : null;
}

function getDocumentTimestamp(document: DocumentRecord): number {
  const candidate = document.sourceUpdatedAt ?? document.updatedAt ?? document.importedAt;
  const value = candidate ? Date.parse(candidate) : Number.NaN;
  return Number.isNaN(value) ? 0 : value;
}

function normalizeFreshness(timestamp: number, minTimestamp: number, maxTimestamp: number): number {
  if (maxTimestamp <= minTimestamp) {
    return 0.5;
  }

  return (timestamp - minTimestamp) / (maxTimestamp - minTimestamp);
}

function getChunkContext(chunk: ChunkRecord, document: DocumentRecord): string {
  return [document.title, document.fileName, retrievalHaystack(chunk)].filter(Boolean).join("\n");
}

function splitSentenceLike(text: string): string[] {
  const matches = text.match(/[^。！？.!?\n]+[。！？.!?]?/gu);
  if (!matches) {
    return [text.trim()].filter(Boolean);
  }

  return matches.map((part) => part.trim()).filter(Boolean);
}

function normalizeEvidenceLine(line: string): string {
  return line
    .trim()
    .replace(/^>+\s*/, "")
    .replace(/^```+\s*/, "")
    .replace(/```+$/, "")
    .replace(/^(?:[*\-•■□●○◆◇▪◦]|\d+[.)、）]|[一二三四五六七八九十]+[.)、）])\s*/u, "")
    .trim();
}

function isSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  return !trimmed || /^[-*_]{3,}$/.test(trimmed) || /^```+$/.test(trimmed);
}

function shouldMergeEvidenceLines(current: string, next: string): boolean {
  if (!current || !next) {
    return false;
  }

  if (/[：:]$/.test(current)) {
    return true;
  }

  if (current.length <= 12 && next.length <= 40) {
    return true;
  }

  if (/(全称|翻译为|步骤|流程|目标|目的|原因|一句话|核心思想|作用|价值|好处|例如|包括|包含)/.test(current)) {
    return true;
  }

  if (/^(?:先|再|然后|最后|首先|因为|由于|如果|通过|文档准备|文本切分|向量化|向量检索|llm)/i.test(next)) {
    return true;
  }

  return false;
}

function extractEvidenceCandidates(text: string): EvidenceCandidate[] {
  const rawLines = text.replace(/\r\n/g, "\n").split(/\n+/).map((line) => line.trim());
  const lines = rawLines.filter((line) => !isSeparatorLine(line));
  const candidates: EvidenceCandidate[] = [];

  lines.forEach((line, index) => {
    const normalizedLine = normalizeEvidenceLine(line);
    if (!normalizedLine) {
      return;
    }

    candidates.push({ text: normalizedLine, index });

    const nextLine = normalizeEvidenceLine(lines[index + 1] ?? "");
    if (shouldMergeEvidenceLines(normalizedLine, nextLine)) {
      candidates.push({
        text: `${normalizedLine} ${nextLine}`.trim(),
        index
      });

      const thirdLine = normalizeEvidenceLine(lines[index + 2] ?? "");
      if (thirdLine && (/[：:]$/.test(normalizedLine) || /^(?:先|再|然后|最后|首先|\d+[.)、）])/.test(nextLine))) {
        candidates.push({
          text: `${normalizedLine} ${nextLine} ${thirdLine}`.trim(),
          index
        });
      }
    }

    splitSentenceLike(normalizedLine)
      .filter((sentence) => sentence !== normalizedLine)
      .forEach((sentence) => {
        candidates.push({ text: sentence, index });
      });
  });

  return candidates.filter((candidate, index, array) => array.findIndex((item) => item.text === candidate.text) === index);
}

function isEvidenceLikeSentence(sentence: string): boolean {
  const trimmed = sentence.trim();
  if (!trimmed) {
    return false;
  }

  if (/^#{1,6}\s/.test(trimmed) || /^>+\s*/.test(trimmed)) {
    return false;
  }

  if (/[?？]$/.test(trimmed)) {
    return false;
  }

  if (/^(?:\*|-|•|\d+[.)、]|[一二三四五六七八九十]+[、.])\s*$/.test(trimmed)) {
    return false;
  }

  if (/^(?:例如|比如|如果面试官问|推荐回答|一句话记忆|核心思想|系统流程|流程：?)[:：]?$/.test(trimmed)) {
    return false;
  }

  if (/(面试官问|推荐回答|可以这样描述|建议回答|标准回答模板)/.test(trimmed)) {
    return false;
  }

  if (/^[【\[].+[】\]]\s*[；;:：。.]?$/.test(trimmed)) {
    return false;
  }

  if (/[：:]$/.test(trimmed) && trimmed.length < 18) {
    return false;
  }

  if (trimmed.length >= 12) {
    return true;
  }

  return /(检索增强生成|retrieval-augmented generation|rag|lora|steam_total|opc|向量化|向量检索|llm|主汽压力|锅炉响应速度)/i.test(trimmed);
}

function bestSentenceEvidence(
  chunk: ChunkRecord,
  query: string,
  queryTokens: string[],
  anchorTokens: string[],
  intent: ReturnType<typeof detectQueryIntent>
): { evidenceText: string; evidenceScore: number; snippet: string } {
  const evidenceCandidates = extractEvidenceCandidates(chunk.text);
  const rankedSentences = evidenceCandidates
    .filter((candidate) => isEvidenceLikeSentence(candidate.text))
    .map((candidate) => ({
      sentence: candidate.text,
      index: candidate.index,
      score: sentenceMatchScore(candidate.text, query, queryTokens, anchorTokens, intent)
    }))
    .sort((left, right) => right.score - left.score);

  const best = rankedSentences[0];
  if (!best || best.score <= 0) {
    const fallback = chunk.text.length > 420 ? `${chunk.text.slice(0, 417)}...` : chunk.text;
    return { evidenceText: chunk.text, evidenceScore: 0, snippet: fallback };
  }

  const snippetParts = [best.sentence];
  const snippetCandidates = evidenceCandidates.filter((candidate) => candidate.index === best.index || candidate.index === best.index + 1);
  const nextSentence = snippetCandidates.find((candidate) => candidate.index === best.index + 1)?.text;
  const shouldAppendNextSentence = Boolean(nextSentence) && (/[：:(（"“]$/.test(best.sentence) || best.sentence.length < 28);
  if (shouldAppendNextSentence && nextSentence) {
    snippetParts.push(nextSentence);
  }

  let snippet = snippetParts.join(" ");
  if (snippet.length > 420) {
    const cutoff = snippet.slice(0, 420);
    const punctuationIndex = Math.max(cutoff.lastIndexOf("。"), cutoff.lastIndexOf(". "), cutoff.lastIndexOf("！"), cutoff.lastIndexOf("？"));
    snippet = punctuationIndex > 220 ? cutoff.slice(0, punctuationIndex + 1).trim() : `${cutoff.trimEnd()}...`;
  }

  return { evidenceText: best.sentence, evidenceScore: best.score, snippet };
}

function parseEmbedding(raw: string | null | undefined): number[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((value) => Number(value) || 0) : [];
  } catch {
    return [];
  }
}

function dedupeByDocumentBalance(results: SearchResult[], limit: number): SearchResult[] {
  const selected: SearchResult[] = [];
  const perDocumentCount = new Map<string, number>();

  for (const result of results) {
    const count = perDocumentCount.get(result.documentId) ?? 0;
    const allowAnotherFromSameDocument = selected.length < 2 || count < 2;
    if (!allowAnotherFromSameDocument) {
      continue;
    }

    selected.push(result);
    perDocumentCount.set(result.documentId, count + 1);
    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function buildSectionRootGroupStats(candidates: CandidateScore[]): Map<string, SectionRootGroupStats> {
  const groups = new Map<string, SectionRootGroupStats>();

  for (const candidate of candidates) {
    const label = candidate.sectionRootLabel;
    if (!label) {
      continue;
    }

    const current = groups.get(label) ?? {
      count: 0,
      topScore: Number.NEGATIVE_INFINITY,
      aggregateScore: 0
    };

    current.count += 1;
    current.topScore = Math.max(current.topScore, candidate.score);
    current.aggregateScore += candidate.score;
    groups.set(label, current);
  }

  return groups;
}

function proceduralSectionRootBoost(
  intent: ReturnType<typeof detectQueryIntent>,
  candidate: CandidateScore,
  groups: Map<string, SectionRootGroupStats>,
  topScore: number
): number {
  if (!intent.wantsSteps || !candidate.sectionRootLabel) {
    return 0;
  }

  const group = groups.get(candidate.sectionRootLabel);
  if (!group || group.count < 2) {
    return 0;
  }

  if (group.topScore < topScore * 0.74) {
    return 0;
  }

  const coverageBoost = Math.min(0.95, (group.count - 1) * 0.28);
  const aggregateBoost = Math.min(0.8, Math.max(0, group.aggregateScore - group.topScore) * 0.06);
  return coverageBoost + aggregateBoost;
}

export function searchChunks(
  query: string,
  documents: DocumentRecord[],
  chunks: ChunkRecord[],
  limit = 6,
  queryEmbedding: number[] | null = null,
  diagnostics?: SearchDiagnostics
): SearchResult[] {
  if (diagnostics) {
    Object.assign(diagnostics, createEmptySearchDiagnostics());
  }

  // B5: normalize only for lexical matching signals; do not mutate stored chunk text/snippets.
  const lexicalQuery = normalizeForLexicalMatch(query);
  const intent = detectQueryIntent(lexicalQuery);
  const queryTokens = [...new Set([...intent.queryTokens, ...expandQueryTokens(lexicalQuery, intent)])];
  if (queryTokens.length === 0) {
    return [];
  }

  const documentMap = new Map(documents.map((document) => [document.id, document]));
  const queryNgrams = charNgrams(lexicalQuery);
  const anchorTokens = selectAnchorTokens(queryTokens);
  const effectiveTokens = anchorTokens.length > 0 ? anchorTokens : queryTokens;
  const chunkTokens = chunks.map((chunk) => tokenize(normalizeForLexicalMatch(retrievalHaystack(chunk))));
  const documentFrequency = new Map<string, number>();

  for (const tokens of chunkTokens) {
    for (const token of new Set(tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const timestamps = documents.map(getDocumentTimestamp);
  const minTimestamp = Math.min(...timestamps, Date.now());
  const maxTimestamp = Math.max(...timestamps, Date.now());
  const totalChunks = Math.max(1, chunks.length);
  const recencyWeight = intent.wantsRecency ? 0.9 : 0.35;

  const evaluatedCandidates = chunks
    .map((chunk, index): { candidate: CandidateScore; keepInPrimaryRanking: boolean; rejectionReasons: SearchRejectionReason[] } | null => {
      const document = documentMap.get(chunk.documentId);
      if (!document) {
        return null;
      }

      const tokens = chunkTokens[index] ?? [];
      const frequencies = termFrequency(tokens);
      const contextText = getChunkContext(chunk, document);
      const lexicalContextText = normalizeForLexicalMatch(contextText);
      const metadataTokens = tokenize(
        normalizeForLexicalMatch([document.title, chunk.sectionTitle, chunk.sectionPath].filter(Boolean).join(" "))
      );
      const embeddingScore = queryEmbedding ? cosineSimilarityVector(queryEmbedding, parseEmbedding(chunk.embedding)) * 3.2 : 0;
      const exactTitleBoost = titleBoost(query, document, chunk);
      const sectionBoost = intentSectionBoost(intent, chunk, document);
      const evidence = bestSentenceEvidence(chunk, query, queryTokens, anchorTokens, intent);

      let lexicalScore = 0;
      for (const token of queryTokens) {
        const tf = frequencies.get(token) ?? 0;
        const df = documentFrequency.get(token) ?? 0;
        const idf = Math.log(1 + totalChunks / (1 + df));
        lexicalScore += tf * idf;
        // P0-B: 章节标题命中权重提升（2.0→3.0），解决跨卷章节级检索精度不足
        if (metadataTokens.includes(token)) {
          lexicalScore += 3.0;
        }
        // P0-B: 文本中也命中则额外加分
        if (tokens.includes(token)) {
          lexicalScore += tf > 0 ? 0.6 : 0;
        }
      }

      lexicalScore += phraseBoost(lexicalQuery, lexicalContextText) + exactTitleBoost + sectionBoost * 0.4;

      const semanticScore =
        cosineSimilarity(queryNgrams, charNgrams(lexicalContextText)) * 2.2 +
        jaccardSimilarity(queryTokens, tokens) * 1.4 +
        jaccardSimilarity(queryTokens, metadataTokens) * 1.1 +
        embeddingScore;

      const freshnessScore = normalizeFreshness(getDocumentTimestamp(document), minTimestamp, maxTimestamp);
      const matchedTokenCount = effectiveTokens.filter((token) => lexicalContextText.toLowerCase().includes(token)).length;
      const coverage = matchedTokenCount / effectiveTokens.length;
      const matchedAnchorCount = anchorTokens.filter((token) => lexicalContextText.toLowerCase().includes(token)).length;
      const metadataBoost = chunk.sectionTitle ? 0.18 : 0;
      const longestMatch = maxConsecutiveTokenMatch(queryTokens, lexicalContextText);
      const qualityScore = chunkQualityScore(chunk.text, chunk, document);
      const evidenceMatchedTokenCount = effectiveTokens.filter((token) => evidence.evidenceText.toLowerCase().includes(token.toLowerCase())).length;
      const evidenceCoverage = effectiveTokens.length > 0 ? evidenceMatchedTokenCount / effectiveTokens.length : 0;
      const rerankScore =
        coverage * 1.35 +
        phraseBoost(lexicalQuery, normalizeForLexicalMatch(retrievalHaystack(chunk))) * 0.45 +
        metadataBoost +
        longestMatch * 0.08 +
        // P0-B: sectionBoost权重提升 0.55→1.15，强化章节意图匹配
        sectionBoost * 1.15 +
        evidenceCoverage * (intent.wantsSteps ? 1.2 : 0.55) +
        roleAnswerBoost(query, evidence.evidenceText, chunk, document) +
        evidence.evidenceScore * 0.72 +
        Math.max(0, qualityScore) * 0.15;
      const noisePenalty = computeNoiseChunkPenalty({
        chunk,
        document,
        evidenceText: evidence.evidenceText,
        intent,
        qualityScore
      });
      const penalty =
        mismatchPenalty(query, contextText) +
        intentMismatchPenalty(intent, chunk, document, evidence.evidenceText) +
        (intent.wantsSteps && anchorTokens.length > 0 && evidenceCoverage < 0.18 ? 0.45 : 0) +
        Math.max(0, -qualityScore) * 0.9 +
        noisePenalty;
      const score =
        lexicalScore * 0.42 +
        semanticScore * 0.31 +
        rerankScore * 0.22 +
        freshnessScore * recencyWeight +
        qualityScore * 0.34 -
        penalty;
      const scoreBreakdown: SearchScoreBreakdown = {
        lexicalContribution: lexicalScore * 0.42,
        semanticContribution: semanticScore * 0.31,
        rerankContribution: rerankScore * 0.22,
        freshnessContribution: freshnessScore * recencyWeight,
        qualityContribution: qualityScore * 0.34,
        penaltyContribution: -penalty,
        sectionRootBoost: 0,
        finalScore: score
      };
      const minimumCoverage = queryTokens.length >= 3 ? 0.26 : 0.18;
      const roleLikeStrongSignal =
        isRoleQuestion(query) &&
        /(用于|用来|负责|完成|实现|作用是)/.test(evidence.evidenceText) &&
        anchorTokens.some((token) => contextText.toLowerCase().includes(token.toLowerCase()));
      const hasStrongSignal =
        phraseBoost(lexicalQuery, lexicalContextText) > 0 ||
        embeddingScore > 0.55 ||
        exactTitleBoost > 0 ||
        longestMatch >= 4 ||
        evidence.evidenceScore >= 1.3 ||
        roleLikeStrongSignal;
      const anchorSatisfied = anchorTokens.length === 0 || matchedAnchorCount >= Math.min(2, Math.max(1, Math.ceil(anchorTokens.length / 3)));
      const lowQualityWeakMatch = qualityScore < -0.35 && !hasStrongSignal && coverage < 0.55;
      const roleQuestionWithoutRoleEvidence =
        isRoleQuestion(query) &&
        /安装|步骤|下一步|安装内容|单击|点击|勾选/.test([chunk.sectionTitle, chunk.sectionPath, evidence.evidenceText].filter(Boolean).join(" ")) &&
        !/(用于|用来|负责|完成|实现|作用是)/.test(evidence.evidenceText);

      const rejectionReasons = buildSearchRejectionReasons({
        score,
        penalty,
        roleQuestionWithoutRoleEvidence,
        lowQualityWeakMatch,
        coverage,
        minimumCoverage,
        hasStrongSignal,
        anchorSatisfied,
        highPenaltyAllowed: hasStrongSignal && score >= 3
      });
      const keepInPrimaryRanking = rejectionReasons.length === 0;

      return {
        candidate: {
          chunk,
          document,
          sectionRootLabel: extractSectionRootLabel(chunk.sectionPath),
          lexicalScore,
          semanticScore,
          freshnessScore,
          rerankScore,
          qualityScore,
          score,
          scoreBreakdown,
          penalty,
          coverage,
          evidenceCoverage,
          matchedAnchorCount,
          evidenceText: evidence.evidenceText,
          evidenceScore: evidence.evidenceScore
        },
        keepInPrimaryRanking,
        rejectionReasons
      };
    })
    .filter((item): item is { candidate: CandidateScore; keepInPrimaryRanking: boolean; rejectionReasons: SearchRejectionReason[] } => item !== null);

  const primaryCandidates = evaluatedCandidates
    .filter((item) => item.keepInPrimaryRanking)
    .map((item) => item.candidate);

  if (diagnostics) {
    diagnostics.evaluatedCandidateCount = evaluatedCandidates.length;
    diagnostics.primaryCandidateCount = primaryCandidates.length;
    diagnostics.rejectedCandidateCount = Math.max(0, evaluatedCandidates.length - primaryCandidates.length);
    diagnostics.sampledRejected = evaluatedCandidates
      .filter((item) => !item.keepInPrimaryRanking)
      .sort((left, right) => right.candidate.score - left.candidate.score)
      .slice(0, 8)
      .map((item) => toRejectedCandidateDiagnostic(item.candidate, item.rejectionReasons));
  }
  const baseTopScore = primaryCandidates.reduce((max, candidate) => Math.max(max, candidate.score), 0);
  const sectionRootGroups = buildSectionRootGroupStats(primaryCandidates);
  const sortedCandidates = primaryCandidates
    .map((candidate) => {
      const sectionRootBoost = proceduralSectionRootBoost(intent, candidate, sectionRootGroups, baseTopScore);
      const finalScore = candidate.score + sectionRootBoost;
      return {
        ...candidate,
        score: finalScore,
        scoreBreakdown: {
          ...candidate.scoreBreakdown,
          sectionRootBoost,
          finalScore
        }
      };
    })
    .sort((left, right) => right.score - left.score);

  const rescuedRoleCandidates = isRoleQuestion(query)
    ? evaluatedCandidates
        .map((item) => item.candidate)
        .filter((candidate) =>
          /(用于|用来|负责|完成|实现|作用是)/.test(candidate.evidenceText) &&
          anchorTokens.some((token) => candidate.evidenceText.toLowerCase().includes(token.toLowerCase())) &&
          /系统组成|功能介绍|软件介绍|说明|概述|简介/.test([candidate.chunk.sectionTitle, candidate.chunk.sectionPath].filter(Boolean).join(" "))
        )
        .sort((left, right) => right.score - left.score)
        .slice(0, 3)
    : [];

  const topProceduralRoot = intent.wantsSteps ? sortedCandidates[0]?.sectionRootLabel ?? null : null;
  const rescuedProceduralCandidates = topProceduralRoot
    ? evaluatedCandidates
        .map((item) => item.candidate)
        .filter((candidate) =>
          candidate.sectionRootLabel === topProceduralRoot &&
          candidate.chunk.id !== sortedCandidates[0]?.chunk.id &&
          (candidate.evidenceScore >= 0.65 || candidate.rerankScore >= 1.05 || candidate.semanticScore >= 0.75)
        )
        .sort((left, right) => right.score - left.score)
        .slice(0, 3)
    : [];

  const candidates = [...sortedCandidates.slice(0, Math.max(limit * 3, 8)), ...rescuedRoleCandidates, ...rescuedProceduralCandidates]
    .filter((candidate, index, array) => array.findIndex((item) => item.chunk.id === candidate.chunk.id) === index)
    .sort((left, right) => right.score - left.score);

  const results = candidates
    .map((candidate) => {
      const { chunk, document } = candidate;
      const evidence = bestSentenceEvidence(chunk, query, queryTokens, anchorTokens, intent);
      const highlight = findHighlightRange(chunk.text, candidate.evidenceScore > 0 ? candidate.evidenceText : evidence.evidenceText);
      return {
        documentId: chunk.documentId,
        fileName: document.fileName,
        documentTitle: document.title,
        chunkId: chunk.id,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        snippet: evidence.snippet,
        evidenceText: candidate.evidenceScore > 0 ? candidate.evidenceText : evidence.evidenceText,
        anchorLabel: formatEvidenceAnchorLabel({
          locatorLabel: chunk.locatorLabel,
          sentenceIndex: highlight.sentenceIndex
        }),
        highlightText: highlight.highlightText,
        highlightStart: highlight.highlightStart,
        highlightEnd: highlight.highlightEnd,
        fullText: chunk.text,
        score: candidate.score,
        lexicalScore: candidate.lexicalScore,
        semanticScore: candidate.semanticScore,
        freshnessScore: candidate.freshnessScore,
        rerankScore: candidate.rerankScore,
        qualityScore: candidate.qualityScore,
        scoreBreakdown: candidate.scoreBreakdown,
        contextMetadata: buildChunkContextMetadata(document, chunk),
        sectionTitle: chunk.sectionTitle,
        sectionPath: chunk.sectionPath,
        sectionRootLabel: candidate.sectionRootLabel,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        paragraphStart: chunk.paragraphStart,
        paragraphEnd: chunk.paragraphEnd,
        locatorLabel: chunk.locatorLabel,
        sourceUpdatedAt: document.sourceUpdatedAt,
        importedAt: document.importedAt
      };
    })
    .sort((left, right) => right.score - left.score);

  const filteredByRelativeScore = results.filter((result, index, array) => {
    const topScore = array[0]?.score ?? 0;
    return index === 0 || result.score >= topScore * 0.42;
  });

  return dedupeByDocumentBalance(filteredByRelativeScore, limit);
}

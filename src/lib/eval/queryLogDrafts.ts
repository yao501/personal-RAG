import type { Citation, EvalCaseDraft, QueryLogRecord } from "../shared/types";
import { isRoleQuestion } from "../modules/retrieve/queryFeatures";
import { detectQueryIntent } from "../modules/retrieve/queryIntent";
import { isCautiousProceduralAnswer } from "../modules/answer/cautiousMarkers";

function slugifyQuestion(question: string): string {
  const normalized = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .trim()
    .replace(/\s+/g, "-");

  return normalized || "eval-case";
}

function inferCategory(question: string): EvalCaseDraft["category"] {
  if (isRoleQuestion(question)) {
    return "role";
  }

  if (/(是什么|是什么样|是多少|多大|多高|多久|多久一次|是谁|哪家|哪个|何时)/u.test(question)) {
    return "definition";
  }

  const intent = detectQueryIntent(question);
  if (intent.primary === "explanatory") {
    return "definition";
  }

  if (intent.primary === "procedural") {
    return "procedure";
  }

  if (intent.primary === "troubleshooting") {
    return "troubleshooting";
  }

  if (intent.primary === "navigational") {
    return "navigational";
  }

  return "general";
}

function cleanEvidenceText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^[>\-*•\d.、()\s]+/u, "")
    .trim();
}

function extractEvidenceIncludes(citation: Citation): string[] {
  const source = cleanEvidenceText(citation.evidenceText ?? citation.snippet);
  const fragments = source
    .split(/[。！？.!?；;]+/u)
    .map((part) => cleanEvidenceText(part))
    .flatMap((part) => part.split(/\s*[|·]\s*/u))
    .filter((part) => part.length >= 4 && part.length <= 48)
    .filter((part) => !/^(当前|本项目|该项目|系统|可以|需要|采用|负责|包括)$/u.test(part));

  const selected = [...new Set(fragments)].slice(0, 2);
  return selected.length > 0 ? selected : [source.slice(0, 32)].filter(Boolean);
}

function isRefusalLog(log: QueryLogRecord): boolean {
  if (log.citations.length > 0 || log.answer.citations.length > 0) {
    return false;
  }
  return /could not find grounded evidence|没有找到足够可靠的依据/i.test(log.answer.directAnswer);
}

export function buildEvalCaseDraft(log: QueryLogRecord): EvalCaseDraft | null {
  const citation = log.citations[0];
  const refusal = isRefusalLog(log);
  if (!citation && !refusal) {
    return null;
  }

  return {
    id: slugifyQuestion(log.question),
    sourceLogId: log.id,
    category: inferCategory(log.question),
    answerMode: refusal ? "refusal" : isCautiousProceduralAnswer(log.answer) ? "cautious" : "grounded",
    question: log.question,
    mustRefuse: refusal,
    expectation: {
      topK: 2,
      fileNameIncludes: citation?.fileName,
      sectionPathIncludes: citation?.sectionPath ? [citation.sectionPath] : undefined,
      evidenceIncludes: citation ? extractEvidenceIncludes(citation) : undefined
    }
  };
}

export function buildEvalCaseDrafts(logs: QueryLogRecord[]): EvalCaseDraft[] {
  return logs
    .map((log) => buildEvalCaseDraft(log))
    .filter((draft): draft is EvalCaseDraft => draft !== null);
}

export function renderEvalCaseDraft(draft: EvalCaseDraft): string {
  const expectedDocs = draft.expectation.fileNameIncludes ? [draft.expectation.fileNameIncludes] : [];
  const benchmarkCase = {
    id: draft.id,
    sourceType: "sanitized",
    expectedAnswerMode: draft.answerMode,
    intentGroup: draft.category,
    question: draft.question,
    expectedDocs,
    ...(draft.expectation.evidenceIncludes?.length ? { expectedFacts: draft.expectation.evidenceIncludes } : {}),
    ...(draft.expectation.fileNameIncludes
      ? { expectedCitations: { fileNameIncludes: [draft.expectation.fileNameIncludes] } }
      : {}),
    mustRefuse: draft.mustRefuse,
    notes: `Promoted from local query log ${draft.sourceLogId}. Review and sanitize source documents before committing.`
  };
  return JSON.stringify(benchmarkCase, null, 2);
}

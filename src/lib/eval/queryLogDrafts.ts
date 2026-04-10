import type { Citation, EvalCaseDraft, QueryLogRecord } from "../shared/types";
import { isRoleQuestion } from "../modules/retrieve/queryFeatures";
import { detectQueryIntent } from "../modules/retrieve/queryIntent";

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

export function buildEvalCaseDraft(log: QueryLogRecord): EvalCaseDraft | null {
  const citation = log.citations[0];
  if (!citation) {
    return null;
  }

  return {
    id: slugifyQuestion(log.question),
    sourceLogId: log.id,
    category: inferCategory(log.question),
    question: log.question,
    expectation: {
      topK: 2,
      fileNameIncludes: citation.fileName,
      sectionPathIncludes: citation.sectionPath ? [citation.sectionPath] : undefined,
      evidenceIncludes: extractEvidenceIncludes(citation)
    }
  };
}

export function buildEvalCaseDrafts(logs: QueryLogRecord[]): EvalCaseDraft[] {
  return logs
    .map((log) => buildEvalCaseDraft(log))
    .filter((draft): draft is EvalCaseDraft => draft !== null);
}

export function renderEvalCaseDraft(draft: EvalCaseDraft): string {
  const lines = [
    "{",
    `  id: "${draft.id}",`,
    `  category: "${draft.category}",`,
    `  question: "${draft.question}",`,
    "  expectations: [",
    "    {",
    `      topK: ${draft.expectation.topK},`
  ];

  if (draft.expectation.fileNameIncludes) {
    lines.push(`      fileNameIncludes: "${draft.expectation.fileNameIncludes}",`);
  }

  if (draft.expectation.sectionPathIncludes?.length) {
    lines.push(`      sectionPathIncludes: ${JSON.stringify(draft.expectation.sectionPathIncludes)},`);
  }

  if (draft.expectation.evidenceIncludes?.length) {
    lines.push(`      evidenceIncludes: ${JSON.stringify(draft.expectation.evidenceIncludes)}`);
  }

  lines.push("    }", "  ]", "}");
  return lines.join("\n");
}

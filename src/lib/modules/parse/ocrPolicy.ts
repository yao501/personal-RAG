import type { DocumentIngestionQualityOcrConfidence, OcrAcceptanceCriterion, OcrPolicySnapshot } from "../../shared/types";

export const OCR_STRONG_TEXT_DENSITY_THRESHOLD = 25;
export const OCR_POSSIBLE_TEXT_DENSITY_THRESHOLD = 80;

export const OCR_REMEDIATION =
  "请使用企业认可的本地或内网 OCR 工具生成可复制文本 PDF，再重新导入或重建索引。";

export const OCR_PRIVACY_NOTE =
  "当前桌面端不会自动执行 OCR，也不会把原始 PDF 内容发送到外部 OCR 服务。";

export const BUNDLED_OCR_ACCEPTANCE_CRITERIA: OcrAcceptanceCriterion[] = [
  {
    id: "licensing_and_distribution",
    status: "required_before_enablement",
    requirement: "OCR engine licensing must allow bundled macOS enterprise desktop distribution.",
    validation: "Record license, model/data redistribution terms, and attribution requirements in release notes.",
    releaseGate: true
  },
  {
    id: "offline_only_execution",
    status: "required_before_enablement",
    requirement: "OCR must run fully locally with no external network calls or document upload path.",
    validation: "Run a network-denied smoke test and inspect logs/support bundle diagnostics for no outbound OCR dependency.",
    releaseGate: true
  },
  {
    id: "structured_failures",
    status: "required_before_enablement",
    requirement: "OCR failures must surface structured stage/code/message/suggestion/retryable diagnostics.",
    validation: "Add unit or integration tests for unreadable PDF, timeout, permission denied, and engine unavailable cases.",
    releaseGate: true
  },
  {
    id: "language_quality",
    status: "required_before_enablement",
    requirement: "OCR quality must be validated on representative Chinese and mixed Chinese/English enterprise PDFs.",
    validation: "Compare extracted text density, garbled-text warnings, and sample citation readability before and after OCR.",
    releaseGate: false
  },
  {
    id: "citation_traceability",
    status: "required_before_enablement",
    requirement: "OCR output must preserve page-level citation traceability and not weaken citation-first answers.",
    validation: "Run product RAG gates and at least one scanned-PDF fixture with page/citation assertions.",
    releaseGate: true
  },
  {
    id: "supportability_and_privacy",
    status: "required_before_enablement",
    requirement: "Support bundles must diagnose OCR state without exporting raw document images or extracted full text by default.",
    validation: "Verify support bundle privacy tests and runbook coverage for OCR engine/version/status fields.",
    releaseGate: true
  },
  {
    id: "upgrade_and_rollback",
    status: "required_before_enablement",
    requirement: "OCR-generated indexes must have a safe reindex, cleanup, and rollback story across app upgrades.",
    validation: "Document migration/rollback steps and add a regression check for reindexing OCR-derived documents.",
    releaseGate: true
  }
];

export function classifyPdfTextDensityForOcr(textDensityPerPage: number | null): DocumentIngestionQualityOcrConfidence {
  if (textDensityPerPage === null) {
    return "none";
  }
  if (textDensityPerPage < OCR_STRONG_TEXT_DENSITY_THRESHOLD) {
    return "strong";
  }
  if (textDensityPerPage < OCR_POSSIBLE_TEXT_DENSITY_THRESHOLD) {
    return "possible";
  }
  return "none";
}

export function getOcrPolicySnapshot(): OcrPolicySnapshot {
  return {
    schemaVersion: 2,
    mode: "external_preprocess",
    automaticOcrEnabled: false,
    supportedFileTypes: ["pdf"],
    strongTextDensityThreshold: OCR_STRONG_TEXT_DENSITY_THRESHOLD,
    possibleTextDensityThreshold: OCR_POSSIBLE_TEXT_DENSITY_THRESHOLD,
    textDensityUnit: "non_whitespace_characters_per_page",
    remediation: OCR_REMEDIATION,
    privacyNote: OCR_PRIVACY_NOTE,
    bundledOcrAcceptanceCriteria: BUNDLED_OCR_ACCEPTANCE_CRITERIA
  };
}

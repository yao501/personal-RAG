import type { DocumentIngestionQualityOcrConfidence, OcrPolicySnapshot } from "../../shared/types";

export const OCR_STRONG_TEXT_DENSITY_THRESHOLD = 25;
export const OCR_POSSIBLE_TEXT_DENSITY_THRESHOLD = 80;

export const OCR_REMEDIATION =
  "请使用企业认可的本地或内网 OCR 工具生成可复制文本 PDF，再重新导入或重建索引。";

export const OCR_PRIVACY_NOTE =
  "当前桌面端不会自动执行 OCR，也不会把原始 PDF 内容发送到外部 OCR 服务。";

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
    schemaVersion: 1,
    mode: "external_preprocess",
    automaticOcrEnabled: false,
    supportedFileTypes: ["pdf"],
    strongTextDensityThreshold: OCR_STRONG_TEXT_DENSITY_THRESHOLD,
    possibleTextDensityThreshold: OCR_POSSIBLE_TEXT_DENSITY_THRESHOLD,
    textDensityUnit: "non_whitespace_characters_per_page",
    remediation: OCR_REMEDIATION,
    privacyNote: OCR_PRIVACY_NOTE
  };
}

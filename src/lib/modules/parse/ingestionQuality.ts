import type {
  ChunkRecord,
  DocumentIngestionQualityOcrConfidence,
  DocumentIngestionQualityReport,
  DocumentIngestionQualityWarning,
  ParsedDocumentContent
} from "../../shared/types";

function warning(
  code: DocumentIngestionQualityWarning["code"],
  severity: DocumentIngestionQualityWarning["severity"],
  message: string,
  suggestion: string | null
): DocumentIngestionQualityWarning {
  return { code, severity, message, suggestion };
}

function countLines(content: string): number {
  if (!content.trim()) {
    return 0;
  }
  return content.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function countReplacementOrControlCharacters(content: string): number {
  const replacementChars = content.match(/\uFFFD/g)?.length ?? 0;
  const suspiciousControlChars = content.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g)?.length ?? 0;
  return replacementChars + suspiciousControlChars;
}

function classifyOcrNeed(textDensityPerPage: number | null): DocumentIngestionQualityOcrConfidence {
  if (textDensityPerPage === null) {
    return "none";
  }
  if (textDensityPerPage < 25) {
    return "strong";
  }
  if (textDensityPerPage < 80) {
    return "possible";
  }
  return "none";
}

export function buildIngestionQualityReport(
  parsed: ParsedDocumentContent,
  chunks: ChunkRecord[],
  generatedAt = new Date().toISOString()
): DocumentIngestionQualityReport {
  const nonWhitespaceCharacterCount = parsed.content.replace(/\s+/g, "").length;
  const pageCount = parsed.pageSpans?.length ?? null;
  const textDensityPerPage =
    parsed.fileType === "pdf" && pageCount !== null && pageCount > 0
      ? nonWhitespaceCharacterCount / pageCount
      : null;
  const ocrConfidence = classifyOcrNeed(textDensityPerPage);
  const ocrRecommended = ocrConfidence !== "none";
  const tokenCounts = chunks.map((chunk) => chunk.tokenCount);
  const averageChunkTokens =
    tokenCounts.length === 0 ? 0 : tokenCounts.reduce((sum, count) => sum + count, 0) / tokenCounts.length;
  const minChunkTokens = tokenCounts.length === 0 ? 0 : Math.min(...tokenCounts);
  const maxChunkTokens = tokenCounts.length === 0 ? 0 : Math.max(...tokenCounts);
  const warnings: DocumentIngestionQualityWarning[] = [];

  if (nonWhitespaceCharacterCount < 200) {
    warnings.push(
      warning(
        "very_short_content",
        "warning",
        "解析后可索引文本较少，检索和回答可能缺少上下文。",
        "请确认文件不是空白、扫描图像或受保护文档；必要时导入可复制文本版本。"
      )
    );
  }

  if (parsed.fileType === "pdf" && pageCount === null) {
    warnings.push(
      warning(
        "missing_pdf_page_spans",
        "warning",
        "PDF 没有可用页码跨度信息，citation 可能无法稳定跳转到页。",
        "请重新导入该 PDF；若仍出现，建议导出支持包用于排查解析器输出。"
      )
    );
  }

  if (parsed.fileType === "pdf" && textDensityPerPage !== null) {
    if (ocrRecommended) {
      warnings.push(
        warning(
          "low_text_density_pdf",
          ocrConfidence === "strong" ? "error" : "warning",
          ocrConfidence === "strong"
            ? "PDF 每页可提取文本极少，很可能是扫描版或图片型 PDF。"
            : "PDF 每页可提取文本密度偏低，可能是扫描版或图片型 PDF。",
          "当前版本不会自动 OCR；建议先用企业认可的 OCR 工具生成可复制文本 PDF 后再导入。"
        )
      );
    }
  }

  const suspiciousCharCount = countReplacementOrControlCharacters(parsed.content);
  if (suspiciousCharCount > 0 && suspiciousCharCount / Math.max(parsed.content.length, 1) > 0.002) {
    warnings.push(
      warning(
        "possible_garbled_text",
        "warning",
        "解析结果包含较多替换符或控制字符，可能存在乱码。",
        "建议打开文档详情抽查 chunk 文本；如果乱码明显，请重新导出源文件或改用可复制文本版本。"
      )
    );
  }

  if (chunks.length <= 1 && nonWhitespaceCharacterCount > 1200) {
    warnings.push(
      warning(
        "few_chunks_for_large_document",
        "warning",
        "较长文档只生成了很少片段，可能影响召回粒度。",
        "建议检查文档结构是否异常，或调整 chunk 大小后重建索引。"
      )
    );
  }

  if (tokenCounts.length >= 4 && minChunkTokens > 0 && maxChunkTokens / minChunkTokens >= 5) {
    warnings.push(
      warning(
        "large_chunk_size_variance",
        "info",
        "chunk 长度差异较大，部分片段可能过短或过长。",
        "如遇到引用上下文不完整，可在文档详情中抽查对应 chunk 并考虑调整切片参数。"
      )
    );
  }

  return {
    schemaVersion: 2,
    generatedAt,
    fileType: parsed.fileType,
    characterCount: parsed.content.length,
    nonWhitespaceCharacterCount,
    lineCount: countLines(parsed.content),
    pageCount,
    textDensityPerPage,
    ocrRecommended,
    ocrConfidence,
    chunkCount: chunks.length,
    averageChunkTokens,
    minChunkTokens,
    maxChunkTokens,
    warnings
  };
}

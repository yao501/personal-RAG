/**
 * Sprint 5.3c：PDF 抽取文本中的技术词轻量归一，便于检索与规则对齐（非完整 OCR 修复）。
 */
export function normalizePdfTechnicalTokens(text: string): string {
  return (
    text
      // 全角拉丁
      .replace(/ＴＲＵＥ/gi, "TRUE")
      .replace(/ＦＡＬＳＥ/gi, "FALSE")
      // 常见大小写变体
      .replace(/\bTrue\b/g, "TRUE")
      .replace(/\bFalse\b/g, "FALSE")
      // 表格里偶发的空格断字（保守）
      .replace(/\bT\s*R\s*U\s*E\b/gi, "TRUE")
      .replace(/\bF\s*A\s*L\s*S\s*E\b/gi, "FALSE")
  );
}

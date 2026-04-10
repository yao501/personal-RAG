import fs from "node:fs/promises";
import path from "node:path";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import { normalizePdfTechnicalTokens } from "./pdfTextNormalize";
import type { ParsedDocumentContent, SourcePageSpan, SupportedFileType } from "../../shared/types";

export function getSupportedFileType(filePath: string): SupportedFileType | null {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".pdf") return "pdf";
  if (extension === ".md") return "md";
  if (extension === ".txt") return "txt";
  if (extension === ".docx") return "docx";
  return null;
}

async function renderPdfPage(pageData: {
  getTextContent: (options: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }) => Promise<{
    items: Array<{ str: string; transform: number[] }>;
  }>;
}): Promise<string> {
  const textContent = await pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false
  });

  let lastY: number | undefined;
  let text = "";
  for (const item of textContent.items) {
    if (lastY === item.transform[5] || lastY === undefined) {
      text += item.str;
    } else {
      text += `\n${item.str}`;
    }
    lastY = item.transform[5];
  }

  return text;
}

function buildPageSpans(pages: string[]): { content: string; pageSpans: SourcePageSpan[] } {
  let content = "";
  const pageSpans: SourcePageSpan[] = [];

  pages.forEach((pageText, index) => {
    const prefix = content ? "\n\n" : "";
    const startOffset = content.length + prefix.length;
    content += `${prefix}${pageText}`;
    pageSpans.push({
      pageNumber: index + 1,
      startOffset,
      endOffset: content.length
    });
  });

  return { content, pageSpans };
}

async function parsePdf(filePath: string): Promise<{ content: string; pageSpans: SourcePageSpan[] }> {
  const buffer = await fs.readFile(filePath);
  const rawPages: string[] = [];
  await pdfParse(buffer, {
    pagerender: async (pageData: {
      getTextContent: (options: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }) => Promise<{
        items: Array<{ str: string; transform: number[] }>;
      }>;
    }) => {
      const pageText = await renderPdfPage(pageData);
      rawPages.push(pageText);
      return pageText;
    }
  });

  const cleanedPages = rawPages.map((pageText) => cleanPdfText(pageText));
  return buildPageSpans(cleanedPages);
}

function isPdfHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 90) {
    return false;
  }

  const hasHan = /[\p{Script=Han}]/u.test(trimmed);

  if (/^第[一二三四五六七八九十0-9]+[章节篇部分]\s*[:：]?\s*.+$/.test(trimmed)) {
    return true;
  }

  if (
    hasHan &&
    /^\d+(?:\.\d+){0,3}\s+[^\n]{2,80}$/.test(trimmed) &&
    !/[。！？.!?]$/.test(trimmed) &&
    !/\b(?:kb|mb|gb|rpm|hz|mhz|ghz|ms)\b/i.test(trimmed)
  ) {
    return true;
  }

  if (/^[一二三四五六七八九十]+[、.]\s*[^\n]{2,40}$/.test(trimmed) && !/[。！？.!?]$/.test(trimmed)) {
    return true;
  }

  return false;
}

function headingLevel(line: string): number {
  const trimmed = line.trim();
  if (/^第[一二三四五六七八九十0-9]+[章节篇部分]/.test(trimmed)) {
    return 1;
  }

  const numberedMatch = trimmed.match(/^(\d+(?:\.\d+){0,3})\s+/);
  if (numberedMatch) {
    return Math.min(4, numberedMatch[1].split(".").length);
  }

  return 2;
}

function convertPdfHeading(line: string): string {
  return `${"#".repeat(headingLevel(line))} ${line.trim()}`;
}

function isBulletLine(line: string): boolean {
  return /^[■□●○◆◇•▪◦\-]\s+/.test(line.trim());
}

function isTableLikeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  return trimmed.includes(" | ") || /^\|.+\|$/.test(trimmed);
}

function shouldJoinKeyValueContinuation(previous: string | undefined, current: string): boolean {
  if (!previous) {
    return false;
  }

  if (isPdfHeading(previous) || isPdfHeading(current) || isTableLikeLine(previous) || isTableLikeLine(current)) {
    return false;
  }

  if (!/[：:]$/.test(previous.trim())) {
    return false;
  }

  return current.trim().length > 0 && current.trim().length <= 160;
}

function isWrappedContinuation(previous: string | undefined, current: string): boolean {
  if (!previous) {
    return false;
  }

  if (
    /^#+\s/.test(previous) ||
    isPdfHeading(previous) ||
    isPdfHeading(current) ||
    isBulletLine(current) ||
    isTableLikeLine(previous) ||
    isTableLikeLine(current)
  ) {
    return false;
  }

  if (/^\d+[.)、]\s+/.test(current) || /^[a-z]\)/i.test(current)) {
    return false;
  }

  const previousLooksComplete = /[。！？.!?：:]$/.test(previous);
  const currentLooksLikeSentence = /[a-zA-Z\u4e00-\u9fa5]/.test(current);
  return !previousLooksComplete && currentLooksLikeSentence && previous.length < 160;
}

export function cleanPdfText(text: string): string {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ");

  const lines = normalized
    .split("\n")
    .flatMap((line) =>
      line
        .replace(/\s*([■□●○◆◇•▪◦])\s*/g, "\n$1 ")
        .replace(/(?<!\n)((?:第[一二三四五六七八九十0-9]+[章节篇部分]|(?:\d+(?:\.\d+){1,3}))\s+(?:Q[:：]|[^\n]{2,80}))/g, "\n$1")
        .split("\n")
    )
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) {
        return false;
      }

      if (/^\d+$/.test(line)) {
        return false;
      }

      if (/^[.`·•\-_=]{4,}$/.test(line)) {
        return false;
      }

      if (/^第?\d+\s*页$/.test(line)) {
        return false;
      }

      if (/^\d+(?:\.\d+)*\s+.+\.{3,}\s*\d+$/.test(line)) {
        return false;
      }

      return true;
    });

  const merged: string[] = [];
  for (const line of lines) {
    const previous = merged.at(-1);
    const startsStructuredBlock = isBulletLine(line) || isPdfHeading(line) || /^\d+[.)、]\s+/.test(line);

    if (isPdfHeading(line)) {
      merged.push(convertPdfHeading(line));
      continue;
    }

    if (shouldJoinKeyValueContinuation(previous, line)) {
      merged[merged.length - 1] = `${previous} ${line}`.trim();
      continue;
    }

    if (previous && !startsStructuredBlock && isWrappedContinuation(previous, line)) {
      merged[merged.length - 1] = `${previous} ${line}`.trim();
      continue;
    }

    merged.push(line);
  }

  return normalizePdfTechnicalTokens(merged.join("\n\n"));
}

async function parseDocx(filePath: string): Promise<string> {
  const result = await mammoth.extractRawText({ path: filePath });
  return cleanStructuredText(result.value);
}

export function cleanStructuredText(text: string): string {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\t+/g, " | ")
    .replace(/[ \t]+/g, " ")
    .replace(/```+/g, "\n")
    .replace(/^\s*[-*_]{3,}\s*$/gm, "\n");

  const lines = normalized
    .split("\n")
    .flatMap((line) =>
      line
        .replace(/\s*([■□●○◆◇•▪◦])\s*/g, "\n$1 ")
        .replace(/\s+\*\s+(?=[^\s*])/g, "\n* ")
        .replace(/(?<!\n)(\d+[)）.、]\s*[^\n]{1,120})/g, "\n$1")
        .replace(/(?<!\n)([一二三四五六七八九十]+[)）.、]\s*[^\n]{1,120})/g, "\n$1")
        .replace(/(?<!\n)(第[一二三四五六七八九十0-9]+[章节篇部分]\s*[:：]?\s*[^\n]{1,80})/g, "\n$1")
        .replace(/(?<!\n)(\d+(?:\.\d+){0,3}\s+[^\n]{2,80})/g, "\n$1")
        .replace(/(?<!\n)([一二三四五六七八九十]+[、.]\s*[^\n]{2,60})/g, "\n$1")
        .split("\n")
    )
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && !/^[-*_]{3,}$/.test(line) && line !== "```");

  const merged: string[] = [];
  for (const line of lines) {
    if (isPdfHeading(line)) {
      merged.push(convertPdfHeading(line));
      continue;
    }

    const previous = merged.at(-1);
    if (shouldJoinKeyValueContinuation(previous, line)) {
      merged[merged.length - 1] = `${previous} ${line}`.trim();
      continue;
    }

    if (previous && isWrappedContinuation(previous, line)) {
      merged[merged.length - 1] = `${previous} ${line}`.trim();
      continue;
    }

    merged.push(line);
  }

  return merged.join("\n\n");
}

export async function parseDocument(filePath: string): Promise<ParsedDocumentContent> {
  const fileType = getSupportedFileType(filePath);
  if (!fileType) {
    throw new Error(`Unsupported file type for ${filePath}`);
  }

  if (fileType === "txt" || fileType === "md") {
    const content = await fs.readFile(filePath, "utf8");
    return { fileType, content: fileType === "txt" ? cleanStructuredText(content) : content };
  }

  if (fileType === "pdf") {
    const parsed = await parsePdf(filePath);
    return { fileType, content: parsed.content, pageSpans: parsed.pageSpans };
  }

  return { fileType, content: await parseDocx(filePath) };
}

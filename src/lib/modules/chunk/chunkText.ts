import type { ChunkRecord, SourcePageSpan } from "../../shared/types";
import { createStableId } from "../core/id";
import { formatLocatorLabel } from "../citation/locator";

export interface ChunkOptions {
  chunkSize: number;
  chunkOverlap: number;
  documentTitle?: string;
  pageSpans?: SourcePageSpan[];
}

interface SectionUnit {
  text: string;
  startOffset: number;
  endOffset: number;
  sectionTitle: string | null;
  sectionPath: string[];
  tokenCount: number;
  kind: "paragraph" | "list_item";
  paragraphIndex: number;
  pageStart: number | null;
  pageEnd: number | null;
}

const MARKDOWN_HEADING = /^(#{1,6})\s+(.+?)\s*$/;

/**
 * P0-B B4 (single-rule, single-fragment):
 * PDF 抽取文本在「术语/参数表」附近常出现空行密集，导致术语名行与解释行被分到不同 block（`\\n{2,}`）并进而切碎。
 *
 * 该规则只在 PDF 路径启用（`pageSpans` 存在时），且只针对 Q8 同族的白名单 cue：
 * - `参数对齐`
 * - `该属性设为` + `TRUE/FALSE`
 *
 * 动作：在 cue 附近的有限窗口内，把“表格/短行”之间的空行折叠为单换行，减少硬切分。
 * 非目标：不重写 parse 栈；不做通用表格识别；不影响 markdown/纯文本导入。
 */
function coalescePdfTermTableWhitespaceForB4(text: string): string {
  if (!/参数对齐/.test(text) && !(/该属性设为/.test(text) && /TRUE/i.test(text) && /FALSE/i.test(text))) {
    return text;
  }

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  const windowSize = 28;
  let windowRemaining = 0;
  let recentCueLine = false;

  const isShortTableLikeLine = (line: string): boolean => {
    const t = line.trim();
    if (!t) {
      return false;
    }
    if (t.length > 22) {
      return false;
    }
    // short, column-like signals
    return /^(?:[0-9.]+|TRUE|FALSE|是|否|0|1)\b/i.test(t) || /(?:TRUE|FALSE|是|否|点名|赋值)/i.test(t);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (/参数对齐/.test(trimmed) || (/该属性设为/.test(trimmed) && /TRUE/i.test(trimmed) && /FALSE/i.test(trimmed))) {
      windowRemaining = windowSize;
      recentCueLine = true;
    } else if (trimmed) {
      recentCueLine = false;
    }

    if (!trimmed) {
      const prev = out.at(-1) ?? "";
      const next = lines[i + 1] ?? "";
      const shouldFold =
        windowRemaining > 0 &&
        ((recentCueLine && next.trim().length > 0) || (isShortTableLikeLine(prev) && isShortTableLikeLine(next)));
      if (shouldFold) {
        // fold blank line inside table-like short lines to avoid `\n{2,}` block split.
        continue;
      } else {
        out.push(line);
      }
    } else {
      out.push(line);
    }

    if (windowRemaining > 0) {
      windowRemaining -= 1;
    }
  }

  // Collapse 2+ blank lines to a single blank line within the processed text.
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

function endsWithContinuationMarker(text: string): boolean {
  const trimmed = text.trim();
  return /[：:([（"“]$/.test(trimmed);
}

function countTokens(text: string): number {
  const normalized = text.trim();
  if (!normalized) {
    return 0;
  }

  const latinTokens = normalized.match(/[a-z0-9]+(?:['-][a-z0-9]+)*/giu) ?? [];
  const hanChars = normalized.match(/[\p{Script=Han}]/gu) ?? [];
  return latinTokens.length + hanChars.length;
}

function isPlainHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 80) {
    return false;
  }

  if (/^#{1,6}\s/.test(trimmed) || /^(?:[>*\-•]|\d+[.)、]|[一二三四五六七八九十]+[、.])\s*/u.test(trimmed)) {
    return false;
  }

  if (/[.!?。！？]$/.test(trimmed)) {
    return false;
  }

  const words = trimmed.split(/\s+/);
  return words.length > 0 && words.length <= 8 && /^[\p{L}\p{N}\s:\-/()]+$/u.test(trimmed);
}

function splitSentences(text: string): string[] {
  const matches = text.match(/[^。！？.!?\n]+[。！？.!?]?/gu);
  if (!matches) {
    return [text.trim()].filter(Boolean);
  }

  return matches
    .map((part) => part.trim())
    .filter(Boolean);
}

function isStructuredListItem(text: string): boolean {
  const trimmed = text.trim();
  return /^(?:[■□●○◆◇•▪◦\-]|\d+[.)、]|[一二三四五六七八九十]+[、.])\s*/u.test(trimmed);
}

function resolvePageNumber(offset: number, pageSpans?: SourcePageSpan[]): number | null {
  if (!pageSpans || pageSpans.length === 0) {
    return null;
  }

  const matched = pageSpans.find((page) => offset >= page.startOffset && offset < page.endOffset);
  if (matched) {
    return matched.pageNumber;
  }

  if (offset >= (pageSpans.at(-1)?.endOffset ?? 0)) {
    return pageSpans.at(-1)?.pageNumber ?? null;
  }

  return pageSpans[0]?.pageNumber ?? null;
}

function splitOversizedUnit(unit: SectionUnit, maxTokens: number, pageSpans?: SourcePageSpan[]): SectionUnit[] {
  if (unit.tokenCount <= maxTokens) {
    return [unit];
  }

  const sentences = splitSentences(unit.text);
  if (sentences.length <= 1) {
    return [unit];
  }

  const result: SectionUnit[] = [];
  let buffer = "";
  let bufferStart = unit.startOffset;
  let searchCursor = unit.startOffset;

  for (const sentence of sentences) {
    const nextText = buffer ? `${buffer} ${sentence}` : sentence;
    if (countTokens(nextText) > maxTokens && buffer) {
      result.push({
        ...unit,
        text: buffer,
        startOffset: bufferStart,
        endOffset: bufferStart + buffer.length,
        tokenCount: countTokens(buffer),
        pageStart: resolvePageNumber(bufferStart, pageSpans),
        pageEnd: resolvePageNumber(bufferStart + buffer.length, pageSpans)
      });

      buffer = sentence;
      const sentenceIndex = unit.text.indexOf(sentence, Math.max(0, searchCursor - unit.startOffset));
      bufferStart = sentenceIndex >= 0 ? unit.startOffset + sentenceIndex : searchCursor;
      searchCursor = bufferStart + sentence.length;
    } else {
      if (!buffer) {
        const sentenceIndex = unit.text.indexOf(sentence, Math.max(0, searchCursor - unit.startOffset));
        bufferStart = sentenceIndex >= 0 ? unit.startOffset + sentenceIndex : searchCursor;
      }
      buffer = nextText;
      searchCursor = bufferStart + buffer.length;
    }
  }

  if (buffer) {
    result.push({
      ...unit,
      text: buffer,
      startOffset: bufferStart,
      endOffset: bufferStart + buffer.length,
      tokenCount: countTokens(buffer),
      pageStart: resolvePageNumber(bufferStart, pageSpans),
      pageEnd: resolvePageNumber(bufferStart + buffer.length, pageSpans)
    });
  }

  return result;
}

function buildUnits(text: string, pageSpans?: SourcePageSpan[]): SectionUnit[] {
  const normalized = (pageSpans ? coalescePdfTermTableWhitespaceForB4(text) : text).replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const blocks = normalized.split(/\n{2,}/);
  const units: SectionUnit[] = [];
  let sectionPath: string[] = [];
  let searchOffset = 0;

  for (const rawBlock of blocks) {
    const block = rawBlock.trim();
    if (!block) {
      continue;
    }

    const headingMatch = block.match(MARKDOWN_HEADING);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const heading = headingMatch[2].trim();
      sectionPath = [...sectionPath.slice(0, Math.max(0, level - 1)), heading];
      searchOffset = normalized.indexOf(block, searchOffset) + block.length;
      continue;
    }

    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const firstLineHeadingMatch = lines[0]?.match(MARKDOWN_HEADING);
    if (firstLineHeadingMatch) {
      const level = firstLineHeadingMatch[1].length;
      const heading = firstLineHeadingMatch[2].trim();
      sectionPath = [...sectionPath.slice(0, Math.max(0, level - 1)), heading];
      const body = lines.slice(1).join(" ").trim();
      const blockIndex = normalized.indexOf(block, searchOffset);

      if (!body) {
        searchOffset = Math.max(searchOffset, blockIndex + block.length);
        continue;
      }

      const bodyIndex = normalized.indexOf(body, Math.max(searchOffset, blockIndex));
      units.push({
        text: body,
        startOffset: bodyIndex >= 0 ? bodyIndex : Math.max(0, blockIndex),
        endOffset: (bodyIndex >= 0 ? bodyIndex : Math.max(0, blockIndex)) + body.length,
        sectionTitle: heading,
        sectionPath: [...sectionPath],
        tokenCount: countTokens(body),
        kind: isStructuredListItem(body) ? "list_item" : "paragraph",
        paragraphIndex: 0,
        pageStart: null,
        pageEnd: null
      });
      searchOffset = Math.max(searchOffset, blockIndex + block.length);
      continue;
    }

    if (lines.length > 1 && isPlainHeading(lines[0])) {
      const heading = lines[0];
      sectionPath = [heading];
      const body = lines.slice(1).join(" ").trim();
      if (!body) {
        searchOffset = normalized.indexOf(block, searchOffset) + block.length;
        continue;
      }

      const blockIndex = normalized.indexOf(block, searchOffset);
      const bodyIndex = normalized.indexOf(body, Math.max(searchOffset, blockIndex));
      units.push({
        text: body,
        startOffset: bodyIndex >= 0 ? bodyIndex : Math.max(0, blockIndex),
        endOffset: (bodyIndex >= 0 ? bodyIndex : Math.max(0, blockIndex)) + body.length,
        sectionTitle: heading,
        sectionPath: [...sectionPath],
        tokenCount: countTokens(body),
        kind: isStructuredListItem(body) ? "list_item" : "paragraph",
        paragraphIndex: 0,
        pageStart: null,
        pageEnd: null
      });
      searchOffset = Math.max(searchOffset, blockIndex + block.length);
      continue;
    }

    const blockIndex = normalized.indexOf(block, searchOffset);
    units.push({
      text: lines.join(" "),
      startOffset: blockIndex >= 0 ? blockIndex : searchOffset,
      endOffset: (blockIndex >= 0 ? blockIndex : searchOffset) + lines.join(" ").length,
      sectionTitle: sectionPath.at(-1) ?? null,
      sectionPath: [...sectionPath],
      tokenCount: countTokens(lines.join(" ")),
      kind: isStructuredListItem(lines.join(" ")) ? "list_item" : "paragraph",
      paragraphIndex: 0,
      pageStart: null,
      pageEnd: null
    });
    searchOffset = Math.max(searchOffset, (blockIndex >= 0 ? blockIndex : searchOffset) + block.length);
  }

  return units.map((unit, index) => ({
    ...unit,
    paragraphIndex: index + 1,
    pageStart: resolvePageNumber(unit.startOffset, pageSpans),
    pageEnd: resolvePageNumber(unit.endOffset, pageSpans)
  }));
}

export function chunkText(documentId: string, text: string, options: ChunkOptions): ChunkRecord[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const rawUnits = buildUnits(normalized, options.pageSpans);
  const units = rawUnits.flatMap((unit) => splitOversizedUnit(unit, Math.max(40, options.chunkSize), options.pageSpans));
  const chunks: ChunkRecord[] = [];
  let chunkIndex = 0;
  let cursor = 0;

  while (cursor < units.length) {
    let tokenTotal = 0;
    let endCursor = cursor;

    while (endCursor < units.length) {
      const candidate = units[endCursor];
      if (!candidate) {
        break;
      }

      const nextTotal = tokenTotal + candidate.tokenCount;
      const currentChunkText = units.slice(cursor, endCursor).map((unit) => unit.text).join("\n\n");
      const previousCandidate = endCursor > cursor ? units[endCursor - 1] : null;
      const hasLeadInContinuation = endsWithContinuationMarker(currentChunkText);
      const crossesSectionBoundary =
        tokenTotal > 0 &&
        previousCandidate?.sectionPath.join(" > ") !== candidate.sectionPath.join(" > ") &&
        tokenTotal >= Math.round(options.chunkSize * 0.3);
      const continuationUpperBound = hasLeadInContinuation
        ? Math.round(options.chunkSize * 2.8)
        : Math.round(options.chunkSize * 1.35);
      const shouldKeepIndependentListItemsSeparate =
        tokenTotal > 0 &&
        previousCandidate?.kind === "list_item" &&
        candidate.kind === "list_item" &&
        tokenTotal >= Math.round(options.chunkSize * 0.28);
      const shouldForceContinuation =
        tokenTotal > 0 &&
        nextTotal <= continuationUpperBound &&
        !shouldKeepIndependentListItemsSeparate &&
        (
          hasLeadInContinuation ||
          (tokenTotal < Math.round(options.chunkSize * 0.55) && candidate.tokenCount < Math.round(options.chunkSize * 0.7))
        );

      if (crossesSectionBoundary || shouldKeepIndependentListItemsSeparate || (tokenTotal > 0 && nextTotal > options.chunkSize && !shouldForceContinuation)) {
        break;
      }

      tokenTotal = nextTotal;
      endCursor += 1;
    }

    if (endCursor === cursor) {
      endCursor += 1;
      tokenTotal = units[cursor]?.tokenCount ?? 0;
    }

    const chunkUnits = units.slice(cursor, endCursor);
    const textValue = chunkUnits.map((unit) => unit.text).join("\n\n");
    const firstUnit = chunkUnits[0];
    const lastUnit = chunkUnits.at(-1);
    const sectionTitle = [...chunkUnits.map((unit) => unit.sectionTitle).filter(Boolean)][0] ?? null;
    const sectionPath = chunkUnits
      .flatMap((unit) => unit.sectionPath)
      .filter((value, index, array) => value && array.indexOf(value) === index)
      .join(" > ") || null;
    const pageStart = chunkUnits.find((unit) => unit.pageStart !== null)?.pageStart ?? null;
    const pageEnd = [...chunkUnits].reverse().find((unit) => unit.pageEnd !== null)?.pageEnd ?? pageStart;
    const paragraphStart = firstUnit?.paragraphIndex ?? null;
    const paragraphEnd = lastUnit?.paragraphIndex ?? paragraphStart;

    chunks.push({
      id: createStableId(`${documentId}:${chunkIndex}:${textValue}`),
      documentId,
      text: textValue,
      chunkIndex,
      startOffset: firstUnit?.startOffset ?? 0,
      endOffset: lastUnit?.endOffset ?? firstUnit?.endOffset ?? 0,
      tokenCount: tokenTotal,
      sectionTitle,
      sectionPath,
      headingTrail: sectionPath,
      pageStart,
      pageEnd,
      paragraphStart,
      paragraphEnd,
      locatorLabel: formatLocatorLabel({ pageStart, pageEnd, paragraphStart, paragraphEnd })
    });

    if (endCursor >= units.length) {
      break;
    }

    let overlapTokens = 0;
    let nextCursor = endCursor;
    while (nextCursor > cursor && overlapTokens < options.chunkOverlap) {
      nextCursor -= 1;
      overlapTokens += units[nextCursor]?.tokenCount ?? 0;
    }

    cursor = Math.max(cursor + 1, nextCursor);
    chunkIndex += 1;
  }

  return chunks;
}

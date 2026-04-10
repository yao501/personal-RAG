export function formatLocatorLabel(input: {
  pageStart: number | null;
  pageEnd: number | null;
  paragraphStart: number | null;
  paragraphEnd: number | null;
}): string | null {
  const { pageStart, pageEnd, paragraphStart, paragraphEnd } = input;
  const parts: string[] = [];

  if (pageStart) {
    parts.push(pageStart === pageEnd || !pageEnd ? `p.${pageStart}` : `p.${pageStart}-${pageEnd}`);
  }

  if (paragraphStart) {
    parts.push(
      paragraphStart === paragraphEnd || !paragraphEnd
        ? `para ${paragraphStart}`
        : `para ${paragraphStart}-${paragraphEnd}`
    );
  }

  return parts.length > 0 ? parts.join(" | ") : null;
}

export function formatReferenceTag(input: {
  fileName: string;
  locatorLabel?: string | null;
  chunkIndex: number;
}): string {
  const locator = input.locatorLabel ?? `chunk ${input.chunkIndex + 1}`;
  return `[${input.fileName} | ${locator}]`;
}

export function formatEvidenceAnchorLabel(input: {
  locatorLabel?: string | null;
  sentenceIndex?: number | null;
}): string | null {
  const parts: string[] = [];

  if (input.locatorLabel) {
    parts.push(input.locatorLabel);
  }

  if (input.sentenceIndex) {
    parts.push(`sent ${input.sentenceIndex}`);
  }

  return parts.length > 0 ? parts.join(" | ") : null;
}

/**
 * Truncate for UI/eval display while keeping identifiers (paths, script names, BOOLs) intact when possible.
 */
const ID_PATTERNS: RegExp[] = [
  /\b(?:TRUE|FALSE)\b/gi,
  /\bHISCP\b/gi,
  /\bEW\b/g,
  /`[^`]{1,120}`/g,
  /\\(?:HOLLiAS_MACS|[^\s\\]+)\\Common/gi,
  /\bUser(?:Reg|UnReg)\.bat\b/gi,
  /\b[A-Z][a-zA-Z0-9]{1,24}\.(?:bat|exe|cmd)\b/g
];

export function truncateSnippetPreservingIdentifiers(text: string, maxLen: number): string {
  const t = text.trim();
  if (t.length <= maxLen) {
    return t;
  }

  const windows: Array<{ start: number; end: number }> = [];
  for (const re of ID_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    while ((m = r.exec(t)) !== null) {
      windows.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  windows.sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (!last || w.start > last.end + 1) {
      merged.push({ ...w });
    } else {
      last.end = Math.max(last.end, w.end);
    }
  }

  let cut = maxLen;
  const pad = 8;
  for (const w of merged) {
    if (w.end <= maxLen) {
      continue;
    }
    if (w.start < maxLen && w.end > maxLen) {
      cut = Math.min(t.length, w.end + pad);
      break;
    }
  }

  if (cut < t.length) {
    return `${t.slice(0, cut).trimEnd()}…`;
  }
  return t;
}

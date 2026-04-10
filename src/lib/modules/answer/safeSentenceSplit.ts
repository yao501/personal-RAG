/**
 * Avoid splitting mid-token on dots that belong to Windows scripts/paths (e.g. UserReg.bat).
 */
const TECH_DOT_PATTERN = /(\b[a-zA-Z0-9_\-]{1,32})\.(bat|exe|cmd|dll|ini|msi|sys)\b/g;

export function maskTechnicalDots(text: string): { masked: string; restore: (s: string) => string } {
  const pairs: Array<{ ph: string; orig: string }> = [];
  let i = 0;
  const masked = text.replace(TECH_DOT_PATTERN, (_m, base: string, ext: string) => {
    const orig = `${base}.${ext}`;
    const ph = `\uE000${i}\uE001`;
    pairs.push({ ph, orig });
    i += 1;
    return ph;
  });
  return {
    masked,
    restore: (s: string) => {
      let out = s;
      for (const { ph, orig } of pairs) {
        out = out.split(ph).join(orig);
      }
      return out;
    }
  };
}

/** Split on sentence boundaries without breaking `.bat` / `.exe` etc. */
export function splitSentenceLikePreservingTechnicalDots(text: string): string[] {
  const { masked, restore } = maskTechnicalDots(text);
  const matches = masked.match(/[^。！？.!?\n]+[。！？.!?\n]?/gu);
  if (!matches) {
    return [restore(text.trim())].filter(Boolean);
  }
  return matches.map((part) => restore(part.trim())).filter(Boolean);
}

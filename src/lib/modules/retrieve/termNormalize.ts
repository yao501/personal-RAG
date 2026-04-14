/**
 * P0-B B5: small, whitelist-driven normalization for **lexical retrieval only**.
 *
 * Goals:
 * - Improve match stability for definition/parameter/TRUE-FALSE/table-item style queries.
 * - Keep the whitelist short and reviewable.
 * - **Do not** mutate stored chunk text or citations/snippets; this should only be used
 *   when computing lexical tokens / phrase overlaps.
 *
 * Strategy:
 * - Canonicalize a tiny set of high-value technical tokens (e.g. TRUE/FALSE case and fullwidth variants).
 * - Add a small set of *expansion tokens* when we see stable cues (e.g. `参数对齐`).
 * - Avoid aggressive Chinese synonym collapsing that could flip meaning.
 */

type ExpansionRule = Readonly<{ when: RegExp; add: string }>;

const CANONICAL_REPLACEMENTS: ReadonlyArray<Readonly<{ from: RegExp; to: string }>> = [
  // Fullwidth latin
  { from: /ＴＲＵＥ/giu, to: "TRUE" },
  { from: /ＦＡＬＳＥ/giu, to: "FALSE" },
  // Common case variants
  { from: /\btrue\b/giu, to: "TRUE" },
  { from: /\bfalse\b/giu, to: "FALSE" },
  // Table / OCR spaced variants (conservative)
  { from: /\bT\s*R\s*U\s*E\b/giu, to: "TRUE" },
  { from: /\bF\s*A\s*L\s*S\s*E\b/giu, to: "FALSE" }
];

/**
 * Expansion tokens are appended (newline separated) so we keep original text intact.
 * Keep rules conservative to avoid broad false positives.
 */
const EXPANSION_RULES: ReadonlyArray<ExpansionRule> = [
  // Boolean-ish cues: do not touch "是/否" (too broad); only map explicit enable/disable verbs.
  { when: /启用|开启|打开/gu, add: "TRUE" },
  { when: /禁用|关闭/gu, add: "FALSE" },

  // Parameter alignment concept: stable keyword in known manuals.
  // Add associated terms so queries using those terms can still match even if the paragraph omits them verbatim.
  { when: /参数对齐/gu, add: "在线值 离线值 值比较 同步 同步提示" },

  // Function block structural tokens (small step): map common aliases.
  { when: /\bparam\b/giu, add: "PARAM 参数" },
  { when: /\bin\b/giu, add: "IN 输入" },
  { when: /\bout\b/giu, add: "OUT 输出" },
  { when: /引脚/gu, add: "IN OUT 输入 输出" }
];

function applyCanonicalReplacements(input: string): string {
  let out = input;
  for (const row of CANONICAL_REPLACEMENTS) {
    out = out.replace(row.from, row.to);
  }
  return out;
}

function collectExpansionTokens(input: string): string[] {
  const additions: string[] = [];
  for (const rule of EXPANSION_RULES) {
    if (rule.when.test(input)) {
      additions.push(rule.add);
    }
  }
  // de-dupe by token sequence (keep short; no heavy NLP)
  return [...new Set(additions.flatMap((s) => s.split(/\s+/).filter(Boolean)))];
}

/**
 * Normalize text for lexical matching. Safe to call on both queries and haystacks.
 */
export function normalizeForLexicalMatch(text: string): string {
  const base = applyCanonicalReplacements(text);
  const expansions = collectExpansionTokens(base);
  if (expansions.length === 0) {
    return base;
  }
  // Keep expansion tokens separated, so phrase matching on original text is not distorted.
  return `${base}\n${expansions.join(" ")}`;
}


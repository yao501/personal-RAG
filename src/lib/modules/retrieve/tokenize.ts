const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "he",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "that",
  "the",
  "to",
  "was",
  "were",
  "will",
  "with",
  "什么",
  "如何",
  "怎么",
  "怎样",
  "为何",
  "为什么",
  "为啥",
  "关于",
  "一下",
  "一下子",
  "一下呢",
  "请问",
  "一下吧",
  "吗",
  "呢",
  "啊",
  "呀",
  "吧",
  "是",
  "的",
  "了",
  "和",
  "与",
  "及",
  "我",
  "你",
  "他",
  "她",
  "它"
]);

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function normalizeInput(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scriptSegments(input: string): string[] {
  return input.match(/[\p{Script=Han}]+|[a-z0-9]+/gu) ?? [];
}

function compactNgrams(input: string): string[] {
  const compact = input.replace(/\s+/g, "");
  const tokens: string[] = [];

  if (compact.length < 2) {
    return tokens;
  }

  for (let index = 0; index < compact.length - 1; index += 1) {
    const gram = compact.slice(index, index + 2);
    const hasHan = /[\p{Script=Han}]/u.test(gram);
    const hasLatinOrNumber = /[a-z0-9]/i.test(gram);

    if (hasHan && hasLatinOrNumber) {
      if (/^[a-z0-9][\p{Script=Han}]$|^[\p{Script=Han}][a-z0-9]$/u.test(gram)) {
        tokens.push(gram);
      }
      continue;
    }

    if (/^[\p{Script=Han}]{2}$/u.test(gram)) {
      tokens.push(gram);
    }
  }

  for (let index = 0; index < compact.length - 2; index += 1) {
    const gram = compact.slice(index, index + 3);
    if (/^[\p{Script=Han}]{3}$/u.test(gram)) {
      tokens.push(gram);
    }
  }

  return tokens;
}

function chineseCharacterTokens(input: string): string[] {
  const matches = scriptSegments(input).filter((segment) => /[\p{Script=Han}]/u.test(segment));
  const tokens: string[] = [];

  for (const match of matches) {
    if (match.length <= 2) {
      tokens.push(match);
      continue;
    }

    for (let index = 0; index < match.length - 1; index += 1) {
      tokens.push(match.slice(index, index + 2));
    }

    for (let index = 0; index < match.length - 2; index += 1) {
      tokens.push(match.slice(index, index + 3));
    }
  }

  return tokens;
}

function latinAndNumberTokens(input: string): string[] {
  return scriptSegments(input)
    .filter((token) => token && !STOP_WORDS.has(token));
}

export function tokenize(input: string): string[] {
  const normalized = normalizeInput(input);
  if (!normalized) {
    return [];
  }

  const tokens = [
    ...latinAndNumberTokens(normalized),
    ...chineseCharacterTokens(normalized),
    ...compactNgrams(normalized)
  ].filter((token) => token && !STOP_WORDS.has(token));

  return unique(tokens);
}

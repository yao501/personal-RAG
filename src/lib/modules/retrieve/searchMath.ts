export function termFrequency(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

export function charNgrams(input: string, n = 3): Map<string, number> {
  const normalized = input.toLowerCase().replace(/\s+/g, " ").trim();
  const grams = new Map<string, number>();

  if (!normalized) {
    return grams;
  }

  if (normalized.length <= n) {
    grams.set(normalized, 1);
    return grams;
  }

  for (let index = 0; index <= normalized.length - n; index += 1) {
    const gram = normalized.slice(index, index + n);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }

  return grams;
}

export function cosineSimilarity(left: Map<string, number>, right: Map<string, number>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (const value of left.values()) {
    leftNorm += value * value;
  }

  for (const value of right.values()) {
    rightNorm += value * value;
  }

  for (const [gram, value] of left.entries()) {
    dot += value * (right.get(gram) ?? 0);
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / Math.sqrt(leftNorm * rightNorm);
}

export function jaccardSimilarity(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);

  if (leftSet.size === 0 || rightSet.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      overlap += 1;
    }
  }

  return overlap / (leftSet.size + rightSet.size - overlap);
}

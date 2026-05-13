const OLLAMA_BASE = "http://localhost:11434";
const MODEL_ID = "bge-m3";

let startupError: Error | null = null;
let available = false;

async function checkOllama(): Promise<void> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (!res.ok) throw new Error(`Ollama 不可达: ${res.status}`);
    available = true;
  } catch (e) {
    available = false;
    startupError = e instanceof Error ? e : new Error("Ollama 连接失败");
  }
}

export async function getEmbeddingStatus(): Promise<{ available: boolean; reason: string | null }> {
  // 懒加载检查
  if (!available && !startupError) {
    await checkOllama();
  }
  if (startupError) {
    return { available: false, reason: startupError.message };
  }
  return { available: true, reason: null };
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  // 确保 Ollama 可用
  if (!available) await checkOllama();
  if (!available) throw new Error("Ollama 不可用，请确认 ollama 已启动且 bge-m3 已安装");

  // 分批处理，避免单次请求过大
  const BATCH_SIZE = 32;
  const allVectors: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await fetch(`${OLLAMA_BASE}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL_ID, input: batch }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Ollama embed 失败: ${res.status} ${errBody}`);
    }

    const data = await res.json() as { embeddings: number[][] };
    allVectors.push(...data.embeddings);
  }

  return allVectors;
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

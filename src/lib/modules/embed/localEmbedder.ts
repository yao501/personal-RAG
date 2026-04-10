import fs from "node:fs/promises";
import path from "node:path";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const MODEL_SEGMENTS = MODEL_ID.split("/");
const DEV_MODEL_ROOT = path.join(process.cwd(), "node_modules", "@huggingface", "transformers", ".cache");

type FeatureExtractionPipeline = (input: string | string[], options?: Record<string, unknown>) => Promise<{
  data: Float32Array | number[];
  dims?: number[];
}>;

type TransformersModule = {
  env: {
    allowLocalModels: boolean;
    allowRemoteModels: boolean;
    useFSCache: boolean;
    cacheDir: string;
    localModelPath: string;
  };
  pipeline(task: "feature-extraction", model: string): Promise<FeatureExtractionPipeline>;
};

let embedderPromise: Promise<FeatureExtractionPipeline> | null = null;
let startupError: Error | null = null;

async function getFsModelRoot(): Promise<string> {
  try {
    const { app } = await import("electron");
    const userDataPath = app?.getPath("userData");
    if (userDataPath) {
      return path.join(userDataPath, "models", "transformers");
    }
  } catch {
    // Fall through to a cwd-based cache path for non-Electron contexts.
  }

  return path.join(process.cwd(), ".cache", "transformers");
}

function getBundledModelRoot(): string | null {
  if (!process.resourcesPath) {
    return null;
  }

  return path.join(process.resourcesPath, "transformers-models");
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function findPreferredLocalModelRoot(userModelRoot: string): Promise<string | null> {
  const candidateRoots = [getBundledModelRoot(), userModelRoot, DEV_MODEL_ROOT].filter((value): value is string => Boolean(value));

  for (const root of candidateRoots) {
    if (await pathExists(path.join(root, ...MODEL_SEGMENTS, "onnx", "model.onnx"))) {
      return root;
    }
  }

  return null;
}

async function configureTransformersRuntime(transformers: TransformersModule): Promise<void> {
  const userModelRoot = await getFsModelRoot();
  await fs.mkdir(userModelRoot, { recursive: true });
  const localModelRoot = await findPreferredLocalModelRoot(userModelRoot);
  const hasLocalModel = Boolean(localModelRoot);

  transformers.env.useFSCache = true;
  transformers.env.cacheDir = userModelRoot;
  transformers.env.localModelPath = localModelRoot ?? userModelRoot;
  transformers.env.allowLocalModels = true;
  transformers.env.allowRemoteModels = !hasLocalModel;
}

function toVector(data: Float32Array | number[]): number[] {
  return Array.from(data);
}

export async function getEmbeddingStatus(): Promise<{ available: boolean; reason: string | null }> {
  if (startupError) {
    return { available: false, reason: startupError.message };
  }

  try {
    await getEmbedder();
    return { available: true, reason: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown embedding startup error";
    return { available: false, reason: message };
  }
}

async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      try {
        const transformers = await import("@huggingface/transformers") as unknown as TransformersModule;
        await configureTransformersRuntime(transformers);
        return await transformers.pipeline("feature-extraction", MODEL_ID);
      } catch (error) {
        startupError = error instanceof Error ? error : new Error("Failed to load embedding model");
        throw startupError;
      }
    })();
  }

  return embedderPromise;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const embedder = await getEmbedder();
  const vectors: number[][] = [];

  for (const text of texts) {
    const output = await embedder(text, {
      pooling: "mean",
      normalize: true
    });

    vectors.push(toVector(output.data));
  }

  return vectors;
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

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / Math.sqrt(leftNorm * rightNorm);
}

import type {
  ChunkRecord,
  DocumentRecord,
  LibraryHealthIssue,
  LibraryHealthIssueKind,
  LibraryHealthReport
} from "../shared/types";

interface SourceStatus {
  exists: boolean;
  sourceUpdatedAt: string | null;
}

function makeIssue(input: {
  document: DocumentRecord;
  severity: "warning" | "error";
  kind: LibraryHealthIssueKind;
  detail: string;
  recommendedAction: "remove_document" | "reindex_document";
}): LibraryHealthIssue {
  return {
    documentId: input.document.id,
    fileName: input.document.fileName,
    documentTitle: input.document.title,
    severity: input.severity,
    kind: input.kind,
    detail: input.detail,
    recommendedAction: input.recommendedAction
  };
}

export function buildLibraryHealthReport(input: {
  documents: DocumentRecord[];
  chunks: ChunkRecord[];
  currentIndexConfigSignature: string;
  sourceStatusByDocumentId: Record<string, SourceStatus>;
  generatedAt?: string;
}): LibraryHealthReport {
  const issues: LibraryHealthIssue[] = [];
  const chunkMap = new Map<string, ChunkRecord[]>();

  for (const chunk of input.chunks) {
    const list = chunkMap.get(chunk.documentId) ?? [];
    list.push(chunk);
    chunkMap.set(chunk.documentId, list);
  }

  for (const document of input.documents) {
    const sourceStatus = input.sourceStatusByDocumentId[document.id] ?? {
      exists: false,
      sourceUpdatedAt: null
    };
    const chunks = chunkMap.get(document.id) ?? [];

    if (!sourceStatus.exists) {
      issues.push(
        makeIssue({
          document,
          severity: "error",
          kind: "missing_source",
          detail: "源文件已不存在，建议移除该文档记录或重新导入。",
          recommendedAction: "remove_document"
        })
      );
      continue;
    }

    if (document.sourceUpdatedAt && sourceStatus.sourceUpdatedAt && document.sourceUpdatedAt !== sourceStatus.sourceUpdatedAt) {
      issues.push(
        makeIssue({
          document,
          severity: "warning",
          kind: "source_updated",
          detail: "源文件已更新，但当前索引仍基于旧版本内容，建议重建索引。",
          recommendedAction: "reindex_document"
        })
      );
    }

    if (document.indexConfigSignature !== input.currentIndexConfigSignature) {
      issues.push(
        makeIssue({
          document,
          severity: "warning",
          kind: "index_config_mismatch",
          detail: "当前 chunk 配置或解析版本已变化，建议重建索引以保持一致。",
          recommendedAction: "reindex_document"
        })
      );
    }

    if (chunks.length === 0 || document.chunkCount === 0 || chunks.length !== document.chunkCount) {
      issues.push(
        makeIssue({
          document,
          severity: "error",
          kind: "missing_chunks",
          detail: "文档 chunk 记录缺失或数量不一致，建议重建索引。",
          recommendedAction: "reindex_document"
        })
      );
    }

    if (chunks.length > 0 && chunks.some((chunk) => !chunk.embedding)) {
      issues.push(
        makeIssue({
          document,
          severity: "warning",
          kind: "missing_embeddings",
          detail: "部分 chunk 缺少向量表示，语义检索效果会受影响，建议重建索引。",
          recommendedAction: "reindex_document"
        })
      );
    }
  }

  const missingSourceCount = new Set(
    issues.filter((issue) => issue.kind === "missing_source").map((issue) => issue.documentId)
  ).size;
  const reindexNeededCount = new Set(
    issues.filter((issue) => issue.recommendedAction === "reindex_document").map((issue) => issue.documentId)
  ).size;

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    summary: {
      totalDocuments: input.documents.length,
      issueCount: issues.length,
      missingSourceCount,
      reindexNeededCount
    },
    issues
  };
}

import fs from "node:fs/promises";
import path from "node:path";
import { app as electronApp, shell } from "electron";
import { chunkText } from "../lib/modules/chunk/chunkText";
import { createStableId } from "../lib/modules/core/id";
import { embedTexts, getEmbeddingStatus } from "../lib/modules/embed/localEmbedder";
import { answerQuestion } from "../lib/modules/answer/answerQuestion";
import { parseDocument } from "../lib/modules/parse/parseDocument";
import { buildRetrievalDebugPayload } from "../lib/modules/retrieve/retrievalDebug";
import { selectCandidateChunksFromVectors } from "../lib/modules/retrieve/candidateChunks";
import { searchChunks } from "../lib/modules/retrieve/searchIndex";
import type {
  AppSnapshot,
  AppSettings,
  ChatSession,
  ChatTurn,
  ChunkRecord,
  DocumentQuestionMatch,
  DocumentRecord,
  EvalCaseDraft,
  ImportResult,
  ImportIssueDetail,
  LibraryHealthReport,
  LibraryTaskKind,
  LibraryTaskPhase,
  LibraryTaskProgress,
  ParsedDocumentContent,
  QueryLogFeedbackStatus,
  QueryLogRecord
} from "../lib/shared/types";
import { AppStore } from "./store";
import { LanceChunkRow, LanceIndex } from "./lanceIndex";
import { buildEvalCaseDrafts } from "../lib/eval/queryLogDrafts";
import { buildLibraryHealthReport } from "../lib/health/libraryHealth";
import { buildDocumentOpenTarget, shouldUseExternalDocumentOpenTarget } from "./documentOpen";
import { createImportError, normalizeImportError, toImportIssueDetail } from "./importErrors";
import { recordTaskProgressSnapshot } from "./diagnosticsBuffer";

function deriveDocumentTitle(fileName: string, content: string): string {
  const markdownHeading = content.match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim();
  if (markdownHeading) {
    return markdownHeading;
  }

  const firstMeaningfulLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && line.length <= 120);

  if (firstMeaningfulLine) {
    return firstMeaningfulLine;
  }

  return path.parse(fileName).name;
}

function buildIndexConfigSignature(settings: Pick<AppSettings, "chunkSize" | "chunkOverlap">): string {
  return JSON.stringify({
    chunkSize: settings.chunkSize,
    chunkOverlap: settings.chunkOverlap,
    parserVersion: 2
  });
}

function hasUsableChunkState(document: DocumentRecord, chunks: ChunkRecord[]): boolean {
  return chunks.length > 0 && chunks.length === document.chunkCount && chunks.some((chunk) => Boolean(chunk.embedding));
}

function isEffectivelyEmptyContent(content: string): boolean {
  return content.replace(/\s+/g, "").length === 0;
}

export class KnowledgeService {
  private readonly lanceIndex = new LanceIndex();
  private activeLibraryTask: { id: string; kind: LibraryTaskKind } | null = null;

  constructor(private readonly store: AppStore) {}

  private deriveSessionTitle(question: string): string {
    const normalized = question.replace(/\s+/g, " ").trim();
    if (normalized.length <= 24) {
      return normalized;
    }
    return `${normalized.slice(0, 24)}...`;
  }

  private async attachEmbeddings(chunks: ChunkRecord[]): Promise<ChunkRecord[]> {
    try {
      const vectors = await embedTexts(chunks.map((chunk) => [chunk.sectionPath, chunk.text].filter(Boolean).join("\n")));
      return chunks.map((chunk, index) => ({
        ...chunk,
        embedding: JSON.stringify(vectors[index] ?? [])
      }));
    } catch {
      return chunks.map((chunk) => ({
        ...chunk,
        embedding: null
      }));
    }
  }

  private async backfillMissingEmbeddings(documents: DocumentRecord[], chunks: ChunkRecord[]): Promise<ChunkRecord[]> {
    const missingDocumentIds = new Set(
      chunks.filter((chunk) => !chunk.embedding).map((chunk) => chunk.documentId)
    );

    if (missingDocumentIds.size === 0) {
      return chunks;
    }

    for (const document of documents) {
      if (!missingDocumentIds.has(document.id)) {
        continue;
      }

      const settings = this.store.getSettings();
      const indexConfigSignature = buildIndexConfigSignature(settings);
      const parsed: ParsedDocumentContent = await fs
        .access(document.filePath)
        .then(() => parseDocument(document.filePath))
        .catch(() => ({ fileType: document.fileType, content: document.content, pageSpans: undefined }));
      const title = document.title || deriveDocumentTitle(document.fileName, parsed.content);
      const baseChunks = chunkText(document.id, parsed.content, { ...settings, documentTitle: title, pageSpans: parsed.pageSpans });
      const hydratedChunks = await this.attachEmbeddings(baseChunks);
      this.store.upsertDocument(
        { ...document, title, content: parsed.content, indexConfigSignature, chunkCount: hydratedChunks.length, updatedAt: document.updatedAt },
        hydratedChunks
      );
    }

    const refreshedChunks = this.store.listChunks();
    await this.rebuildLanceIndex(documents, refreshedChunks);
    return refreshedChunks;
  }

  private toLanceRows(documents: DocumentRecord[], chunks: ChunkRecord[]): LanceChunkRow[] {
    const documentMap = new Map(documents.map((document) => [document.id, document]));

    return chunks
      .map((chunk) => {
        const document = documentMap.get(chunk.documentId);
        if (!document || !chunk.embedding) {
          return null;
        }

        try {
          const vector = JSON.parse(chunk.embedding) as number[];
          if (!Array.isArray(vector) || vector.length === 0) {
            return null;
          }

          return {
            chunkId: chunk.id,
            documentId: chunk.documentId,
            fileName: document.fileName,
            documentTitle: document.title,
            sectionTitle: chunk.sectionTitle ?? "",
            sectionPath: chunk.sectionPath ?? "",
            text: chunk.text,
            vector
          } satisfies LanceChunkRow;
        } catch {
          return null;
        }
      })
      .filter((row): row is LanceChunkRow => row !== null);
  }

  private async rebuildLanceIndex(documents: DocumentRecord[], chunks: ChunkRecord[]): Promise<void> {
    try {
      await this.lanceIndex.rebuild(this.toLanceRows(documents, chunks));
    } catch {
      // Keep the app usable even if the native vector layer is unavailable.
    }
  }

  private emitTaskProgress(
    emitProgress: ((progress: LibraryTaskProgress) => void) | undefined,
    input: Omit<LibraryTaskProgress, "done"> & { phase: LibraryTaskPhase }
  ): void {
    const progress: LibraryTaskProgress = {
      ...input,
      done: input.phase === "completed" || (input.phase === "failed" && input.current >= input.total)
    };
    emitProgress?.(progress);
    recordTaskProgressSnapshot(progress);
  }

  private createTaskId(kind: LibraryTaskKind): string {
    return createStableId(`${kind}:${Date.now()}:${Math.random()}`);
  }

  private beginLibraryTask(kind: LibraryTaskKind): { taskId: string; finish: () => void } {
    if (this.activeLibraryTask) {
      const label = this.activeLibraryTask.kind === "import" ? "导入文件" : "重建索引";
      throw new Error(`当前正在执行${label}任务，请等待完成后再试。`);
    }

    const taskId = this.createTaskId(kind);
    this.activeLibraryTask = { id: taskId, kind };
    return {
      taskId,
      finish: () => {
        if (this.activeLibraryTask?.id === taskId) {
          this.activeLibraryTask = null;
        }
      }
    };
  }

  private ensureLibraryTaskIdle(): void {
    if (this.activeLibraryTask) {
      const label = this.activeLibraryTask.kind === "import" ? "导入文件" : "重建索引";
      throw new Error(`当前正在执行${label}任务，请稍后再试。`);
    }
  }

  async getSnapshot(): Promise<AppSnapshot> {
    const embeddingStatus = await getEmbeddingStatus();
    const stats = this.store.getLibraryStats();
    return {
      documents: this.store.listDocuments(),
      settings: this.store.getSettings(),
      chatSessions: this.store.listChatSessions(),
      systemStatus: {
        documentCount: stats.documentCount,
        chunkCount: stats.chunkCount,
        embeddingAvailable: embeddingStatus.available,
        embeddingReason: embeddingStatus.reason
      },
      appInfo: {
        version: electronApp.getVersion(),
        platform: process.platform,
        userDataPath: electronApp.getPath("userData"),
        databasePath: this.store.getDatabasePath()
      }
    };
  }

  async getLibraryHealth(): Promise<LibraryHealthReport> {
    const documents = this.store.listDocuments();
    const chunks = this.store.listChunks();
    const currentIndexConfigSignature = buildIndexConfigSignature(this.store.getSettings());
    const sourceStatusEntries = await Promise.all(
      documents.map(async (document) => {
        try {
          const stats = await fs.stat(document.filePath);
          return [
            document.id,
            {
              exists: true,
              sourceUpdatedAt: new Date(stats.mtimeMs).toISOString()
            }
          ] as const;
        } catch {
          return [
            document.id,
            {
              exists: false,
              sourceUpdatedAt: null
            }
          ] as const;
        }
      })
    );

    return buildLibraryHealthReport({
      documents,
      chunks,
      currentIndexConfigSignature,
      sourceStatusByDocumentId: Object.fromEntries(sourceStatusEntries)
    });
  }

  async importFiles(
    filePaths: string[],
    emitProgress?: (progress: LibraryTaskProgress) => void
  ): Promise<ImportResult> {
    const task = this.beginLibraryTask("import");
    const imported: DocumentRecord[] = [];
    const skipped: string[] = [];
    const skippedDetails: ImportIssueDetail[] = [];
    const { taskId } = task;

    try {
      this.emitTaskProgress(emitProgress, {
        taskId,
        kind: "import",
        phase: "preparing",
        message: `准备导入 ${filePaths.length} 个文件`,
        current: 0,
        total: filePaths.length,
        currentFile: null,
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0
      });

      for (const [index, filePath] of filePaths.entries()) {
        try {
          const fileStats = await fs.stat(filePath);
          const now = new Date().toISOString();
          const documentId = createStableId(filePath);
          const settings = this.store.getSettings();
          const indexConfigSignature = buildIndexConfigSignature(settings);
          const existing = this.store.getDocument(documentId);
          const existingChunks = existing ? this.store.listChunks(documentId) : [];
          const sourceUpdatedAt = new Date(fileStats.mtimeMs).toISOString();
          const canSkipUnchanged =
            Boolean(existing) &&
            existing?.sourceUpdatedAt === sourceUpdatedAt &&
            existing?.indexConfigSignature === indexConfigSignature &&
            hasUsableChunkState(existing, existingChunks);

          if (canSkipUnchanged && existing) {
            skipped.push(filePath);
            skippedDetails.push(
              toImportIssueDetail(
                filePath,
                "skipped",
                createImportError({
                  code: "unchanged_skipped",
                  stage: "preflight",
                  message: "文件未变化，已跳过重复导入。",
                  suggestion: "如果你已经修改过切片或检索配置，请使用重建索引。",
                  retryable: false
                })
              )
            );
            this.emitTaskProgress(emitProgress, {
              taskId,
              kind: "import",
              phase: "saving",
              message: `跳过未变化文件：${path.basename(filePath)}`,
              current: index + 1,
              total: filePaths.length,
              currentFile: filePath,
              processed: imported.length + skipped.length,
              succeeded: imported.length,
              failed: skipped.length,
              skipped: skipped.length
            });
            continue;
          }

          this.emitTaskProgress(emitProgress, {
            taskId,
            kind: "import",
            phase: "parsing",
            message: `正在解析 ${path.basename(filePath)}`,
            current: index,
            total: filePaths.length,
            currentFile: filePath,
            processed: imported.length + skipped.length,
            succeeded: imported.length,
            failed: skipped.length,
            skipped: skipped.length
          });
          const parsed = await parseDocument(filePath);
          if (isEffectivelyEmptyContent(parsed.content)) {
            throw createImportError({
              code: "empty_content",
              stage: "parsing",
              message: `文件解析后没有可索引内容：${path.basename(filePath)}`,
              suggestion: "请确认文件中包含可提取文本，而不是纯图片或空白内容。",
              retryable: false
            });
          }
          const title = deriveDocumentTitle(path.basename(filePath), parsed.content);

          this.emitTaskProgress(emitProgress, {
            taskId,
            kind: "import",
            phase: "chunking",
            message: `正在切分 ${path.basename(filePath)}`,
            current: index,
            total: filePaths.length,
            currentFile: filePath,
            processed: imported.length + skipped.length,
            succeeded: imported.length,
            failed: skipped.length,
            skipped: skipped.length
          });
          const baseChunks = chunkText(documentId, parsed.content, { ...settings, documentTitle: title, pageSpans: parsed.pageSpans });
          if (baseChunks.length === 0) {
            throw createImportError({
              code: "chunk_failed",
              stage: "chunking",
              message: `文档切分后没有生成有效片段：${path.basename(filePath)}`,
              suggestion: "请检查文档结构是否异常，或调整 chunk 参数后重试。",
              retryable: true
            });
          }

          this.emitTaskProgress(emitProgress, {
            taskId,
            kind: "import",
            phase: "embedding",
            message: `正在生成向量 ${path.basename(filePath)}`,
            current: index,
            total: filePaths.length,
            currentFile: filePath,
            processed: imported.length + skipped.length,
            succeeded: imported.length,
            failed: skipped.length,
            skipped: skipped.length
          });
          const chunks = await this.attachEmbeddings(baseChunks);

          const document: DocumentRecord = {
            id: documentId,
            filePath,
            fileName: path.basename(filePath),
            title,
            fileType: parsed.fileType,
            content: parsed.content,
            importedAt: existing?.importedAt ?? now,
            updatedAt: now,
            sourceCreatedAt: existing?.sourceCreatedAt ?? new Date(fileStats.birthtimeMs).toISOString(),
            sourceUpdatedAt,
            indexConfigSignature,
            chunkCount: chunks.length
          };

          this.store.upsertDocument(document, chunks);
          imported.push(document);
          this.emitTaskProgress(emitProgress, {
            taskId,
            kind: "import",
            phase: "saving",
            message: `已写入 ${path.basename(filePath)}`,
            current: index + 1,
            total: filePaths.length,
            currentFile: filePath,
            processed: imported.length + skipped.length,
            succeeded: imported.length,
            failed: skipped.length,
            skipped: skipped.length
          });
        } catch (error) {
          const normalizedError = normalizeImportError(error, filePath, "unknown");
          skipped.push(filePath);
          skippedDetails.push(toImportIssueDetail(filePath, "failed", normalizedError));
          this.emitTaskProgress(emitProgress, {
            taskId,
            kind: "import",
            phase: "failed",
            message: `导入失败：${path.basename(filePath)} · ${normalizedError.code}`,
            current: index + 1,
            total: filePaths.length,
            currentFile: filePath,
            processed: imported.length + skipped.length,
            succeeded: imported.length,
            failed: skipped.length,
            skipped: skipped.length
          });
        }
      }

      this.emitTaskProgress(emitProgress, {
        taskId,
        kind: "import",
        phase: "rebuilding_index",
        message: "正在重建向量索引",
        current: filePaths.length,
        total: filePaths.length,
        currentFile: null,
        processed: imported.length + skipped.length,
        succeeded: imported.length,
        failed: skipped.length,
        skipped: skipped.length
      });
      await this.rebuildLanceIndex(this.store.listDocuments(), this.store.listChunks());
      this.emitTaskProgress(emitProgress, {
        taskId,
        kind: "import",
        phase: "completed",
        message: `导入完成：成功 ${imported.length}，失败 ${skipped.length}`,
        current: filePaths.length,
        total: filePaths.length,
        currentFile: null,
        processed: imported.length + skipped.length,
        succeeded: imported.length,
        failed: skipped.length,
        skipped: skipped.length
      });
      return { imported, skipped, skippedDetails };
    } catch (error) {
      this.emitTaskProgress(emitProgress, {
        taskId,
        kind: "import",
        phase: "failed",
        message: error instanceof Error ? `导入任务失败：${error.message}` : "导入任务失败",
        current: filePaths.length,
        total: filePaths.length,
        currentFile: null,
        processed: imported.length + skipped.length,
        succeeded: imported.length,
        failed: skipped.length,
        skipped: skipped.length
      });
      throw error;
    } finally {
      task.finish();
    }
  }

  private async runReindexForDocuments(
    documents: DocumentRecord[],
    emitProgress?: (progress: LibraryTaskProgress) => void
  ): Promise<AppSnapshot> {
    const task = this.beginLibraryTask("reindex");
    const settings = this.store.getSettings();
    const indexConfigSignature = buildIndexConfigSignature(settings);
    const { taskId } = task;

    try {
      this.emitTaskProgress(emitProgress, {
        taskId,
        kind: "reindex",
        phase: "preparing",
        message: `准备重建 ${documents.length} 个文档的索引`,
        current: 0,
        total: documents.length,
        currentFile: null,
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0
      });

      let succeeded = 0;
      let failed = 0;
      let skipped = 0;

      for (const [index, document] of documents.entries()) {
        try {
          const fileStats = await fs.stat(document.filePath);
          const sourceUpdatedAt = new Date(fileStats.mtimeMs).toISOString();
          const existingChunks = this.store.listChunks(document.id);
          const hasChunkCoverage = existingChunks.length > 0 && existingChunks.length === document.chunkCount;
          const hasEmbeddings = existingChunks.some((chunk) => Boolean(chunk.embedding));
          const shouldSkip =
            document.sourceUpdatedAt === sourceUpdatedAt &&
            document.indexConfigSignature === indexConfigSignature &&
            hasChunkCoverage &&
            hasEmbeddings;

          if (shouldSkip) {
            skipped += 1;
            this.emitTaskProgress(emitProgress, {
              taskId,
              kind: "reindex",
              phase: "saving",
              message: `跳过未变化文档：${document.fileName}`,
              current: index + 1,
              total: documents.length,
              currentFile: document.filePath,
              processed: succeeded + failed + skipped,
              succeeded,
              failed,
              skipped
            });
            continue;
          }

          this.emitTaskProgress(emitProgress, {
            taskId,
            kind: "reindex",
            phase: "parsing",
            message: `正在解析 ${document.fileName}`,
            current: index,
            total: documents.length,
            currentFile: document.filePath,
            processed: succeeded + failed + skipped,
            succeeded,
            failed,
            skipped
          });
          const parsed: ParsedDocumentContent = await parseDocument(document.filePath);
          if (isEffectivelyEmptyContent(parsed.content)) {
            throw createImportError({
              code: "empty_content",
              stage: "parsing",
              message: `文件解析后没有可索引内容：${document.fileName}`,
              suggestion: "请确认文件中包含可提取文本，而不是纯图片或空白内容。",
              retryable: false
            });
          }
          const title = document.title || deriveDocumentTitle(document.fileName, parsed.content);

          this.emitTaskProgress(emitProgress, {
            taskId,
            kind: "reindex",
            phase: "chunking",
            message: `正在切分 ${document.fileName}`,
            current: index,
            total: documents.length,
            currentFile: document.filePath,
            processed: succeeded + failed + skipped,
            succeeded,
            failed,
            skipped
          });
          const baseChunks = chunkText(document.id, parsed.content, { ...settings, documentTitle: title, pageSpans: parsed.pageSpans });
          if (baseChunks.length === 0) {
            throw createImportError({
              code: "chunk_failed",
              stage: "chunking",
              message: `文档切分后没有生成有效片段：${document.fileName}`,
              suggestion: "请检查文档结构是否异常，或调整 chunk 参数后重试。",
              retryable: true
            });
          }

          this.emitTaskProgress(emitProgress, {
            taskId,
            kind: "reindex",
            phase: "embedding",
            message: `正在生成向量 ${document.fileName}`,
            current: index,
            total: documents.length,
            currentFile: document.filePath,
            processed: succeeded + failed + skipped,
            succeeded,
            failed,
            skipped
          });
          const chunks = await this.attachEmbeddings(baseChunks);
          this.store.upsertDocument({
            ...document,
            title,
            content: parsed.content,
            sourceUpdatedAt,
            indexConfigSignature,
            chunkCount: chunks.length,
            updatedAt: new Date().toISOString()
          }, chunks);
          succeeded += 1;
          this.emitTaskProgress(emitProgress, {
            taskId,
            kind: "reindex",
            phase: "saving",
            message: `已更新 ${document.fileName}`,
            current: index + 1,
            total: documents.length,
            currentFile: document.filePath,
            processed: succeeded + failed + skipped,
            succeeded,
            failed,
            skipped
          });
        } catch (error) {
          const normalizedError = normalizeImportError(error, document.filePath, "unknown");
          failed += 1;
          this.emitTaskProgress(emitProgress, {
            taskId,
            kind: "reindex",
            phase: "failed",
            message: `重建失败：${document.fileName} · ${normalizedError.code}`,
            current: index + 1,
            total: documents.length,
            currentFile: document.filePath,
            processed: succeeded + failed + skipped,
            succeeded,
            failed,
            skipped
          });
        }
      }

      this.emitTaskProgress(emitProgress, {
        taskId,
        kind: "reindex",
        phase: "rebuilding_index",
        message: "正在重建向量索引",
        current: documents.length,
        total: documents.length,
        currentFile: null,
        processed: succeeded + failed + skipped,
        succeeded,
        failed,
        skipped
      });
      await this.rebuildLanceIndex(this.store.listDocuments(), this.store.listChunks());
      this.emitTaskProgress(emitProgress, {
        taskId,
        kind: "reindex",
        phase: "completed",
        message: `重建索引完成：更新 ${succeeded}，跳过 ${skipped}，失败 ${failed}`,
        current: documents.length,
        total: documents.length,
        currentFile: null,
        processed: succeeded + failed + skipped,
        succeeded,
        failed,
        skipped
      });
      return this.getSnapshot();
    } catch (error) {
      this.emitTaskProgress(emitProgress, {
        taskId,
        kind: "reindex",
        phase: "failed",
        message: error instanceof Error ? `重建索引失败：${error.message}` : "重建索引失败",
        current: documents.length,
        total: documents.length,
        currentFile: null,
        processed: documents.length,
        succeeded: 0,
        failed: documents.length,
        skipped: 0
      });
      throw error;
    } finally {
      task.finish();
    }
  }

  async reindexLibrary(emitProgress?: (progress: LibraryTaskProgress) => void): Promise<AppSnapshot> {
    return this.runReindexForDocuments(this.store.listDocuments(), emitProgress);
  }

  async reindexDocuments(documentIds: string[], emitProgress?: (progress: LibraryTaskProgress) => void): Promise<AppSnapshot> {
    const targets = this.store
      .listDocuments()
      .filter((document) => documentIds.includes(document.id));
    return this.runReindexForDocuments(targets, emitProgress);
  }

  async deleteDocument(documentId: string): Promise<AppSnapshot> {
    this.ensureLibraryTaskIdle();
    this.store.deleteDocument(documentId);
    await this.rebuildLanceIndex(this.store.listDocuments(), this.store.listChunks());
    return this.getSnapshot();
  }

  async removeDocuments(documentIds: string[]): Promise<AppSnapshot> {
    this.ensureLibraryTaskIdle();
    this.store.deleteDocuments(documentIds);
    await this.rebuildLanceIndex(this.store.listDocuments(), this.store.listChunks());
    return this.getSnapshot();
  }

  async clearLibrary(): Promise<AppSnapshot> {
    this.ensureLibraryTaskIdle();
    this.store.clearLibrary();
    try {
      await this.lanceIndex.clear();
    } catch {
      // Ignore vector index cleanup failures and rely on the cleared SQLite state.
    }
    return this.getSnapshot();
  }

  createChatSession(): ChatSession {
    const now = new Date().toISOString();
    return this.store.createChatSession({
      id: createStableId(`chat-session:${now}:${Math.random()}`),
      title: "新对话",
      createdAt: now,
      updatedAt: now
    });
  }

  getChatTurns(sessionId: string): ChatTurn[] {
    return this.store.listChatTurns(sessionId);
  }

  async askQuestion(sessionId: string, question: string): Promise<ChatTurn> {
    const documents = this.store.listDocuments();
    const chunks = await this.backfillMissingEmbeddings(documents, this.store.listChunks());
    let queryEmbedding: number[] | null = null;

    try {
      const [vector] = await embedTexts([question]);
      queryEmbedding = vector ?? null;
    } catch {
      queryEmbedding = null;
    }

    let vectorChunkIds: string[] = [];
    if (queryEmbedding) {
      try {
        vectorChunkIds = await this.lanceIndex.search(queryEmbedding, 24);
        if (vectorChunkIds.length === 0 && chunks.some((chunk) => chunk.embedding)) {
          await this.rebuildLanceIndex(documents, chunks);
          vectorChunkIds = await this.lanceIndex.search(queryEmbedding, 24);
        }
      } catch {
        vectorChunkIds = [];
      }
    }

    const candidateChunks = selectCandidateChunksFromVectors(question, documents, chunks, vectorChunkIds);
    const results = searchChunks(question, documents, candidateChunks, 6, queryEmbedding);
    const answer = answerQuestion(question, results);
    if (process.env.PKRAG_RETRIEVAL_DEBUG === "1") {
      console.log(
        JSON.stringify(
          buildRetrievalDebugPayload(question, vectorChunkIds, candidateChunks.length, results, answer)
        )
      );
    }
    const turn: ChatTurn = {
      id: createStableId(`chat-turn:${sessionId}:${question}:${Date.now()}`),
      sessionId,
      question,
      answer,
      createdAt: new Date().toISOString()
    };

    const existingTurns = this.store.listChatTurns(sessionId);
    const nextTitle = existingTurns.length === 0 ? this.deriveSessionTitle(question) : undefined;
    this.store.saveChatTurn(turn, nextTitle);
    this.store.saveQueryLog({
      id: createStableId(`query-log:${sessionId}:${question}:${turn.createdAt}`),
      sessionId,
      question,
      answer,
      citations: answer.citations,
      topResults: results,
      createdAt: turn.createdAt,
      feedbackStatus: "pending",
      feedbackNote: null
    } satisfies QueryLogRecord);
    return turn;
  }

  async deleteChatSession(sessionId: string): Promise<AppSnapshot> {
    this.store.deleteChatSession(sessionId);
    return this.getSnapshot();
  }

  async clearChatSessions(): Promise<AppSnapshot> {
    this.store.clearChatSessions();
    return this.getSnapshot();
  }

  getDocument(documentId: string): DocumentRecord | null {
    return this.store.getDocument(documentId);
  }

  getDocumentChunks(documentId: string): ChunkRecord[] {
    return this.store.listChunks(documentId);
  }

  async getDocumentQuestionMatches(
    documentId: string,
    question: string,
    limit = 10
  ): Promise<DocumentQuestionMatch[]> {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) {
      return [];
    }

    const document = this.store.getDocument(documentId);
    if (!document) {
      return [];
    }

    const chunks = this.store.listChunks(documentId);
    if (chunks.length === 0) {
      return [];
    }

    const results = searchChunks(
      normalizedQuestion,
      [document],
      chunks,
      Math.min(Math.max(limit, 1), chunks.length)
    );

    return results.map((result, index) => ({
      ...result,
      matchRank: index + 1
    }));
  }

  updateSettings(settings: Partial<AppSettings>): AppSettings {
    return this.store.updateSettings(settings);
  }

  async openDocument(filePath: string): Promise<void> {
    await shell.openPath(filePath);
  }

  async openDocumentAtLocation(filePath: string, pageNumber?: number | null): Promise<void> {
    const target = buildDocumentOpenTarget(filePath, pageNumber);
    const openResult = shouldUseExternalDocumentOpenTarget(target)
      ? await shell.openExternal(target)
      : await shell.openPath(filePath);

    if (openResult) {
      await shell.openPath(filePath);
    }
  }

  getQueryLogs(limit = 50): QueryLogRecord[] {
    return this.store.listQueryLogs(limit);
  }

  updateQueryLogStatus(logId: string, status: QueryLogFeedbackStatus, note: string | null = null): QueryLogRecord[] {
    this.store.updateQueryLogStatus(logId, status, note);
    return this.store.listQueryLogs(50);
  }

  getEvalCandidateDrafts(limit = 20): EvalCaseDraft[] {
    const logs = this.store.listQueryLogs(Math.max(limit * 3, limit));
    return buildEvalCaseDrafts(logs.filter((log) => log.feedbackStatus === "benchmark_candidate")).slice(0, limit);
  }
}

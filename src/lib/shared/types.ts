export type SupportedFileType = "pdf" | "md" | "txt" | "docx";

export interface SourcePageSpan {
  pageNumber: number;
  startOffset: number;
  endOffset: number;
}

export interface ParsedDocumentContent {
  fileType: SupportedFileType;
  content: string;
  pageSpans?: SourcePageSpan[];
}

export interface DocumentRecord {
  id: string;
  filePath: string;
  fileName: string;
  title: string;
  fileType: SupportedFileType;
  content: string;
  importedAt: string;
  updatedAt: string;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  indexConfigSignature?: string | null;
  chunkCount: number;
}

export interface ChunkRecord {
  id: string;
  documentId: string;
  text: string;
  chunkIndex: number;
  startOffset: number;
  endOffset: number;
  tokenCount: number;
  sectionTitle: string | null;
  sectionPath: string | null;
  headingTrail: string | null;
  pageStart?: number | null;
  pageEnd?: number | null;
  paragraphStart?: number | null;
  paragraphEnd?: number | null;
  locatorLabel?: string | null;
  embedding?: string | null;
}

export interface Citation {
  documentId: string;
  fileName: string;
  documentTitle: string;
  chunkId: string;
  snippet: string;
  evidenceText?: string;
  anchorLabel?: string | null;
  highlightText?: string | null;
  highlightStart?: number | null;
  highlightEnd?: number | null;
  fullText: string;
  score: number;
  chunkIndex: number;
  sectionTitle: string | null;
  sectionPath: string | null;
  sectionRootLabel?: string | null;
  pageStart?: number | null;
  pageEnd?: number | null;
  paragraphStart?: number | null;
  paragraphEnd?: number | null;
  locatorLabel?: string | null;
  sourceUpdatedAt: string | null;
  importedAt: string;
}

export interface SearchResult extends Citation {
  text: string;
  lexicalScore: number;
  semanticScore: number;
  freshnessScore: number;
  rerankScore: number;
  qualityScore: number;
}

export interface DocumentQuestionMatch extends SearchResult {
  matchRank: number;
}

export interface ChatAnswer {
  answer: string;
  directAnswer: string;
  supportingPoints: string[];
  sourceDocumentCount: number;
  basedOnSingleDocument: boolean;
  citations: Citation[];
}

export type QueryLogFeedbackStatus = "pending" | "benchmark_candidate" | "promoted" | "ignored";

export interface EvalCaseDraft {
  id: string;
  sourceLogId: string;
  category: "definition" | "procedure" | "troubleshooting" | "navigational" | "role" | "general";
  question: string;
  expectation: {
    topK: number;
    fileNameIncludes?: string;
    sectionPathIncludes?: string[];
    evidenceIncludes?: string[];
  };
}

export interface QueryLogRecord {
  id: string;
  sessionId: string;
  question: string;
  answer: ChatAnswer;
  citations: Citation[];
  topResults: SearchResult[];
  createdAt: string;
  feedbackStatus: QueryLogFeedbackStatus;
  feedbackNote: string | null;
}

export interface ChatTurn {
  id: string;
  sessionId: string;
  question: string;
  answer: ChatAnswer;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  lastQuestion: string | null;
}

export interface SystemStatus {
  documentCount: number;
  chunkCount: number;
  embeddingAvailable: boolean;
  embeddingReason: string | null;
}

export interface AppInfo {
  version: string;
  platform: string;
  userDataPath: string;
  databasePath: string;
}

export type AppErrorCode =
  | "file_not_found"
  | "permission_denied"
  | "unsupported_file_type"
  | "file_corrupted"
  | "pdf_unreadable"
  | "empty_content"
  | "chunk_failed"
  | "embedding_failed"
  | "vector_index_failed"
  | "sqlite_write_failed"
  | "state_sync_failed"
  | "unchanged_skipped"
  | "unknown_import_error";

export type AppErrorStage =
  | "preflight"
  | "parsing"
  | "chunking"
  | "embedding"
  | "indexing"
  | "storage"
  | "sync"
  | "unknown";

export interface AppErrorInfo {
  code: AppErrorCode;
  stage: AppErrorStage;
  message: string;
  suggestion: string | null;
  retryable: boolean;
}

export type RendererErrorCode = AppErrorCode | "ipc_forbidden" | "ipc_validation" | "ipc_handler" | "unknown_ipc_error";

export type RendererErrorStage = AppErrorStage | "ipc";

export interface RendererErrorInfo {
  code: RendererErrorCode;
  stage: RendererErrorStage;
  message: string;
  suggestion: string | null;
  retryable: boolean;
  details?: Record<string, unknown> | null;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: RendererErrorInfo };

export interface ImportIssueDetail extends AppErrorInfo {
  filePath: string;
  reason: string;
  disposition: "skipped" | "failed";
}

export interface ImportResult {
  imported: DocumentRecord[];
  skipped: string[];
  skippedDetails: ImportIssueDetail[];
}

export type LibraryTaskKind = "import" | "reindex";

export type LibraryTaskPhase =
  | "preparing"
  | "parsing"
  | "chunking"
  | "embedding"
  | "saving"
  | "rebuilding_index"
  | "completed"
  | "failed";

export interface LibraryTaskProgress {
  taskId: string;
  kind: LibraryTaskKind;
  phase: LibraryTaskPhase;
  message: string;
  current: number;
  total: number;
  currentFile: string | null;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  done: boolean;
}

export type LibraryHealthIssueKind =
  | "missing_source"
  | "source_updated"
  | "index_config_mismatch"
  | "missing_chunks"
  | "missing_embeddings";

export type LibraryHealthRecommendedAction = "remove_document" | "reindex_document";

export interface LibraryHealthIssue {
  documentId: string;
  fileName: string;
  documentTitle: string;
  severity: "warning" | "error";
  kind: LibraryHealthIssueKind;
  detail: string;
  recommendedAction: LibraryHealthRecommendedAction;
}

export interface LibraryHealthReport {
  generatedAt: string;
  summary: {
    totalDocuments: number;
    issueCount: number;
    missingSourceCount: number;
    reindexNeededCount: number;
  };
  issues: LibraryHealthIssue[];
}

export interface AppSettings {
  libraryPath: string | null;
  chunkSize: number;
  chunkOverlap: number;
}

export interface AppSnapshot {
  documents: DocumentRecord[];
  settings: AppSettings;
  chatSessions: ChatSession[];
  systemStatus: SystemStatus;
  appInfo: AppInfo;
}

export interface DesktopApi {
  getSnapshot(): Promise<AppSnapshot>;
  importFiles(filePaths?: string[]): Promise<ImportResult>;
  askQuestion(sessionId: string, question: string): Promise<ChatTurn>;
  getDocument(documentId: string): Promise<DocumentRecord | null>;
  getDocumentChunks(documentId: string): Promise<ChunkRecord[]>;
  getDocumentQuestionMatches(documentId: string, question: string, limit?: number): Promise<DocumentQuestionMatch[]>;
  reindexLibrary(): Promise<AppSnapshot>;
  deleteDocument(documentId: string): Promise<AppSnapshot>;
  clearLibrary(): Promise<AppSnapshot>;
  createChatSession(): Promise<ChatSession>;
  getChatTurns(sessionId: string): Promise<ChatTurn[]>;
  deleteChatSession(sessionId: string): Promise<AppSnapshot>;
  clearChatSessions(): Promise<AppSnapshot>;
  updateSettings(settings: Partial<AppSettings>): Promise<AppSettings>;
  openDocument(filePath: string): Promise<void>;
  getQueryLogs(limit?: number): Promise<QueryLogRecord[]>;
  updateQueryLogStatus(logId: string, status: QueryLogFeedbackStatus, note?: string | null): Promise<QueryLogRecord[]>;
  getEvalCandidateDrafts(limit?: number): Promise<EvalCaseDraft[]>;
  getLibraryHealth(): Promise<LibraryHealthReport>;
  reindexDocuments(documentIds: string[]): Promise<AppSnapshot>;
  removeDocuments(documentIds: string[]): Promise<AppSnapshot>;
  openDocumentAtLocation(filePath: string, pageNumber?: number | null): Promise<void>;
  onLibraryTaskProgress(listener: (progress: LibraryTaskProgress) => void): () => void;
}

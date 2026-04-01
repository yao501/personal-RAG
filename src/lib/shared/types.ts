export type SupportedFileType = "pdf" | "md" | "txt" | "docx";

export interface DocumentRecord {
  id: string;
  filePath: string;
  fileName: string;
  fileType: SupportedFileType;
  content: string;
  importedAt: string;
  updatedAt: string;
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
}

export interface Citation {
  documentId: string;
  fileName: string;
  chunkId: string;
  snippet: string;
  score: number;
  chunkIndex: number;
}

export interface SearchResult extends Citation {
  text: string;
}

export interface ChatAnswer {
  answer: string;
  citations: Citation[];
}

export interface ImportResult {
  imported: DocumentRecord[];
  skipped: string[];
}

export interface AppSettings {
  libraryPath: string | null;
  chunkSize: number;
  chunkOverlap: number;
}

export interface AppSnapshot {
  documents: DocumentRecord[];
  settings: AppSettings;
}

export interface DesktopApi {
  getSnapshot(): Promise<AppSnapshot>;
  importFiles(): Promise<ImportResult>;
  askQuestion(question: string): Promise<ChatAnswer>;
  getDocument(documentId: string): Promise<DocumentRecord | null>;
  getDocumentChunks(documentId: string): Promise<ChunkRecord[]>;
  reindexLibrary(): Promise<AppSnapshot>;
  updateSettings(settings: Partial<AppSettings>): Promise<AppSettings>;
  openDocument(filePath: string): Promise<void>;
}


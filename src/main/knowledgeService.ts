import path from "node:path";
import { shell } from "electron";
import { chunkText } from "../lib/modules/chunk/chunkText";
import { createStableId } from "../lib/modules/core/id";
import { answerQuestion } from "../lib/modules/answer/answerQuestion";
import { parseDocument } from "../lib/modules/parse/parseDocument";
import { searchChunks } from "../lib/modules/retrieve/searchIndex";
import type { AppSnapshot, AppSettings, ChatAnswer, ChunkRecord, DocumentRecord, ImportResult } from "../lib/shared/types";
import { AppStore } from "./store";

export class KnowledgeService {
  constructor(private readonly store: AppStore) {}

  getSnapshot(): AppSnapshot {
    return {
      documents: this.store.listDocuments(),
      settings: this.store.getSettings()
    };
  }

  async importFiles(filePaths: string[]): Promise<ImportResult> {
    const imported: DocumentRecord[] = [];
    const skipped: string[] = [];

    for (const filePath of filePaths) {
      try {
        const parsed = await parseDocument(filePath);
        const now = new Date().toISOString();
        const documentId = createStableId(filePath);
        const settings = this.store.getSettings();
        const existing = this.store.getDocument(documentId);
        const chunks = chunkText(documentId, parsed.content, settings);

        const document: DocumentRecord = {
          id: documentId,
          filePath,
          fileName: path.basename(filePath),
          fileType: parsed.fileType,
          content: parsed.content,
          importedAt: existing?.importedAt ?? now,
          updatedAt: now,
          chunkCount: chunks.length
        };

        this.store.upsertDocument(document, chunks);
        imported.push(document);
      } catch {
        skipped.push(filePath);
      }
    }

    return { imported, skipped };
  }

  async reindexLibrary(): Promise<AppSnapshot> {
    const documents = this.store.listDocuments();
    const settings = this.store.getSettings();

    for (const document of documents) {
      const chunks = chunkText(document.id, document.content, settings);
      this.store.upsertDocument({ ...document, chunkCount: chunks.length, updatedAt: new Date().toISOString() }, chunks);
    }

    return this.getSnapshot();
  }

  async askQuestion(question: string): Promise<ChatAnswer> {
    const documents = this.store.listDocuments();
    const chunks = this.store.listChunks();
    const results = searchChunks(question, documents, chunks);
    return answerQuestion(question, results);
  }

  getDocument(documentId: string): DocumentRecord | null {
    return this.store.getDocument(documentId);
  }

  getDocumentChunks(documentId: string): ChunkRecord[] {
    return this.store.listChunks(documentId);
  }

  updateSettings(settings: Partial<AppSettings>): AppSettings {
    return this.store.updateSettings(settings);
  }

  async openDocument(filePath: string): Promise<void> {
    await shell.openPath(filePath);
  }
}


import path from "node:path";
import { app, shell, ipcMain, dialog, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import Database from "better-sqlite3";
import fs$1 from "node:fs/promises";
import { createHash } from "node:crypto";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import * as lancedb from "@lancedb/lancedb";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
class AppStore {
  db;
  dbPath;
  constructor() {
    const basePath = app.getPath("userData");
    fs.mkdirSync(basePath, { recursive: true });
    this.dbPath = path.join(basePath, "knowledge-rag.db");
    this.db = new Database(this.dbPath);
    this.migrate();
    this.seedSettings();
  }
  getDatabasePath() {
    return this.dbPath;
  }
  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        filePath TEXT NOT NULL UNIQUE,
        fileName TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        fileType TEXT NOT NULL,
        content TEXT NOT NULL,
        importedAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        sourceCreatedAt TEXT,
        sourceUpdatedAt TEXT,
        indexConfigSignature TEXT,
        chunkCount INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        documentId TEXT NOT NULL,
        text TEXT NOT NULL,
        chunkIndex INTEGER NOT NULL,
        startOffset INTEGER NOT NULL,
        endOffset INTEGER NOT NULL,
        tokenCount INTEGER NOT NULL,
        sectionTitle TEXT,
        sectionPath TEXT,
        headingTrail TEXT,
        pageStart INTEGER,
        pageEnd INTEGER,
        paragraphStart INTEGER,
        paragraphEnd INTEGER,
        locatorLabel TEXT,
        embedding TEXT,
        FOREIGN KEY (documentId) REFERENCES documents(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_turns (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        question TEXT NOT NULL,
        answerJson TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (sessionId) REFERENCES chat_sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS query_logs (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        question TEXT NOT NULL,
        answerJson TEXT NOT NULL,
        citationsJson TEXT NOT NULL,
        topResultsJson TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        feedbackStatus TEXT NOT NULL DEFAULT 'pending',
        feedbackNote TEXT
      );
    `);
    this.ensureColumn("documents", "title", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("documents", "sourceCreatedAt", "TEXT");
    this.ensureColumn("documents", "sourceUpdatedAt", "TEXT");
    this.ensureColumn("documents", "indexConfigSignature", "TEXT");
    this.ensureColumn("chunks", "sectionTitle", "TEXT");
    this.ensureColumn("chunks", "sectionPath", "TEXT");
    this.ensureColumn("chunks", "headingTrail", "TEXT");
    this.ensureColumn("chunks", "pageStart", "INTEGER");
    this.ensureColumn("chunks", "pageEnd", "INTEGER");
    this.ensureColumn("chunks", "paragraphStart", "INTEGER");
    this.ensureColumn("chunks", "paragraphEnd", "INTEGER");
    this.ensureColumn("chunks", "locatorLabel", "TEXT");
    this.ensureColumn("chunks", "embedding", "TEXT");
  }
  ensureColumn(tableName, columnName, definition) {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all();
    if (!columns.some((column) => column.name === columnName)) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
  }
  seedSettings() {
    const defaultSettings = {
      libraryPath: null,
      chunkSize: 180,
      chunkOverlap: 40
    };
    const insert = this.db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(defaultSettings)) {
      insert.run(key, JSON.stringify(value));
    }
  }
  getSettings() {
    const rows = this.db.prepare("SELECT key, value FROM settings").all();
    const record = Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value)]));
    return {
      libraryPath: record.libraryPath ?? null,
      chunkSize: record.chunkSize ?? 180,
      chunkOverlap: record.chunkOverlap ?? 40
    };
  }
  updateSettings(settings) {
    const statement = this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    for (const [key, value] of Object.entries(settings)) {
      statement.run(key, JSON.stringify(value));
    }
    return this.getSettings();
  }
  listDocuments() {
    return this.db.prepare("SELECT * FROM documents ORDER BY COALESCE(sourceUpdatedAt, updatedAt) DESC").all();
  }
  getDocument(documentId) {
    return this.db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId) ?? null;
  }
  listChunks(documentId) {
    if (documentId) {
      return this.db.prepare("SELECT * FROM chunks WHERE documentId = ? ORDER BY chunkIndex ASC").all(documentId);
    }
    return this.db.prepare("SELECT * FROM chunks ORDER BY rowid ASC").all();
  }
  getLibraryStats() {
    const documentCount = this.db.prepare("SELECT COUNT(*) as count FROM documents").get();
    const chunkCount = this.db.prepare("SELECT COUNT(*) as count FROM chunks").get();
    return {
      documentCount: documentCount.count,
      chunkCount: chunkCount.count
    };
  }
  listChatSessions() {
    return this.db.prepare(
      `SELECT
           s.id,
           s.title,
           s.createdAt,
           s.updatedAt,
           COUNT(t.id) as turnCount,
           (
             SELECT question
             FROM chat_turns ct
             WHERE ct.sessionId = s.id
             ORDER BY ct.createdAt DESC
             LIMIT 1
           ) as lastQuestion
         FROM chat_sessions s
         LEFT JOIN chat_turns t ON t.sessionId = s.id
         GROUP BY s.id
         ORDER BY s.updatedAt DESC`
    ).all();
  }
  createChatSession(session) {
    this.db.prepare("INSERT INTO chat_sessions (id, title, createdAt, updatedAt) VALUES (@id, @title, @createdAt, @updatedAt)").run(session);
    return {
      ...session,
      turnCount: 0,
      lastQuestion: null
    };
  }
  listChatTurns(sessionId) {
    const rows = this.db.prepare("SELECT id, sessionId, question, answerJson, createdAt FROM chat_turns WHERE sessionId = ? ORDER BY createdAt ASC").all(sessionId);
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      question: row.question,
      answer: JSON.parse(row.answerJson),
      createdAt: row.createdAt
    }));
  }
  listQueryLogs(limit = 50) {
    const rows = this.db.prepare(
      `SELECT id, sessionId, question, answerJson, citationsJson, topResultsJson, createdAt, feedbackStatus, feedbackNote
         FROM query_logs
         ORDER BY createdAt DESC
         LIMIT ?`
    ).all(limit);
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      question: row.question,
      answer: JSON.parse(row.answerJson),
      citations: JSON.parse(row.citationsJson),
      topResults: JSON.parse(row.topResultsJson),
      createdAt: row.createdAt,
      feedbackStatus: row.feedbackStatus,
      feedbackNote: row.feedbackNote
    }));
  }
  saveChatTurn(turn, nextSessionTitle) {
    const transaction = this.db.transaction(() => {
      this.db.prepare("INSERT INTO chat_turns (id, sessionId, question, answerJson, createdAt) VALUES (?, ?, ?, ?, ?)").run(turn.id, turn.sessionId, turn.question, JSON.stringify(turn.answer), turn.createdAt);
      this.db.prepare("UPDATE chat_sessions SET updatedAt = ?, title = COALESCE(?, title) WHERE id = ?").run(turn.createdAt, nextSessionTitle ?? null, turn.sessionId);
    });
    transaction();
  }
  saveQueryLog(log) {
    this.db.prepare(
      `INSERT INTO query_logs (id, sessionId, question, answerJson, citationsJson, topResultsJson, createdAt, feedbackStatus, feedbackNote)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      log.id,
      log.sessionId,
      log.question,
      JSON.stringify(log.answer),
      JSON.stringify(log.citations),
      JSON.stringify(log.topResults),
      log.createdAt,
      log.feedbackStatus,
      log.feedbackNote
    );
  }
  updateQueryLogStatus(logId, status, note = null) {
    this.db.prepare("UPDATE query_logs SET feedbackStatus = ?, feedbackNote = ? WHERE id = ?").run(status, note, logId);
  }
  deleteChatSession(sessionId) {
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM chat_turns WHERE sessionId = ?").run(sessionId);
      this.db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(sessionId);
    });
    transaction();
  }
  clearChatSessions() {
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM chat_turns").run();
      this.db.prepare("DELETE FROM chat_sessions").run();
    });
    transaction();
  }
  deleteDocument(documentId) {
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM chunks WHERE documentId = ?").run(documentId);
      this.db.prepare("DELETE FROM documents WHERE id = ?").run(documentId);
    });
    transaction();
  }
  deleteDocuments(documentIds) {
    if (documentIds.length === 0) {
      return;
    }
    const transaction = this.db.transaction(() => {
      const deleteChunks = this.db.prepare("DELETE FROM chunks WHERE documentId = ?");
      const deleteDocument = this.db.prepare("DELETE FROM documents WHERE id = ?");
      for (const documentId of documentIds) {
        deleteChunks.run(documentId);
        deleteDocument.run(documentId);
      }
    });
    transaction();
  }
  upsertDocument(document, chunks) {
    const transaction = this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO documents (id, filePath, fileName, title, fileType, content, importedAt, updatedAt, sourceCreatedAt, sourceUpdatedAt, indexConfigSignature, chunkCount)
           VALUES (@id, @filePath, @fileName, @title, @fileType, @content, @importedAt, @updatedAt, @sourceCreatedAt, @sourceUpdatedAt, @indexConfigSignature, @chunkCount)
           ON CONFLICT(id) DO UPDATE SET
             filePath = excluded.filePath,
             fileName = excluded.fileName,
             title = excluded.title,
             fileType = excluded.fileType,
             content = excluded.content,
             updatedAt = excluded.updatedAt,
             sourceCreatedAt = excluded.sourceCreatedAt,
             sourceUpdatedAt = excluded.sourceUpdatedAt,
             indexConfigSignature = excluded.indexConfigSignature,
             chunkCount = excluded.chunkCount`
      ).run(document);
      this.db.prepare("DELETE FROM chunks WHERE documentId = ?").run(document.id);
      const insertChunk = this.db.prepare(
        `INSERT INTO chunks (id, documentId, text, chunkIndex, startOffset, endOffset, tokenCount, sectionTitle, sectionPath, headingTrail, pageStart, pageEnd, paragraphStart, paragraphEnd, locatorLabel, embedding)
         VALUES (@id, @documentId, @text, @chunkIndex, @startOffset, @endOffset, @tokenCount, @sectionTitle, @sectionPath, @headingTrail, @pageStart, @pageEnd, @paragraphStart, @paragraphEnd, @locatorLabel, @embedding)`
      );
      for (const chunk of chunks) {
        insertChunk.run(chunk);
      }
    });
    transaction();
  }
  clearIndex() {
    this.db.prepare("DELETE FROM chunks").run();
    this.db.prepare("UPDATE documents SET chunkCount = 0").run();
  }
  clearLibrary() {
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM chunks").run();
      this.db.prepare("DELETE FROM documents").run();
    });
    transaction();
  }
}
function createStableId(input) {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}
function formatLocatorLabel(input) {
  const { pageStart, pageEnd, paragraphStart, paragraphEnd } = input;
  const parts = [];
  if (pageStart) {
    parts.push(pageStart === pageEnd || !pageEnd ? `p.${pageStart}` : `p.${pageStart}-${pageEnd}`);
  }
  if (paragraphStart) {
    parts.push(
      paragraphStart === paragraphEnd || !paragraphEnd ? `para ${paragraphStart}` : `para ${paragraphStart}-${paragraphEnd}`
    );
  }
  return parts.length > 0 ? parts.join(" | ") : null;
}
function formatReferenceTag(input) {
  const locator = input.locatorLabel ?? `chunk ${input.chunkIndex + 1}`;
  return `[${input.fileName} | ${locator}]`;
}
function formatEvidenceAnchorLabel(input) {
  const parts = [];
  if (input.locatorLabel) {
    parts.push(input.locatorLabel);
  }
  if (input.sentenceIndex) {
    parts.push(`sent ${input.sentenceIndex}`);
  }
  return parts.length > 0 ? parts.join(" | ") : null;
}
const MARKDOWN_HEADING = /^(#{1,6})\s+(.+?)\s*$/;
function endsWithContinuationMarker(text) {
  const trimmed = text.trim();
  return /[：:([（"“]$/.test(trimmed);
}
function countTokens(text) {
  const normalized = text.trim();
  if (!normalized) {
    return 0;
  }
  const latinTokens = normalized.match(/[a-z0-9]+(?:['-][a-z0-9]+)*/giu) ?? [];
  const hanChars = normalized.match(/[\p{Script=Han}]/gu) ?? [];
  return latinTokens.length + hanChars.length;
}
function isPlainHeading(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 80) {
    return false;
  }
  if (/^#{1,6}\s/.test(trimmed) || /^(?:[>*\-•]|\d+[.)、]|[一二三四五六七八九十]+[、.])\s*/u.test(trimmed)) {
    return false;
  }
  if (/[.!?。！？]$/.test(trimmed)) {
    return false;
  }
  const words = trimmed.split(/\s+/);
  return words.length > 0 && words.length <= 8 && /^[\p{L}\p{N}\s:\-/()]+$/u.test(trimmed);
}
function splitSentences(text) {
  const matches = text.match(/[^。！？.!?\n]+[。！？.!?]?/gu);
  if (!matches) {
    return [text.trim()].filter(Boolean);
  }
  return matches.map((part) => part.trim()).filter(Boolean);
}
function isStructuredListItem(text) {
  const trimmed = text.trim();
  return /^(?:[■□●○◆◇•▪◦\-]|\d+[.)、]|[一二三四五六七八九十]+[、.])\s*/u.test(trimmed);
}
function resolvePageNumber(offset, pageSpans) {
  if (!pageSpans || pageSpans.length === 0) {
    return null;
  }
  const matched = pageSpans.find((page) => offset >= page.startOffset && offset < page.endOffset);
  if (matched) {
    return matched.pageNumber;
  }
  if (offset >= (pageSpans.at(-1)?.endOffset ?? 0)) {
    return pageSpans.at(-1)?.pageNumber ?? null;
  }
  return pageSpans[0]?.pageNumber ?? null;
}
function splitOversizedUnit(unit, maxTokens, pageSpans) {
  if (unit.tokenCount <= maxTokens) {
    return [unit];
  }
  const sentences = splitSentences(unit.text);
  if (sentences.length <= 1) {
    return [unit];
  }
  const result = [];
  let buffer = "";
  let bufferStart = unit.startOffset;
  let searchCursor = unit.startOffset;
  for (const sentence of sentences) {
    const nextText = buffer ? `${buffer} ${sentence}` : sentence;
    if (countTokens(nextText) > maxTokens && buffer) {
      result.push({
        ...unit,
        text: buffer,
        startOffset: bufferStart,
        endOffset: bufferStart + buffer.length,
        tokenCount: countTokens(buffer),
        pageStart: resolvePageNumber(bufferStart, pageSpans),
        pageEnd: resolvePageNumber(bufferStart + buffer.length, pageSpans)
      });
      buffer = sentence;
      const sentenceIndex = unit.text.indexOf(sentence, Math.max(0, searchCursor - unit.startOffset));
      bufferStart = sentenceIndex >= 0 ? unit.startOffset + sentenceIndex : searchCursor;
      searchCursor = bufferStart + sentence.length;
    } else {
      if (!buffer) {
        const sentenceIndex = unit.text.indexOf(sentence, Math.max(0, searchCursor - unit.startOffset));
        bufferStart = sentenceIndex >= 0 ? unit.startOffset + sentenceIndex : searchCursor;
      }
      buffer = nextText;
      searchCursor = bufferStart + buffer.length;
    }
  }
  if (buffer) {
    result.push({
      ...unit,
      text: buffer,
      startOffset: bufferStart,
      endOffset: bufferStart + buffer.length,
      tokenCount: countTokens(buffer),
      pageStart: resolvePageNumber(bufferStart, pageSpans),
      pageEnd: resolvePageNumber(bufferStart + buffer.length, pageSpans)
    });
  }
  return result;
}
function buildUnits(text, pageSpans) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }
  const blocks = normalized.split(/\n{2,}/);
  const units = [];
  let sectionPath = [];
  let searchOffset = 0;
  for (const rawBlock of blocks) {
    const block = rawBlock.trim();
    if (!block) {
      continue;
    }
    const headingMatch = block.match(MARKDOWN_HEADING);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const heading = headingMatch[2].trim();
      sectionPath = [...sectionPath.slice(0, Math.max(0, level - 1)), heading];
      searchOffset = normalized.indexOf(block, searchOffset) + block.length;
      continue;
    }
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const firstLineHeadingMatch = lines[0]?.match(MARKDOWN_HEADING);
    if (firstLineHeadingMatch) {
      const level = firstLineHeadingMatch[1].length;
      const heading = firstLineHeadingMatch[2].trim();
      sectionPath = [...sectionPath.slice(0, Math.max(0, level - 1)), heading];
      const body = lines.slice(1).join(" ").trim();
      const blockIndex2 = normalized.indexOf(block, searchOffset);
      if (!body) {
        searchOffset = Math.max(searchOffset, blockIndex2 + block.length);
        continue;
      }
      const bodyIndex = normalized.indexOf(body, Math.max(searchOffset, blockIndex2));
      units.push({
        text: body,
        startOffset: bodyIndex >= 0 ? bodyIndex : Math.max(0, blockIndex2),
        endOffset: (bodyIndex >= 0 ? bodyIndex : Math.max(0, blockIndex2)) + body.length,
        sectionTitle: heading,
        sectionPath: [...sectionPath],
        tokenCount: countTokens(body),
        kind: isStructuredListItem(body) ? "list_item" : "paragraph",
        paragraphIndex: 0,
        pageStart: null,
        pageEnd: null
      });
      searchOffset = Math.max(searchOffset, blockIndex2 + block.length);
      continue;
    }
    if (lines.length > 1 && isPlainHeading(lines[0])) {
      const heading = lines[0];
      sectionPath = [heading];
      const body = lines.slice(1).join(" ").trim();
      if (!body) {
        searchOffset = normalized.indexOf(block, searchOffset) + block.length;
        continue;
      }
      const blockIndex2 = normalized.indexOf(block, searchOffset);
      const bodyIndex = normalized.indexOf(body, Math.max(searchOffset, blockIndex2));
      units.push({
        text: body,
        startOffset: bodyIndex >= 0 ? bodyIndex : Math.max(0, blockIndex2),
        endOffset: (bodyIndex >= 0 ? bodyIndex : Math.max(0, blockIndex2)) + body.length,
        sectionTitle: heading,
        sectionPath: [...sectionPath],
        tokenCount: countTokens(body),
        kind: isStructuredListItem(body) ? "list_item" : "paragraph",
        paragraphIndex: 0,
        pageStart: null,
        pageEnd: null
      });
      searchOffset = Math.max(searchOffset, blockIndex2 + block.length);
      continue;
    }
    const blockIndex = normalized.indexOf(block, searchOffset);
    units.push({
      text: lines.join(" "),
      startOffset: blockIndex >= 0 ? blockIndex : searchOffset,
      endOffset: (blockIndex >= 0 ? blockIndex : searchOffset) + lines.join(" ").length,
      sectionTitle: sectionPath.at(-1) ?? null,
      sectionPath: [...sectionPath],
      tokenCount: countTokens(lines.join(" ")),
      kind: isStructuredListItem(lines.join(" ")) ? "list_item" : "paragraph",
      paragraphIndex: 0,
      pageStart: null,
      pageEnd: null
    });
    searchOffset = Math.max(searchOffset, (blockIndex >= 0 ? blockIndex : searchOffset) + block.length);
  }
  return units.map((unit, index) => ({
    ...unit,
    paragraphIndex: index + 1,
    pageStart: resolvePageNumber(unit.startOffset, pageSpans),
    pageEnd: resolvePageNumber(unit.endOffset, pageSpans)
  }));
}
function chunkText(documentId, text, options) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }
  const rawUnits = buildUnits(normalized, options.pageSpans);
  const units = rawUnits.flatMap((unit) => splitOversizedUnit(unit, Math.max(40, options.chunkSize), options.pageSpans));
  const chunks = [];
  let chunkIndex = 0;
  let cursor = 0;
  while (cursor < units.length) {
    let tokenTotal = 0;
    let endCursor = cursor;
    while (endCursor < units.length) {
      const candidate = units[endCursor];
      if (!candidate) {
        break;
      }
      const nextTotal = tokenTotal + candidate.tokenCount;
      const currentChunkText = units.slice(cursor, endCursor).map((unit) => unit.text).join("\n\n");
      const previousCandidate = endCursor > cursor ? units[endCursor - 1] : null;
      const hasLeadInContinuation = endsWithContinuationMarker(currentChunkText);
      const crossesSectionBoundary = tokenTotal > 0 && previousCandidate?.sectionPath.join(" > ") !== candidate.sectionPath.join(" > ") && tokenTotal >= Math.round(options.chunkSize * 0.3);
      const continuationUpperBound = hasLeadInContinuation ? Math.round(options.chunkSize * 2.8) : Math.round(options.chunkSize * 1.35);
      const shouldKeepIndependentListItemsSeparate = tokenTotal > 0 && previousCandidate?.kind === "list_item" && candidate.kind === "list_item" && tokenTotal >= Math.round(options.chunkSize * 0.28);
      const shouldForceContinuation = tokenTotal > 0 && nextTotal <= continuationUpperBound && !shouldKeepIndependentListItemsSeparate && (hasLeadInContinuation || tokenTotal < Math.round(options.chunkSize * 0.55) && candidate.tokenCount < Math.round(options.chunkSize * 0.7));
      if (crossesSectionBoundary || shouldKeepIndependentListItemsSeparate || tokenTotal > 0 && nextTotal > options.chunkSize && !shouldForceContinuation) {
        break;
      }
      tokenTotal = nextTotal;
      endCursor += 1;
    }
    if (endCursor === cursor) {
      endCursor += 1;
      tokenTotal = units[cursor]?.tokenCount ?? 0;
    }
    const chunkUnits = units.slice(cursor, endCursor);
    const textValue = chunkUnits.map((unit) => unit.text).join("\n\n");
    const firstUnit = chunkUnits[0];
    const lastUnit = chunkUnits.at(-1);
    const sectionTitle = [...chunkUnits.map((unit) => unit.sectionTitle).filter(Boolean)][0] ?? null;
    const sectionPath = chunkUnits.flatMap((unit) => unit.sectionPath).filter((value, index, array) => value && array.indexOf(value) === index).join(" > ") || null;
    const pageStart = chunkUnits.find((unit) => unit.pageStart !== null)?.pageStart ?? null;
    const pageEnd = [...chunkUnits].reverse().find((unit) => unit.pageEnd !== null)?.pageEnd ?? pageStart;
    const paragraphStart = firstUnit?.paragraphIndex ?? null;
    const paragraphEnd = lastUnit?.paragraphIndex ?? paragraphStart;
    chunks.push({
      id: createStableId(`${documentId}:${chunkIndex}:${textValue}`),
      documentId,
      text: textValue,
      chunkIndex,
      startOffset: firstUnit?.startOffset ?? 0,
      endOffset: lastUnit?.endOffset ?? firstUnit?.endOffset ?? 0,
      tokenCount: tokenTotal,
      sectionTitle,
      sectionPath,
      headingTrail: sectionPath,
      pageStart,
      pageEnd,
      paragraphStart,
      paragraphEnd,
      locatorLabel: formatLocatorLabel({ pageStart, pageEnd, paragraphStart, paragraphEnd })
    });
    if (endCursor >= units.length) {
      break;
    }
    let overlapTokens = 0;
    let nextCursor = endCursor;
    while (nextCursor > cursor && overlapTokens < options.chunkOverlap) {
      nextCursor -= 1;
      overlapTokens += units[nextCursor]?.tokenCount ?? 0;
    }
    cursor = Math.max(cursor + 1, nextCursor);
    chunkIndex += 1;
  }
  return chunks;
}
const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const PACKAGED_MODEL_CACHE_SEGMENTS = ["node_modules", "@huggingface", "transformers", ".cache", ...MODEL_ID.split("/")];
let embedderPromise = null;
let startupError = null;
async function getFsModelRoot() {
  try {
    const { app: app2 } = await import("electron");
    const userDataPath = app2?.getPath("userData");
    if (userDataPath) {
      return path.join(userDataPath, "models", "transformers");
    }
  } catch {
  }
  return path.join(process.cwd(), ".cache", "transformers");
}
function getPackagedCachePath() {
  if (!process.resourcesPath) {
    return null;
  }
  return path.join(process.resourcesPath, "app.asar", ...PACKAGED_MODEL_CACHE_SEGMENTS);
}
async function pathExists(targetPath) {
  try {
    await fs$1.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
async function ensurePackagedModelAvailable(targetRoot) {
  const packagedModelPath = getPackagedCachePath();
  if (!packagedModelPath) {
    return false;
  }
  const targetModelPath = path.join(targetRoot, ...MODEL_ID.split("/"));
  if (await pathExists(targetModelPath)) {
    return true;
  }
  if (!await pathExists(packagedModelPath)) {
    return false;
  }
  await fs$1.mkdir(path.dirname(targetModelPath), { recursive: true });
  await fs$1.cp(packagedModelPath, targetModelPath, { recursive: true });
  return true;
}
async function configureTransformersRuntime(transformers) {
  const modelRoot = await getFsModelRoot();
  await fs$1.mkdir(modelRoot, { recursive: true });
  const hasBundledModel = await ensurePackagedModelAvailable(modelRoot);
  const hasLocalModel = hasBundledModel || await pathExists(path.join(modelRoot, ...MODEL_ID.split("/")));
  transformers.env.useFSCache = true;
  transformers.env.cacheDir = modelRoot;
  transformers.env.localModelPath = modelRoot;
  transformers.env.allowLocalModels = true;
  transformers.env.allowRemoteModels = !hasLocalModel;
}
function toVector(data) {
  return Array.from(data);
}
async function getEmbeddingStatus() {
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
async function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      try {
        const transformers = await import("@huggingface/transformers");
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
async function embedTexts(texts) {
  if (texts.length === 0) {
    return [];
  }
  const embedder = await getEmbedder();
  const vectors = [];
  for (const text of texts) {
    const output = await embedder(text, {
      pooling: "mean",
      normalize: true
    });
    vectors.push(toVector(output.data));
  }
  return vectors;
}
function cosineSimilarity$1(left, right) {
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
const STOP_WORDS = /* @__PURE__ */ new Set([
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
function unique(items) {
  return [...new Set(items)];
}
function normalizeInput(input) {
  return input.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
function scriptSegments(input) {
  return input.match(/[\p{Script=Han}]+|[a-z0-9]+/gu) ?? [];
}
function compactNgrams(input) {
  const compact = input.replace(/\s+/g, "");
  const tokens = [];
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
function chineseCharacterTokens(input) {
  const matches = scriptSegments(input).filter((segment) => /[\p{Script=Han}]/u.test(segment));
  const tokens = [];
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
function latinAndNumberTokens(input) {
  return scriptSegments(input).filter((token) => token && !STOP_WORDS.has(token));
}
function tokenize(input) {
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
function hasReliableEvidence(question, results) {
  const top = results[0];
  if (!top) {
    return false;
  }
  if (top.qualityScore < -0.2) {
    return false;
  }
  if (top.score < 1.2) {
    return false;
  }
  if (top.lexicalScore < 0.4 && top.semanticScore < 0.45 && top.rerankScore < 0.9) {
    return false;
  }
  const topText = `${top.documentTitle}
${top.sectionTitle ?? ""}
${top.sectionPath ?? ""}
${top.text}`;
  const sentenceLike = (topText.match(/[。！？.!?]/g) ?? []).length;
  const codeDensity = (topText.match(/[A-Z0-9-]/g) ?? []).length / Math.max(1, topText.length);
  if (sentenceLike === 0 && codeDensity > 0.18) {
    return false;
  }
  return true;
}
function normalizeSentence(text) {
  return text.replace(/\s+/g, " ").replace(/^[>\-•*\d.、)\]\s]+/u, "").replace(/^#+\s*/u, "").replace(/\s+\[(.+?)#(\d+)\]$/, "").trim();
}
function splitSentenceLike$1(text) {
  const matches = text.match(/[^。！？.!?\n]+[。！？.!?]?/gu);
  if (!matches) {
    return [text.trim()].filter(Boolean);
  }
  return matches.map((part) => part.trim()).filter(Boolean);
}
function sentenceMatchScore$1(sentence, question) {
  const normalizedSentence = sentence.toLowerCase();
  const queryTokens = tokenize(question).filter((token) => token.length >= 2);
  const tokenMatches = queryTokens.filter((token) => normalizedSentence.includes(token.toLowerCase())).length;
  const tokenCoverage = queryTokens.length > 0 ? tokenMatches / queryTokens.length : 0;
  const exactPhrase = normalizedSentence.includes(question.trim().toLowerCase()) ? 1 : 0;
  const semanticHint = /如何|怎么|步骤|方式|方法|通过|用于|可以|可在|选择|设置|启用|禁用|通信|通讯|配置/.test(sentence) ? 0.35 : 0;
  return tokenCoverage * 2.2 + exactPhrase * 1.4 + semanticHint;
}
function bestMatchingSentence(text, question) {
  const candidates = splitSentenceLike$1(text).map((sentence) => normalizeSentence(sentence)).filter(isUsableSupportingSentence).map((sentence) => ({
    sentence,
    score: sentenceMatchScore$1(sentence, question)
  })).sort((left, right) => right.score - left.score);
  return candidates[0]?.sentence ?? null;
}
function selectEvidenceResults(results) {
  const top = results[0];
  if (!top) {
    return [];
  }
  const second = results[1];
  if (!second || second.score < top.score * 0.84 || second.qualityScore < top.qualityScore - 0.35) {
    return [top];
  }
  const topScore = top.score;
  const topQuality = top.qualityScore;
  const selected = results.filter((result, index) => {
    if (index === 0) {
      return true;
    }
    if (result.score < topScore * 0.84) {
      return false;
    }
    if (result.qualityScore < Math.min(0.2, topQuality - 0.35)) {
      return false;
    }
    const hasComparableSignal = result.semanticScore >= Math.max(0.28, top.semanticScore * 0.55) || result.lexicalScore >= Math.max(0.55, top.lexicalScore * 0.45) || result.rerankScore >= Math.max(0.95, top.rerankScore * 0.72);
    return hasComparableSignal;
  });
  const perDocumentCount = /* @__PURE__ */ new Map();
  return selected.filter((result) => {
    const count = perDocumentCount.get(result.documentId) ?? 0;
    if (count >= 2) {
      return false;
    }
    perDocumentCount.set(result.documentId, count + 1);
    return true;
  }).slice(0, 4);
}
function splitIntoCandidateLines(text) {
  return text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
}
function splitLineIntoSentences(line) {
  return splitSentenceLike$1(line).map((part) => normalizeSentence(part)).filter((part) => part.length > 20);
}
function extractCandidateSentences(text) {
  return splitIntoCandidateLines(text).flatMap((line) => splitLineIntoSentences(line));
}
function isUsableSupportingSentence(text) {
  const normalized = normalizeSentence(text);
  if (normalized.length < 24) {
    return false;
  }
  if (/^\d+\.?$/.test(normalized)) {
    return false;
  }
  if (/^[#>*-]/.test(normalized)) {
    return false;
  }
  if (/[：:]$/.test(normalized)) {
    return false;
  }
  if (/[：:]\s*\d+\.?\s*$/u.test(normalized)) {
    return false;
  }
  if (/^\d+[.)、]\s*/u.test(normalized)) {
    return false;
  }
  if (/^[一二三四五六七八九十]+[、.]\s*/u.test(normalized)) {
    return false;
  }
  if (/[（(][^)）]*$/.test(normalized)) {
    return false;
  }
  const hasSentenceEnding = /[.!?。！？]$/.test(normalized);
  const isLongEnough = normalized.length >= 32;
  return hasSentenceEnding || isLongEnough;
}
function selectSupportingSentences(results, question) {
  const seen = /* @__PURE__ */ new Set();
  const sentences = results.flatMap(
    (result) => extractCandidateSentences(result.text).map((sentence) => ({
      sentence: normalizeSentence(sentence),
      score: result.score + sentenceMatchScore$1(sentence, question),
      fileName: result.fileName,
      chunkIndex: result.chunkIndex,
      locatorLabel: result.locatorLabel
    }))
  );
  return sentences.sort((left, right) => right.score - left.score).filter((item) => {
    const normalized = item.sentence.toLowerCase();
    if (!isUsableSupportingSentence(item.sentence) || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  }).slice(0, 4).map((item) => `${item.sentence} ${formatReferenceTag(item)}`);
}
function buildDirectAnswer(question, results) {
  const top = results[0];
  if (!top) {
    return "I could not find grounded evidence for that question in the current library.";
  }
  const leadingSentence = top.evidenceText ?? bestMatchingSentence(top.text, question) ?? top.snippet;
  const sourceCount = new Set(results.map((result) => result.documentId)).size;
  const recencyLabel = top.sourceUpdatedAt ? ` Updated ${new Date(top.sourceUpdatedAt).toLocaleDateString()}.` : "";
  if (sourceCount === 1) {
    return `${leadingSentence} This answer is primarily grounded in ${top.documentTitle}.${recencyLabel}`.trim();
  }
  return `${leadingSentence} The strongest supporting evidence comes from ${sourceCount} documents, led by ${top.documentTitle}.${recencyLabel}`.trim();
}
function fallbackSupportingPoint(result) {
  const cleaned = normalizeSentence(result.evidenceText ?? result.snippet);
  if (isUsableSupportingSentence(cleaned)) {
    return `${cleaned} ${formatReferenceTag(result)}`;
  }
  const section = result.sectionTitle ? `${result.sectionTitle}: ` : "";
  return `${section}${result.documentTitle} contains relevant material for this answer. ${formatReferenceTag(result)}`;
}
function answerQuestion(question, results) {
  if (results.length === 0 || !hasReliableEvidence(question, results)) {
    const fallback = "I could not find grounded evidence for that question in the current library. Try importing more files or rephrasing the question.";
    return {
      answer: fallback,
      directAnswer: fallback,
      supportingPoints: [],
      sourceDocumentCount: 0,
      basedOnSingleDocument: false,
      citations: []
    };
  }
  const evidenceResults = selectEvidenceResults(results);
  const finalResults = evidenceResults.length > 0 ? evidenceResults : [results[0]];
  const sourceDocumentCount = new Set(finalResults.map((result) => result.documentId)).size;
  const basedOnSingleDocument = sourceDocumentCount === 1;
  const directAnswer = buildDirectAnswer(question, finalResults);
  const extractedPoints = selectSupportingSentences(finalResults, question);
  const supportingPoints = extractedPoints.length >= 2 ? extractedPoints.slice(0, 3) : finalResults.slice(0, 3).map((result) => fallbackSupportingPoint(result));
  const answer = [
    "Direct answer",
    directAnswer,
    "",
    "Key supporting points",
    ...supportingPoints.map((point, index) => `${index + 1}. ${point}`),
    "",
    basedOnSingleDocument ? "Evidence base: this answer is currently grounded in a single document." : `Evidence base: this answer is grounded in ${sourceDocumentCount} documents.`,
    "",
    "Citations are listed separately below for inspection."
  ].join("\n");
  return {
    answer,
    directAnswer,
    supportingPoints,
    sourceDocumentCount,
    basedOnSingleDocument,
    citations: finalResults.map(({ text: _text, lexicalScore: _lexicalScore, semanticScore: _semanticScore, freshnessScore: _freshnessScore, rerankScore: _rerankScore, qualityScore: _qualityScore, ...citation }) => citation)
  };
}
function getSupportedFileType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".pdf") return "pdf";
  if (extension === ".md") return "md";
  if (extension === ".txt") return "txt";
  if (extension === ".docx") return "docx";
  return null;
}
async function renderPdfPage(pageData) {
  const textContent = await pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false
  });
  let lastY;
  let text = "";
  for (const item of textContent.items) {
    if (lastY === item.transform[5] || lastY === void 0) {
      text += item.str;
    } else {
      text += `
${item.str}`;
    }
    lastY = item.transform[5];
  }
  return text;
}
function buildPageSpans(pages) {
  let content = "";
  const pageSpans = [];
  pages.forEach((pageText, index) => {
    const prefix = content ? "\n\n" : "";
    const startOffset = content.length + prefix.length;
    content += `${prefix}${pageText}`;
    pageSpans.push({
      pageNumber: index + 1,
      startOffset,
      endOffset: content.length
    });
  });
  return { content, pageSpans };
}
async function parsePdf(filePath) {
  const buffer = await fs$1.readFile(filePath);
  const rawPages = [];
  await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const pageText = await renderPdfPage(pageData);
      rawPages.push(pageText);
      return pageText;
    }
  });
  const cleanedPages = rawPages.map((pageText) => cleanPdfText(pageText));
  return buildPageSpans(cleanedPages);
}
function isPdfHeading(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 90) {
    return false;
  }
  const hasHan = /[\p{Script=Han}]/u.test(trimmed);
  if (/^第[一二三四五六七八九十0-9]+[章节篇部分]\s*[:：]?\s*.+$/.test(trimmed)) {
    return true;
  }
  if (hasHan && /^\d+(?:\.\d+){0,3}\s+[^\n]{2,80}$/.test(trimmed) && !/[。！？.!?]$/.test(trimmed) && !/\b(?:kb|mb|gb|rpm|hz|mhz|ghz|ms)\b/i.test(trimmed)) {
    return true;
  }
  if (/^[一二三四五六七八九十]+[、.]\s*[^\n]{2,40}$/.test(trimmed) && !/[。！？.!?]$/.test(trimmed)) {
    return true;
  }
  return false;
}
function headingLevel(line) {
  const trimmed = line.trim();
  if (/^第[一二三四五六七八九十0-9]+[章节篇部分]/.test(trimmed)) {
    return 1;
  }
  const numberedMatch = trimmed.match(/^(\d+(?:\.\d+){0,3})\s+/);
  if (numberedMatch) {
    return Math.min(4, numberedMatch[1].split(".").length);
  }
  return 2;
}
function convertPdfHeading(line) {
  return `${"#".repeat(headingLevel(line))} ${line.trim()}`;
}
function isBulletLine(line) {
  return /^[■□●○◆◇•▪◦\-]\s+/.test(line.trim());
}
function isTableLikeLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  return trimmed.includes(" | ") || /^\|.+\|$/.test(trimmed);
}
function shouldJoinKeyValueContinuation(previous, current) {
  if (!previous) {
    return false;
  }
  if (isPdfHeading(previous) || isPdfHeading(current) || isTableLikeLine(previous) || isTableLikeLine(current)) {
    return false;
  }
  if (!/[：:]$/.test(previous.trim())) {
    return false;
  }
  return current.trim().length > 0 && current.trim().length <= 160;
}
function isWrappedContinuation(previous, current) {
  if (!previous) {
    return false;
  }
  if (/^#+\s/.test(previous) || isPdfHeading(previous) || isPdfHeading(current) || isBulletLine(current) || isTableLikeLine(previous) || isTableLikeLine(current)) {
    return false;
  }
  if (/^\d+[.)、]\s+/.test(current) || /^[a-z]\)/i.test(current)) {
    return false;
  }
  const previousLooksComplete = /[。！？.!?：:]$/.test(previous);
  const currentLooksLikeSentence = /[a-zA-Z\u4e00-\u9fa5]/.test(current);
  return !previousLooksComplete && currentLooksLikeSentence && previous.length < 160;
}
function cleanPdfText(text) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ");
  const lines = normalized.split("\n").flatMap(
    (line) => line.replace(/\s*([■□●○◆◇•▪◦])\s*/g, "\n$1 ").replace(/(?<!\n)((?:第[一二三四五六七八九十0-9]+[章节篇部分]|(?:\d+(?:\.\d+){1,3}))\s+(?:Q[:：]|[^\n]{2,80}))/g, "\n$1").split("\n")
  ).map((line) => line.trim()).filter((line) => {
    if (!line) {
      return false;
    }
    if (/^\d+$/.test(line)) {
      return false;
    }
    if (/^[.`·•\-_=]{4,}$/.test(line)) {
      return false;
    }
    if (/^第?\d+\s*页$/.test(line)) {
      return false;
    }
    if (/^\d+(?:\.\d+)*\s+.+\.{3,}\s*\d+$/.test(line)) {
      return false;
    }
    return true;
  });
  const merged = [];
  for (const line of lines) {
    const previous = merged.at(-1);
    const startsStructuredBlock = isBulletLine(line) || isPdfHeading(line) || /^\d+[.)、]\s+/.test(line);
    if (isPdfHeading(line)) {
      merged.push(convertPdfHeading(line));
      continue;
    }
    if (shouldJoinKeyValueContinuation(previous, line)) {
      merged[merged.length - 1] = `${previous} ${line}`.trim();
      continue;
    }
    if (previous && !startsStructuredBlock && isWrappedContinuation(previous, line)) {
      merged[merged.length - 1] = `${previous} ${line}`.trim();
      continue;
    }
    merged.push(line);
  }
  return merged.join("\n\n");
}
async function parseDocx(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return cleanStructuredText(result.value);
}
function cleanStructuredText(text) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").replace(/\t+/g, " | ").replace(/[ \t]+/g, " ").replace(/```+/g, "\n").replace(/^\s*[-*_]{3,}\s*$/gm, "\n");
  const lines = normalized.split("\n").flatMap(
    (line) => line.replace(/\s*([■□●○◆◇•▪◦])\s*/g, "\n$1 ").replace(/\s+\*\s+(?=[^\s*])/g, "\n* ").replace(/(?<!\n)(\d+[)）.、]\s*[^\n]{1,120})/g, "\n$1").replace(/(?<!\n)([一二三四五六七八九十]+[)）.、]\s*[^\n]{1,120})/g, "\n$1").replace(/(?<!\n)(第[一二三四五六七八九十0-9]+[章节篇部分]\s*[:：]?\s*[^\n]{1,80})/g, "\n$1").replace(/(?<!\n)(\d+(?:\.\d+){0,3}\s+[^\n]{2,80})/g, "\n$1").replace(/(?<!\n)([一二三四五六七八九十]+[、.]\s*[^\n]{2,60})/g, "\n$1").split("\n")
  ).map((line) => line.trim()).filter((line) => Boolean(line) && !/^[-*_]{3,}$/.test(line) && line !== "```");
  const merged = [];
  for (const line of lines) {
    if (isPdfHeading(line)) {
      merged.push(convertPdfHeading(line));
      continue;
    }
    const previous = merged.at(-1);
    if (shouldJoinKeyValueContinuation(previous, line)) {
      merged[merged.length - 1] = `${previous} ${line}`.trim();
      continue;
    }
    if (previous && isWrappedContinuation(previous, line)) {
      merged[merged.length - 1] = `${previous} ${line}`.trim();
      continue;
    }
    merged.push(line);
  }
  return merged.join("\n\n");
}
async function parseDocument(filePath) {
  const fileType = getSupportedFileType(filePath);
  if (!fileType) {
    throw new Error(`Unsupported file type for ${filePath}`);
  }
  if (fileType === "txt" || fileType === "md") {
    const content = await fs$1.readFile(filePath, "utf8");
    return { fileType, content: fileType === "txt" ? cleanStructuredText(content) : content };
  }
  if (fileType === "pdf") {
    const parsed = await parsePdf(filePath);
    return { fileType, content: parsed.content, pageSpans: parsed.pageSpans };
  }
  return { fileType, content: await parseDocx(filePath) };
}
const RECENCY_PATTERN = /\b(latest|recent|new|newest|current|today|yesterday|this year|updated|recently)\b|最新|最近|当前|新版|更新|近期/i;
const DEFINITION_PATTERN = /什么是|是什么|定义|原理|概念|区别|作用|含义|介绍|说明|what is|definition|overview|principle/i;
const PROCEDURAL_PATTERN = /如何|怎么|怎样|步骤|方式|方法|配置|设置|启用|禁用|安装|使用|打开|启动|连接|通讯|通信|导入|重建|setup|configure|install|enable|disable|connect|use/i;
const TROUBLESHOOTING_PATTERN = /无法|不能|失败|报错|错误|异常|故障|排查|修复|恢复|没反应|问题|失效|why.*fail|error|issue|troubleshoot|debug|fix/i;
const LOCATION_PATTERN = /在哪|哪里|哪一章|哪个章节|位置|路径|菜单|入口|在哪个|where|which section|which chapter|path|menu/i;
function detectQueryIntent(query) {
  const normalized = query.trim();
  const wantsRecency = RECENCY_PATTERN.test(normalized);
  const wantsDefinition = DEFINITION_PATTERN.test(normalized);
  const wantsSteps = PROCEDURAL_PATTERN.test(normalized);
  const wantsTroubleshooting = TROUBLESHOOTING_PATTERN.test(normalized);
  const wantsLocation = LOCATION_PATTERN.test(normalized);
  let primary = "general";
  if (wantsTroubleshooting) {
    primary = "troubleshooting";
  } else if (wantsSteps) {
    primary = "procedural";
  } else if (wantsDefinition) {
    primary = "explanatory";
  } else if (wantsLocation) {
    primary = "navigational";
  }
  return {
    primary,
    wantsRecency,
    wantsSteps,
    wantsDefinition,
    wantsTroubleshooting,
    wantsLocation,
    queryTokens: tokenize(normalized)
  };
}
function isGenericQueryToken(token) {
  const genericPrefixes = ["如何", "怎么", "怎样", "请问", "请教", "为什么", "为何"];
  const genericSuffixes = ["啊", "呀", "吗", "呢", "一下"];
  const genericStandalone = ["解决", "处理", "方法", "办法", "问题", "教程"];
  if (genericStandalone.includes(token)) {
    return true;
  }
  if (genericPrefixes.some((prefix) => token.startsWith(prefix) && token.length <= prefix.length + 2)) {
    return true;
  }
  if (genericSuffixes.some((suffix) => token.endsWith(suffix) && token.length <= suffix.length + 3)) {
    return true;
  }
  return false;
}
function anchorScore(token) {
  const hasHan = /[\p{Script=Han}]/u.test(token);
  const hasLatinOrNumber = /[a-z0-9]/i.test(token);
  if (hasHan && hasLatinOrNumber) {
    return 10;
  }
  if (hasHan && token.length >= 2 && token.length <= 3) {
    return 8;
  }
  if (hasLatinOrNumber && token.length >= 2) {
    return 7;
  }
  if (hasHan && token.length === 4) {
    return 4;
  }
  return 1;
}
function isUsefulAnchorToken(token) {
  const hasHan = /[\p{Script=Han}]/u.test(token);
  const hasLatinOrNumber = /[a-z0-9]/i.test(token);
  if (hasHan && hasLatinOrNumber) {
    return /^[a-z0-9]{1,6}[\p{Script=Han}]{1,2}$|^[\p{Script=Han}]{1,2}[a-z0-9]{1,6}$/iu.test(token);
  }
  if (hasLatinOrNumber) {
    return token.length >= 2;
  }
  if (!hasHan || token.length < 2 || token.length > 3) {
    return false;
  }
  if (/^[何怎如请为啥那这哪]/u.test(token) || /[啊呀吗呢吧嘛]$/u.test(token)) {
    return false;
  }
  if (["如何", "怎么", "怎样", "请问", "为何", "为啥"].some((prefix) => token.startsWith(prefix))) {
    return false;
  }
  return true;
}
function selectAnchorTokens(queryTokens) {
  return [...queryTokens].filter((token, index, array) => {
    if (token.length < 2 || array.indexOf(token) !== index || isGenericQueryToken(token)) {
      return false;
    }
    if (!isUsefulAnchorToken(token)) {
      return false;
    }
    if (/^[\p{Script=Han}]+$/u.test(token) && token.length > 4) {
      return false;
    }
    return true;
  }).sort((left, right) => {
    const scoreGap = anchorScore(right) - anchorScore(left);
    if (scoreGap !== 0) {
      return scoreGap;
    }
    return right.length - left.length;
  }).slice(0, 5);
}
function isRoleQuestion(query) {
  return /(作用|用途|干什么|做什么|有什么用|用来做什么)/.test(query);
}
function isWhyQuestion(query) {
  return /(为什么|为何|原因|为啥|why)/i.test(query);
}
function isFlowQuestion(query) {
  return /(流程|步骤|过程|顺序|链路|怎么做|如何做|怎样做)/.test(query);
}
function isGoalQuestion(query) {
  return /(目标|目的|想达到什么|要达到什么)/.test(query);
}
function expandQueryTokens(query, intent) {
  const expansions = [];
  if (intent.wantsDefinition && isRoleQuestion(query)) {
    expansions.push("用于", "功能", "负责", "实现", "完成");
  }
  if (intent.wantsSteps && /(如何|怎么|怎样)/.test(query)) {
    expansions.push("步骤", "配置", "连接", "设置");
  }
  if (isFlowQuestion(query)) {
    expansions.push("流程", "步骤", "首先", "然后", "最后", "依次");
  }
  if (isWhyQuestion(query)) {
    expansions.push("因为", "由于", "原因", "因此", "从而", "取决于");
  }
  if (isGoalQuestion(query)) {
    expansions.push("目标", "目的");
  }
  return expansions;
}
function maxConsecutiveTokenMatch(queryTokens, contextText) {
  let maxMatch = 0;
  const normalizedText = contextText.toLowerCase();
  for (const token of queryTokens) {
    if (normalizedText.includes(token.toLowerCase())) {
      maxMatch = Math.max(maxMatch, token.length);
    }
  }
  return maxMatch;
}
function termFrequency(tokens) {
  const counts = /* @__PURE__ */ new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}
function charNgrams(input, n = 3) {
  const normalized = input.toLowerCase().replace(/\s+/g, " ").trim();
  const grams = /* @__PURE__ */ new Map();
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
function cosineSimilarity(left, right) {
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
function jaccardSimilarity(left, right) {
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
function phraseBoost(query, text) {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedText = text.toLowerCase();
  if (!normalizedQuery) {
    return 0;
  }
  if (normalizedText.includes(normalizedQuery)) {
    return 1.5;
  }
  const queryParts = normalizedQuery.split(/\s+/).filter(Boolean);
  if (queryParts.length >= 2 && queryParts.every((part) => normalizedText.includes(part))) {
    return 0.8;
  }
  return 0;
}
function mismatchPenalty(query, text) {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedText = text.toLowerCase();
  let penalty = 0;
  if (/无关|不相关/.test(normalizedText)) {
    penalty += 1.6;
  }
  if (/只是提到|顺带提到|仅提到|提到过/.test(normalizedText)) {
    penalty += 0.6;
  }
  if (/没有解释|未解释|并没有解释|不是在解释|并非.*解释/.test(normalizedText)) {
    penalty += 1;
  }
  if (/(什么是|本质|定义|原理)/.test(normalizedQuery) && /没有解释|未解释|无关/.test(normalizedText)) {
    penalty += 0.8;
  }
  return penalty;
}
function intentMismatchPenalty(intent, chunk, document, evidenceText) {
  const metadata = [document.title, chunk.sectionTitle, chunk.sectionPath, evidenceText].filter(Boolean).join(" ").toLowerCase();
  let penalty = 0;
  if (intent.wantsDefinition && /安装|步骤|下一步|单击|点击|勾选|启动安装向导|安装内容|installation|step|click|select/i.test(metadata)) {
    penalty += 1.2;
  }
  if (intent.wantsLocation && /原理|定义|概述|介绍|软件介绍|功能介绍|principle|definition|overview/i.test(metadata)) {
    penalty += 0.45;
  }
  if (intent.wantsSteps && /名词缩写|概述|简介|文档用途|阅读对象|定义|缩写|introduction|overview/i.test(metadata)) {
    penalty += 0.55;
  }
  if (intent.wantsTroubleshooting && /介绍|概述|安装内容|软件介绍|system intro|overview/i.test(metadata)) {
    penalty += 0.4;
  }
  return penalty;
}
function roleAnswerBoost(query, evidenceText, chunk, document) {
  if (!isRoleQuestion(query)) {
    return 0;
  }
  const metadata = [document.title, chunk.sectionTitle, chunk.sectionPath].filter(Boolean).join(" ");
  const hasRoleVerb = /(用于|用来|负责|完成|实现|作用是)/.test(evidenceText);
  let boost = 0;
  if (hasRoleVerb) {
    boost += 3;
  }
  if (/(系统组成|功能介绍|软件介绍|说明|概述)/.test(metadata)) {
    boost += 1.2;
  }
  if (/(安装|步骤|下一步|安装内容)/.test(metadata)) {
    boost -= 1.2;
  }
  if (!hasRoleVerb && /(安装|下一步|单击|点击|勾选|启动安装向导|安装完成)/.test(`${metadata} ${evidenceText}`)) {
    boost -= 3;
  }
  return boost;
}
function chunkQualityScore(text, chunk, document) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return -2;
  }
  const length = normalized.length;
  const sentenceCount = (normalized.match(/[。！？.!?]/g) ?? []).length;
  const codeLikeCount = (normalized.match(/\b[A-Z]{2,}(?:[-_/]?[A-Z0-9]+)+\b/g) ?? []).length;
  const dotLeaderCount = (normalized.match(/\.{4,}|…{2,}|-{4,}|_{4,}/g) ?? []).length;
  const statusIndicatorCount = (normalized.match(/[■□●○◆◇]/g) ?? []).length;
  const digitCount = (normalized.match(/\d/g) ?? []).length;
  const uppercaseCount = (normalized.match(/[A-Z]/g) ?? []).length;
  const lineCount = text.split(/\n+/).filter(Boolean).length;
  const sectionText = [document.title, chunk.sectionTitle, chunk.sectionPath].filter(Boolean).join(" ");
  const hasExplanatorySection = /定义|概述|说明|介绍|步骤|方法|配置|启用|恢复|处理|排查|故障|用法|安装|设置|总结|原则/i.test(sectionText);
  const hasToCSignal = /目录|文档更新|阅读对象|第\d+章/.test(normalized) && dotLeaderCount > 0;
  const hasSentenceLikeClause = /[是为可会能需应将用于通过如果先再然后因此所以]/.test(normalized);
  let score = 0;
  if (sentenceCount >= 1) {
    score += 0.7;
  }
  if (sentenceCount >= 2) {
    score += 0.4;
  }
  if (hasSentenceLikeClause) {
    score += 0.35;
  }
  if (hasExplanatorySection) {
    score += 0.45;
  }
  if (lineCount <= 4 && length >= 30) {
    score += 0.15;
  }
  score -= Math.min(1.2, codeLikeCount * 0.22);
  score -= Math.min(0.9, dotLeaderCount * 0.6);
  score -= Math.min(0.7, statusIndicatorCount * 0.2);
  score -= Math.min(0.8, digitCount / Math.max(1, length) * 6);
  score -= Math.min(0.7, uppercaseCount / Math.max(1, length) * 10);
  if (hasToCSignal) {
    score -= 1.4;
  }
  if (length < 24) {
    score -= 0.4;
  }
  return Math.max(-2, Math.min(2, score));
}
function titleBoost(query, document, chunk) {
  const haystack = [document.title, chunk.sectionTitle, chunk.sectionPath].filter(Boolean).join(" ").toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery || !haystack) {
    return 0;
  }
  if (haystack.includes(normalizedQuery)) {
    return 2;
  }
  return 0;
}
function intentSectionBoost(intent, chunk, document) {
  const metadata = [document.title, chunk.sectionTitle, chunk.sectionPath].filter(Boolean).join(" ").toLowerCase();
  let boost = 0;
  if (intent.wantsDefinition && /定义|概述|说明|介绍|原理|简介|系统组成|功能介绍|软件介绍|overview|definition|principle/i.test(metadata)) {
    boost += 1.15;
  }
  if (intent.wantsSteps && /步骤|流程|方法|配置|设置|安装|启用|禁用|通讯|通信|使用|procedure|steps|setup|install|configure/i.test(metadata)) {
    boost += 0.9;
  }
  if (intent.wantsTroubleshooting && /故障|排查|恢复|异常|错误|问题|troubleshoot|recovery|error|issue/i.test(metadata)) {
    boost += 1;
  }
  if (intent.wantsLocation && /菜单|路径|界面|导航|章节|位置|menu|path|section|chapter/i.test(metadata)) {
    boost += 0.7;
  }
  return boost;
}
function sentenceIntentBoost(sentence, intent) {
  const normalized = sentence.toLowerCase();
  let boost = 0;
  if (intent.wantsDefinition && /是|指|本质|用于|表示|意味着|通过|用来|用于说明|用于实现|负责|完成|实现|作用是|is |refers to|means|used to/i.test(normalized)) {
    boost += 0.95;
  }
  if (intent.wantsSteps && /点击|选择|打开|安装|运行|配置|设置|启用|禁用|执行|先|再|然后|即可|可在|需要|应当|step|click|select|open|install|configure|enable|disable/i.test(normalized)) {
    boost += 0.8;
  }
  if (intent.wantsTroubleshooting && /检查|确认|异常|故障|恢复|排查|修复|重新|失败|报错|错误|保护状态|check|error|failure|recover|troubleshoot|fix/i.test(normalized)) {
    boost += 0.85;
  }
  if (intent.wantsLocation && /菜单|路径|位于|入口|章节|section|chapter|menu|path|located/i.test(normalized)) {
    boost += 0.45;
  }
  return boost;
}
function sentenceStructureBoost(sentence, query, intent) {
  const normalized = sentence.toLowerCase();
  let boost = 0;
  if (intent.wantsDefinition && /(全称|中文通常翻译为|中文可理解为|是一种|是指|通常指|可以理解为|简称|全名|full name|stands for)/i.test(normalized)) {
    boost += 2.05;
  }
  if (intent.wantsDefinition && /(检索增强生成|retrieval-augmented generation)/i.test(normalized)) {
    boost += 1.2;
  }
  if (isFlowQuestion(query) && /(包含\d+个?主要步骤|主要步骤|完整流程|流程[:：]|步骤[:：]|首先|然后|最后|依次|↓|→|->)/i.test(normalized)) {
    boost += 1.45;
  }
  if (isWhyQuestion(query) && /(因为|由于|原因|因此|从而|取决于|这样做的目的|好处|价值在于|目的是|解决.*问题|如果存在|输出会更|更统一|更稳定|提高|降低|减少|提升|缩短|节省)/i.test(normalized)) {
    boost += 1.2;
  }
  if (isWhyQuestion(query) && /(这样做的目的|目的是|好处|价值在于)/i.test(normalized)) {
    boost += 1.35;
  }
  if (isWhyQuestion(query) && (normalized.match(/提高|降低|减少|提升|缩短|节省|更准确|更稳定/g) ?? []).length >= 2) {
    boost += 0.95;
  }
  if (isGoalQuestion(query) && /(主要目标|目标[:：]|目的是|目标是|为了)/i.test(normalized)) {
    boost += 1.15;
  }
  if (isGoalQuestion(query) && (normalized.match(/提高|降低|减少|提升|优化|稳定/g) ?? []).length >= 2) {
    boost += 0.9;
  }
  if (isRoleQuestion(query) && /(用于|用来|负责|完成|实现|作用是)/i.test(normalized)) {
    boost += 0.7;
  }
  return boost;
}
function sentenceMatchScore(sentence, query, queryTokens, anchorTokens, intent) {
  const normalized = sentence.toLowerCase();
  const tokenMatches = queryTokens.filter((token) => normalized.includes(token.toLowerCase())).length;
  const anchorMatches = anchorTokens.filter((token) => normalized.includes(token.toLowerCase())).length;
  const exactQueryMatch = normalized.includes(query.trim().toLowerCase()) ? 1 : 0;
  const coverage = queryTokens.length > 0 ? tokenMatches / queryTokens.length : 0;
  const roleQuestionBoost = isRoleQuestion(query) && /(用于|用来|负责|完成|实现|作用是)/.test(sentence) ? 1.5 : 0;
  const incompleteSpanPenalty = /[：:]$/.test(sentence.trim()) ? 0.7 : 0;
  return coverage * 2.1 + anchorMatches * 0.42 + exactQueryMatch * 1.4 + phraseBoost(query, sentence) * 0.45 + cosineSimilarity(charNgrams(query), charNgrams(sentence)) * 0.9 + sentenceIntentBoost(sentence, intent) + sentenceStructureBoost(sentence, query, intent) + roleQuestionBoost - incompleteSpanPenalty;
}
function findHighlightRange(fullText, evidenceText) {
  const normalizedEvidence = evidenceText?.trim();
  if (!normalizedEvidence) {
    return {
      highlightText: null,
      highlightStart: null,
      highlightEnd: null,
      sentenceIndex: null
    };
  }
  const directIndex = fullText.indexOf(normalizedEvidence);
  if (directIndex >= 0) {
    const sentenceIndex = findSentenceIndex(fullText, normalizedEvidence, directIndex, directIndex + normalizedEvidence.length);
    return {
      highlightText: normalizedEvidence,
      highlightStart: directIndex,
      highlightEnd: directIndex + normalizedEvidence.length,
      sentenceIndex
    };
  }
  const compactFullText = fullText.replace(/\s+/g, " ");
  const compactEvidence = normalizedEvidence.replace(/\s+/g, " ");
  const compactIndex = compactFullText.indexOf(compactEvidence);
  if (compactIndex >= 0) {
    const sentenceIndex = findSentenceIndex(fullText, normalizedEvidence, null, null);
    return {
      highlightText: compactEvidence,
      highlightStart: null,
      highlightEnd: null,
      sentenceIndex
    };
  }
  return {
    highlightText: normalizedEvidence,
    highlightStart: null,
    highlightEnd: null,
    sentenceIndex: findSentenceIndex(fullText, normalizedEvidence, null, null)
  };
}
function splitSentenceSpans(text) {
  const matches = text.matchAll(/[^。！？.!?\n]+[。！？.!?\n]?/gu);
  const spans = [];
  for (const match of matches) {
    const rawText = match[0] ?? "";
    const rawStart = match.index ?? 0;
    const leadingTrimmed = rawText.match(/^\s*/u)?.[0].length ?? 0;
    const trailingTrimmed = rawText.match(/\s*$/u)?.[0].length ?? 0;
    const trimmedText = rawText.trim();
    if (!trimmedText) {
      continue;
    }
    spans.push({
      text: trimmedText,
      start: rawStart + leadingTrimmed,
      end: rawStart + rawText.length - trailingTrimmed
    });
  }
  return spans;
}
function normalizeComparableText(text) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}
function findSentenceIndex(fullText, evidenceText, highlightStart, highlightEnd) {
  const sentenceSpans = splitSentenceSpans(fullText);
  if (sentenceSpans.length === 0) {
    return null;
  }
  if (highlightStart !== null && highlightEnd !== null) {
    const directMatchIndex = sentenceSpans.findIndex((span) => highlightStart < span.end && highlightEnd > span.start);
    if (directMatchIndex >= 0) {
      return directMatchIndex + 1;
    }
  }
  const normalizedEvidence = normalizeComparableText(evidenceText);
  if (!normalizedEvidence) {
    return null;
  }
  const fallbackIndex = sentenceSpans.findIndex((span) => {
    const normalizedSentence = normalizeComparableText(span.text);
    return normalizedSentence.includes(normalizedEvidence) || normalizedEvidence.includes(normalizedSentence);
  });
  return fallbackIndex >= 0 ? fallbackIndex + 1 : null;
}
function getDocumentTimestamp(document) {
  const candidate = document.sourceUpdatedAt ?? document.updatedAt ?? document.importedAt;
  const value = candidate ? Date.parse(candidate) : Number.NaN;
  return Number.isNaN(value) ? 0 : value;
}
function normalizeFreshness(timestamp, minTimestamp, maxTimestamp) {
  if (maxTimestamp <= minTimestamp) {
    return 0.5;
  }
  return (timestamp - minTimestamp) / (maxTimestamp - minTimestamp);
}
function getChunkContext(chunk, document) {
  return [document.title, document.fileName, chunk.sectionTitle, chunk.sectionPath, chunk.text].filter(Boolean).join("\n");
}
function splitSentenceLike(text) {
  const matches = text.match(/[^。！？.!?\n]+[。！？.!?]?/gu);
  if (!matches) {
    return [text.trim()].filter(Boolean);
  }
  return matches.map((part) => part.trim()).filter(Boolean);
}
function normalizeEvidenceLine(line) {
  return line.trim().replace(/^>+\s*/, "").replace(/^```+\s*/, "").replace(/```+$/, "").replace(/^(?:[*\-•■□●○◆◇▪◦]|\d+[.)、）]|[一二三四五六七八九十]+[.)、）])\s*/u, "").trim();
}
function isSeparatorLine(line) {
  const trimmed = line.trim();
  return !trimmed || /^[-*_]{3,}$/.test(trimmed) || /^```+$/.test(trimmed);
}
function shouldMergeEvidenceLines(current, next) {
  if (!current || !next) {
    return false;
  }
  if (/[：:]$/.test(current)) {
    return true;
  }
  if (current.length <= 12 && next.length <= 40) {
    return true;
  }
  if (/(全称|翻译为|步骤|流程|目标|目的|原因|一句话|核心思想|作用|价值|好处|例如|包括|包含)/.test(current)) {
    return true;
  }
  if (/^(?:先|再|然后|最后|首先|因为|由于|如果|通过|文档准备|文本切分|向量化|向量检索|llm)/i.test(next)) {
    return true;
  }
  return false;
}
function extractEvidenceCandidates(text) {
  const rawLines = text.replace(/\r\n/g, "\n").split(/\n+/).map((line) => line.trim());
  const lines = rawLines.filter((line) => !isSeparatorLine(line));
  const candidates = [];
  lines.forEach((line, index) => {
    const normalizedLine = normalizeEvidenceLine(line);
    if (!normalizedLine) {
      return;
    }
    candidates.push({ text: normalizedLine, index });
    const nextLine = normalizeEvidenceLine(lines[index + 1] ?? "");
    if (shouldMergeEvidenceLines(normalizedLine, nextLine)) {
      candidates.push({
        text: `${normalizedLine} ${nextLine}`.trim(),
        index
      });
      const thirdLine = normalizeEvidenceLine(lines[index + 2] ?? "");
      if (thirdLine && (/[：:]$/.test(normalizedLine) || /^(?:先|再|然后|最后|首先|\d+[.)、）])/.test(nextLine))) {
        candidates.push({
          text: `${normalizedLine} ${nextLine} ${thirdLine}`.trim(),
          index
        });
      }
    }
    splitSentenceLike(normalizedLine).filter((sentence) => sentence !== normalizedLine).forEach((sentence) => {
      candidates.push({ text: sentence, index });
    });
  });
  return candidates.filter((candidate, index, array) => array.findIndex((item) => item.text === candidate.text) === index);
}
function isEvidenceLikeSentence(sentence) {
  const trimmed = sentence.trim();
  if (!trimmed) {
    return false;
  }
  if (/^#{1,6}\s/.test(trimmed) || /^>+\s*/.test(trimmed)) {
    return false;
  }
  if (/[?？]$/.test(trimmed)) {
    return false;
  }
  if (/^(?:\*|-|•|\d+[.)、]|[一二三四五六七八九十]+[、.])\s*$/.test(trimmed)) {
    return false;
  }
  if (/^(?:例如|比如|如果面试官问|推荐回答|一句话记忆|核心思想|系统流程|流程：?)[:：]?$/.test(trimmed)) {
    return false;
  }
  if (/(面试官问|推荐回答|可以这样描述|建议回答|标准回答模板)/.test(trimmed)) {
    return false;
  }
  if (/^[【\[].+[】\]]\s*[；;:：。.]?$/.test(trimmed)) {
    return false;
  }
  if (/[：:]$/.test(trimmed) && trimmed.length < 18) {
    return false;
  }
  if (trimmed.length >= 12) {
    return true;
  }
  return /(检索增强生成|retrieval-augmented generation|rag|lora|steam_total|opc|向量化|向量检索|llm|主汽压力|锅炉响应速度)/i.test(trimmed);
}
function bestSentenceEvidence(chunk, query, queryTokens, anchorTokens, intent) {
  const evidenceCandidates = extractEvidenceCandidates(chunk.text);
  const rankedSentences = evidenceCandidates.filter((candidate) => isEvidenceLikeSentence(candidate.text)).map((candidate) => ({
    sentence: candidate.text,
    index: candidate.index,
    score: sentenceMatchScore(candidate.text, query, queryTokens, anchorTokens, intent)
  })).sort((left, right) => right.score - left.score);
  const best = rankedSentences[0];
  if (!best || best.score <= 0) {
    const fallback = chunk.text.length > 420 ? `${chunk.text.slice(0, 417)}...` : chunk.text;
    return { evidenceText: chunk.text, evidenceScore: 0, snippet: fallback };
  }
  const snippetParts = [best.sentence];
  const snippetCandidates = evidenceCandidates.filter((candidate) => candidate.index === best.index || candidate.index === best.index + 1);
  const nextSentence = snippetCandidates.find((candidate) => candidate.index === best.index + 1)?.text;
  const shouldAppendNextSentence = Boolean(nextSentence) && (/[：:(（"“]$/.test(best.sentence) || best.sentence.length < 28);
  if (shouldAppendNextSentence && nextSentence) {
    snippetParts.push(nextSentence);
  }
  let snippet = snippetParts.join(" ");
  if (snippet.length > 420) {
    const cutoff = snippet.slice(0, 420);
    const punctuationIndex = Math.max(cutoff.lastIndexOf("。"), cutoff.lastIndexOf(". "), cutoff.lastIndexOf("！"), cutoff.lastIndexOf("？"));
    snippet = punctuationIndex > 220 ? cutoff.slice(0, punctuationIndex + 1).trim() : `${cutoff.trimEnd()}...`;
  }
  return { evidenceText: best.sentence, evidenceScore: best.score, snippet };
}
function parseEmbedding(raw) {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((value) => Number(value) || 0) : [];
  } catch {
    return [];
  }
}
function dedupeByDocumentBalance(results, limit) {
  const selected = [];
  const perDocumentCount = /* @__PURE__ */ new Map();
  for (const result of results) {
    const count = perDocumentCount.get(result.documentId) ?? 0;
    const allowAnotherFromSameDocument = selected.length < 2 || count < 2;
    if (!allowAnotherFromSameDocument) {
      continue;
    }
    selected.push(result);
    perDocumentCount.set(result.documentId, count + 1);
    if (selected.length >= limit) {
      break;
    }
  }
  return selected;
}
function searchChunks(query, documents, chunks, limit = 6, queryEmbedding = null) {
  const intent = detectQueryIntent(query);
  const queryTokens = [.../* @__PURE__ */ new Set([...intent.queryTokens, ...expandQueryTokens(query, intent)])];
  if (queryTokens.length === 0) {
    return [];
  }
  const documentMap = new Map(documents.map((document) => [document.id, document]));
  const queryNgrams = charNgrams(query);
  const anchorTokens = selectAnchorTokens(queryTokens);
  const effectiveTokens = anchorTokens.length > 0 ? anchorTokens : queryTokens;
  const chunkTokens = chunks.map((chunk) => tokenize(chunk.text));
  const documentFrequency = /* @__PURE__ */ new Map();
  for (const tokens of chunkTokens) {
    for (const token of new Set(tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  const timestamps = documents.map(getDocumentTimestamp);
  const minTimestamp = Math.min(...timestamps, Date.now());
  const maxTimestamp = Math.max(...timestamps, Date.now());
  const totalChunks = Math.max(1, chunks.length);
  const recencyWeight = intent.wantsRecency ? 0.9 : 0.35;
  const evaluatedCandidates = chunks.map((chunk, index) => {
    const document = documentMap.get(chunk.documentId);
    if (!document) {
      return null;
    }
    const tokens = chunkTokens[index] ?? [];
    const frequencies = termFrequency(tokens);
    const contextText = getChunkContext(chunk, document);
    const metadataTokens = tokenize([document.title, chunk.sectionTitle, chunk.sectionPath].filter(Boolean).join(" "));
    const embeddingScore = queryEmbedding ? cosineSimilarity$1(queryEmbedding, parseEmbedding(chunk.embedding)) * 3.2 : 0;
    const exactTitleBoost = titleBoost(query, document, chunk);
    const sectionBoost = intentSectionBoost(intent, chunk, document);
    const evidence = bestSentenceEvidence(chunk, query, queryTokens, anchorTokens, intent);
    let lexicalScore = 0;
    for (const token of queryTokens) {
      const tf = frequencies.get(token) ?? 0;
      const df = documentFrequency.get(token) ?? 0;
      const idf = Math.log(1 + totalChunks / (1 + df));
      lexicalScore += tf * idf;
      if (metadataTokens.includes(token)) {
        lexicalScore += 1.2;
      }
    }
    lexicalScore += phraseBoost(query, contextText) + exactTitleBoost + sectionBoost * 0.4;
    const semanticScore = cosineSimilarity(queryNgrams, charNgrams(contextText)) * 2.2 + jaccardSimilarity(queryTokens, tokens) * 1.4 + jaccardSimilarity(queryTokens, metadataTokens) * 1.1 + embeddingScore;
    const freshnessScore = normalizeFreshness(getDocumentTimestamp(document), minTimestamp, maxTimestamp);
    const matchedTokenCount = effectiveTokens.filter((token) => contextText.toLowerCase().includes(token)).length;
    const coverage = matchedTokenCount / effectiveTokens.length;
    const matchedAnchorCount = anchorTokens.filter((token) => contextText.toLowerCase().includes(token)).length;
    const metadataBoost = chunk.sectionTitle ? 0.18 : 0;
    const longestMatch = maxConsecutiveTokenMatch(queryTokens, contextText);
    const qualityScore = chunkQualityScore(chunk.text, chunk, document);
    const evidenceMatchedTokenCount = effectiveTokens.filter((token) => evidence.evidenceText.toLowerCase().includes(token.toLowerCase())).length;
    const evidenceCoverage = effectiveTokens.length > 0 ? evidenceMatchedTokenCount / effectiveTokens.length : 0;
    const rerankScore = coverage * 1.35 + phraseBoost(query, chunk.text) * 0.45 + metadataBoost + longestMatch * 0.05 + sectionBoost * 0.55 + evidenceCoverage * (intent.wantsSteps ? 1.2 : 0.55) + roleAnswerBoost(query, evidence.evidenceText, chunk, document) + evidence.evidenceScore * 0.72 + Math.max(0, qualityScore) * 0.15;
    const penalty = mismatchPenalty(query, contextText) + intentMismatchPenalty(intent, chunk, document, evidence.evidenceText) + (intent.wantsSteps && anchorTokens.length > 0 && evidenceCoverage < 0.18 ? 0.45 : 0) + Math.max(0, -qualityScore) * 0.9;
    const score = lexicalScore * 0.42 + semanticScore * 0.31 + rerankScore * 0.22 + freshnessScore * recencyWeight + qualityScore * 0.34 - penalty;
    const minimumCoverage = queryTokens.length >= 3 ? 0.26 : 0.18;
    const roleLikeStrongSignal = isRoleQuestion(query) && /(用于|用来|负责|完成|实现|作用是)/.test(evidence.evidenceText) && anchorTokens.some((token) => contextText.toLowerCase().includes(token.toLowerCase()));
    const hasStrongSignal = phraseBoost(query, contextText) > 0 || embeddingScore > 0.55 || exactTitleBoost > 0 || longestMatch >= 4 || evidence.evidenceScore >= 1.3 || roleLikeStrongSignal;
    const anchorSatisfied = anchorTokens.length === 0 || matchedAnchorCount >= Math.min(2, Math.max(1, Math.ceil(anchorTokens.length / 3)));
    const lowQualityWeakMatch = qualityScore < -0.35 && !hasStrongSignal && coverage < 0.55;
    const roleQuestionWithoutRoleEvidence = isRoleQuestion(query) && /安装|步骤|下一步|安装内容|单击|点击|勾选/.test([chunk.sectionTitle, chunk.sectionPath, evidence.evidenceText].filter(Boolean).join(" ")) && !/(用于|用来|负责|完成|实现|作用是)/.test(evidence.evidenceText);
    const keepInPrimaryRanking = !(score <= 0.02 || penalty >= 1.4 || roleQuestionWithoutRoleEvidence || lowQualityWeakMatch || coverage < minimumCoverage && !hasStrongSignal || !anchorSatisfied && !hasStrongSignal);
    return {
      candidate: {
        chunk,
        document,
        lexicalScore,
        semanticScore,
        freshnessScore,
        rerankScore,
        qualityScore,
        score,
        evidenceText: evidence.evidenceText,
        evidenceScore: evidence.evidenceScore
      },
      keepInPrimaryRanking
    };
  }).filter((item) => item !== null);
  const sortedCandidates = evaluatedCandidates.filter((item) => item.keepInPrimaryRanking).map((item) => item.candidate).sort((left, right) => right.score - left.score);
  const rescuedRoleCandidates = isRoleQuestion(query) ? evaluatedCandidates.map((item) => item.candidate).filter(
    (candidate) => /(用于|用来|负责|完成|实现|作用是)/.test(candidate.evidenceText) && anchorTokens.some((token) => candidate.evidenceText.toLowerCase().includes(token.toLowerCase())) && /系统组成|功能介绍|软件介绍|说明|概述|简介/.test([candidate.chunk.sectionTitle, candidate.chunk.sectionPath].filter(Boolean).join(" "))
  ).sort((left, right) => right.score - left.score).slice(0, 3) : [];
  const candidates = [...sortedCandidates.slice(0, Math.max(limit * 3, 8)), ...rescuedRoleCandidates].filter((candidate, index, array) => array.findIndex((item) => item.chunk.id === candidate.chunk.id) === index).sort((left, right) => right.score - left.score);
  const results = candidates.map((candidate) => {
    const { chunk, document } = candidate;
    const evidence = bestSentenceEvidence(chunk, query, queryTokens, anchorTokens, intent);
    const highlight = findHighlightRange(chunk.text, candidate.evidenceScore > 0 ? candidate.evidenceText : evidence.evidenceText);
    return {
      documentId: chunk.documentId,
      fileName: document.fileName,
      documentTitle: document.title,
      chunkId: chunk.id,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      snippet: evidence.snippet,
      evidenceText: candidate.evidenceScore > 0 ? candidate.evidenceText : evidence.evidenceText,
      anchorLabel: formatEvidenceAnchorLabel({
        locatorLabel: chunk.locatorLabel,
        sentenceIndex: highlight.sentenceIndex
      }),
      highlightText: highlight.highlightText,
      highlightStart: highlight.highlightStart,
      highlightEnd: highlight.highlightEnd,
      fullText: chunk.text,
      score: candidate.score,
      lexicalScore: candidate.lexicalScore,
      semanticScore: candidate.semanticScore,
      freshnessScore: candidate.freshnessScore,
      rerankScore: candidate.rerankScore,
      qualityScore: candidate.qualityScore,
      sectionTitle: chunk.sectionTitle,
      sectionPath: chunk.sectionPath,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      paragraphStart: chunk.paragraphStart,
      paragraphEnd: chunk.paragraphEnd,
      locatorLabel: chunk.locatorLabel,
      sourceUpdatedAt: document.sourceUpdatedAt,
      importedAt: document.importedAt
    };
  }).sort((left, right) => right.score - left.score);
  const filteredByRelativeScore = results.filter((result, index, array) => {
    const topScore = array[0]?.score ?? 0;
    return index === 0 || result.score >= topScore * 0.42;
  });
  return dedupeByDocumentBalance(filteredByRelativeScore, limit);
}
const TABLE_NAME = "knowledge_chunks";
function escapeSql(value) {
  return value.replace(/'/g, "''");
}
class LanceIndex {
  connectionPromise = null;
  async getConnection() {
    if (!this.connectionPromise) {
      const dbPath = path.join(app.getPath("userData"), "lancedb");
      this.connectionPromise = lancedb.connect(dbPath);
    }
    return this.connectionPromise;
  }
  async rebuild(rows) {
    const connection = await this.getConnection();
    const existingTables = await connection.tableNames();
    if (rows.length === 0) {
      if (existingTables.includes(TABLE_NAME)) {
        await connection.dropTable(TABLE_NAME);
      }
      return;
    }
    const table = await connection.createTable(TABLE_NAME, rows, {
      mode: "overwrite"
    });
    try {
      await table.createIndex("vector");
    } catch {
    }
  }
  async replaceDocument(documentId, rows) {
    const connection = await this.getConnection();
    const existingTables = await connection.tableNames();
    if (!existingTables.includes(TABLE_NAME)) {
      if (rows.length > 0) {
        await this.rebuild(rows);
      }
      return;
    }
    const table = await connection.openTable(TABLE_NAME);
    await table.delete(`documentId = '${escapeSql(documentId)}'`);
    if (rows.length > 0) {
      await table.add(rows);
    }
  }
  async deleteDocument(documentId) {
    const connection = await this.getConnection();
    const existingTables = await connection.tableNames();
    if (!existingTables.includes(TABLE_NAME)) {
      return;
    }
    const table = await connection.openTable(TABLE_NAME);
    await table.delete(`documentId = '${escapeSql(documentId)}'`);
  }
  async clear() {
    const connection = await this.getConnection();
    const existingTables = await connection.tableNames();
    if (existingTables.includes(TABLE_NAME)) {
      await connection.dropTable(TABLE_NAME);
    }
  }
  async search(vector, limit) {
    if (vector.length === 0) {
      return [];
    }
    const connection = await this.getConnection();
    const existingTables = await connection.tableNames();
    if (!existingTables.includes(TABLE_NAME)) {
      return [];
    }
    const table = await connection.openTable(TABLE_NAME);
    const rows = await table.vectorSearch(vector).select(["chunkId"]).limit(limit).toArray();
    return rows.map((row) => String(row.chunkId ?? "")).filter(Boolean);
  }
}
function slugifyQuestion(question) {
  const normalized = question.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").trim().replace(/\s+/g, "-");
  return normalized || "eval-case";
}
function inferCategory(question) {
  if (isRoleQuestion(question)) {
    return "role";
  }
  if (/(是什么|是什么样|是多少|多大|多高|多久|多久一次|是谁|哪家|哪个|何时)/u.test(question)) {
    return "definition";
  }
  const intent = detectQueryIntent(question);
  if (intent.primary === "explanatory") {
    return "definition";
  }
  if (intent.primary === "procedural") {
    return "procedure";
  }
  if (intent.primary === "troubleshooting") {
    return "troubleshooting";
  }
  if (intent.primary === "navigational") {
    return "navigational";
  }
  return "general";
}
function cleanEvidenceText(text) {
  return text.replace(/\s+/g, " ").replace(/^[>\-*•\d.、()\s]+/u, "").trim();
}
function extractEvidenceIncludes(citation) {
  const source = cleanEvidenceText(citation.evidenceText ?? citation.snippet);
  const fragments = source.split(/[。！？.!?；;]+/u).map((part) => cleanEvidenceText(part)).flatMap((part) => part.split(/\s*[|·]\s*/u)).filter((part) => part.length >= 4 && part.length <= 48).filter((part) => !/^(当前|本项目|该项目|系统|可以|需要|采用|负责|包括)$/u.test(part));
  const selected = [...new Set(fragments)].slice(0, 2);
  return selected.length > 0 ? selected : [source.slice(0, 32)].filter(Boolean);
}
function buildEvalCaseDraft(log) {
  const citation = log.citations[0];
  if (!citation) {
    return null;
  }
  return {
    id: slugifyQuestion(log.question),
    sourceLogId: log.id,
    category: inferCategory(log.question),
    question: log.question,
    expectation: {
      topK: 2,
      fileNameIncludes: citation.fileName,
      sectionPathIncludes: citation.sectionPath ? [citation.sectionPath] : void 0,
      evidenceIncludes: extractEvidenceIncludes(citation)
    }
  };
}
function buildEvalCaseDrafts(logs) {
  return logs.map((log) => buildEvalCaseDraft(log)).filter((draft) => draft !== null);
}
function makeIssue(input) {
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
function buildLibraryHealthReport(input) {
  const issues = [];
  const chunkMap = /* @__PURE__ */ new Map();
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
    generatedAt: input.generatedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
    summary: {
      totalDocuments: input.documents.length,
      issueCount: issues.length,
      missingSourceCount,
      reindexNeededCount
    },
    issues
  };
}
function deriveDocumentTitle(fileName, content) {
  const markdownHeading = content.match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim();
  if (markdownHeading) {
    return markdownHeading;
  }
  const firstMeaningfulLine = content.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0 && line.length <= 120);
  if (firstMeaningfulLine) {
    return firstMeaningfulLine;
  }
  return path.parse(fileName).name;
}
function buildIndexConfigSignature(settings) {
  return JSON.stringify({
    chunkSize: settings.chunkSize,
    chunkOverlap: settings.chunkOverlap,
    parserVersion: 2
  });
}
function hasUsableChunkState(document, chunks) {
  return chunks.length > 0 && chunks.length === document.chunkCount && chunks.some((chunk) => Boolean(chunk.embedding));
}
class KnowledgeService {
  constructor(store2) {
    this.store = store2;
  }
  lanceIndex = new LanceIndex();
  activeLibraryTask = null;
  deriveSessionTitle(question) {
    const normalized = question.replace(/\s+/g, " ").trim();
    if (normalized.length <= 24) {
      return normalized;
    }
    return `${normalized.slice(0, 24)}...`;
  }
  async attachEmbeddings(chunks) {
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
  async backfillMissingEmbeddings(documents, chunks) {
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
      const parsed = await fs$1.access(document.filePath).then(() => parseDocument(document.filePath)).catch(() => ({ fileType: document.fileType, content: document.content, pageSpans: void 0 }));
      const title = document.title || deriveDocumentTitle(document.fileName, parsed.content);
      const baseChunks = chunkText(document.id, parsed.content, { ...settings, pageSpans: parsed.pageSpans });
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
  toLanceRows(documents, chunks) {
    const documentMap = new Map(documents.map((document) => [document.id, document]));
    return chunks.map((chunk) => {
      const document = documentMap.get(chunk.documentId);
      if (!document || !chunk.embedding) {
        return null;
      }
      try {
        const vector = JSON.parse(chunk.embedding);
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
        };
      } catch {
        return null;
      }
    }).filter((row) => row !== null);
  }
  async rebuildLanceIndex(documents, chunks) {
    try {
      await this.lanceIndex.rebuild(this.toLanceRows(documents, chunks));
    } catch {
    }
  }
  emitTaskProgress(emitProgress, input) {
    emitProgress?.({
      ...input,
      done: input.phase === "completed" || input.phase === "failed" && input.current >= input.total
    });
  }
  createTaskId(kind) {
    return createStableId(`${kind}:${Date.now()}:${Math.random()}`);
  }
  beginLibraryTask(kind) {
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
  ensureLibraryTaskIdle() {
    if (this.activeLibraryTask) {
      const label = this.activeLibraryTask.kind === "import" ? "导入文件" : "重建索引";
      throw new Error(`当前正在执行${label}任务，请稍后再试。`);
    }
  }
  selectCandidateChunks(question, documents, chunks, vectorChunkIds) {
    if (vectorChunkIds.length === 0) {
      return chunks;
    }
    const documentMap = new Map(documents.map((document) => [document.id, document]));
    new Set(vectorChunkIds);
    const queryTokens = tokenize(question).filter((token) => token.length >= 2);
    const lexicalFallback = chunks.filter((chunk) => {
      const document = documentMap.get(chunk.documentId);
      const haystack = [document?.title, document?.fileName, chunk.sectionTitle, chunk.sectionPath, chunk.text].filter(Boolean).join("\n").toLowerCase();
      const matched = queryTokens.filter((token) => haystack.includes(token.toLowerCase())).length;
      return matched >= Math.min(2, queryTokens.length);
    });
    const candidateIds = /* @__PURE__ */ new Set([...vectorChunkIds, ...lexicalFallback.map((chunk) => chunk.id)]);
    const candidates = chunks.filter((chunk) => candidateIds.has(chunk.id));
    return candidates.length > 0 ? candidates : chunks;
  }
  async getSnapshot() {
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
        version: app.getVersion(),
        platform: process.platform,
        userDataPath: app.getPath("userData"),
        databasePath: this.store.getDatabasePath()
      }
    };
  }
  async getLibraryHealth() {
    const documents = this.store.listDocuments();
    const chunks = this.store.listChunks();
    const currentIndexConfigSignature = buildIndexConfigSignature(this.store.getSettings());
    const sourceStatusEntries = await Promise.all(
      documents.map(async (document) => {
        try {
          const stats = await fs$1.stat(document.filePath);
          return [
            document.id,
            {
              exists: true,
              sourceUpdatedAt: new Date(stats.mtimeMs).toISOString()
            }
          ];
        } catch {
          return [
            document.id,
            {
              exists: false,
              sourceUpdatedAt: null
            }
          ];
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
  async importFiles(filePaths, emitProgress) {
    const task = this.beginLibraryTask("import");
    const imported = [];
    const skipped = [];
    const skippedDetails = [];
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
          const fileStats = await fs$1.stat(filePath);
          const now = (/* @__PURE__ */ new Date()).toISOString();
          const documentId = createStableId(filePath);
          const settings = this.store.getSettings();
          const indexConfigSignature = buildIndexConfigSignature(settings);
          const existing = this.store.getDocument(documentId);
          const existingChunks = existing ? this.store.listChunks(documentId) : [];
          const sourceUpdatedAt = new Date(fileStats.mtimeMs).toISOString();
          const canSkipUnchanged = Boolean(existing) && existing?.sourceUpdatedAt === sourceUpdatedAt && existing?.indexConfigSignature === indexConfigSignature && hasUsableChunkState(existing, existingChunks);
          if (canSkipUnchanged && existing) {
            skipped.push(filePath);
            skippedDetails.push({
              filePath,
              reason: "文件未变化，已跳过重复导入。",
              disposition: "skipped"
            });
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
          const document = {
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
          skipped.push(filePath);
          skippedDetails.push({
            filePath,
            reason: error instanceof Error ? error.message : "未知导入错误",
            disposition: "failed"
          });
          this.emitTaskProgress(emitProgress, {
            taskId,
            kind: "import",
            phase: "failed",
            message: `导入失败：${path.basename(filePath)}`,
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
  async runReindexForDocuments(documents, emitProgress) {
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
          const fileStats = await fs$1.stat(document.filePath);
          const sourceUpdatedAt = new Date(fileStats.mtimeMs).toISOString();
          const existingChunks = this.store.listChunks(document.id);
          const hasChunkCoverage = existingChunks.length > 0 && existingChunks.length === document.chunkCount;
          const hasEmbeddings = existingChunks.some((chunk) => Boolean(chunk.embedding));
          const shouldSkip = document.sourceUpdatedAt === sourceUpdatedAt && document.indexConfigSignature === indexConfigSignature && hasChunkCoverage && hasEmbeddings;
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
          const parsed = await parseDocument(document.filePath);
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
            updatedAt: (/* @__PURE__ */ new Date()).toISOString()
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
        } catch {
          failed += 1;
          this.emitTaskProgress(emitProgress, {
            taskId,
            kind: "reindex",
            phase: "failed",
            message: `重建失败：${document.fileName}`,
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
  async reindexLibrary(emitProgress) {
    return this.runReindexForDocuments(this.store.listDocuments(), emitProgress);
  }
  async reindexDocuments(documentIds, emitProgress) {
    const targets = this.store.listDocuments().filter((document) => documentIds.includes(document.id));
    return this.runReindexForDocuments(targets, emitProgress);
  }
  async deleteDocument(documentId) {
    this.ensureLibraryTaskIdle();
    this.store.deleteDocument(documentId);
    await this.rebuildLanceIndex(this.store.listDocuments(), this.store.listChunks());
    return this.getSnapshot();
  }
  async removeDocuments(documentIds) {
    this.ensureLibraryTaskIdle();
    this.store.deleteDocuments(documentIds);
    await this.rebuildLanceIndex(this.store.listDocuments(), this.store.listChunks());
    return this.getSnapshot();
  }
  async clearLibrary() {
    this.ensureLibraryTaskIdle();
    this.store.clearLibrary();
    try {
      await this.lanceIndex.clear();
    } catch {
    }
    return this.getSnapshot();
  }
  createChatSession() {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    return this.store.createChatSession({
      id: createStableId(`chat-session:${now}:${Math.random()}`),
      title: "新对话",
      createdAt: now,
      updatedAt: now
    });
  }
  getChatTurns(sessionId) {
    return this.store.listChatTurns(sessionId);
  }
  async askQuestion(sessionId, question) {
    const documents = this.store.listDocuments();
    const chunks = await this.backfillMissingEmbeddings(documents, this.store.listChunks());
    let queryEmbedding = null;
    try {
      const [vector] = await embedTexts([question]);
      queryEmbedding = vector ?? null;
    } catch {
      queryEmbedding = null;
    }
    let vectorChunkIds = [];
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
    const candidateChunks = this.selectCandidateChunks(question, documents, chunks, vectorChunkIds);
    const results = searchChunks(question, documents, candidateChunks, 6, queryEmbedding);
    const answer = answerQuestion(question, results);
    const turn = {
      id: createStableId(`chat-turn:${sessionId}:${question}:${Date.now()}`),
      sessionId,
      question,
      answer,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    const existingTurns = this.store.listChatTurns(sessionId);
    const nextTitle = existingTurns.length === 0 ? this.deriveSessionTitle(question) : void 0;
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
    });
    return turn;
  }
  async deleteChatSession(sessionId) {
    this.store.deleteChatSession(sessionId);
    return this.getSnapshot();
  }
  async clearChatSessions() {
    this.store.clearChatSessions();
    return this.getSnapshot();
  }
  getDocument(documentId) {
    return this.store.getDocument(documentId);
  }
  getDocumentChunks(documentId) {
    return this.store.listChunks(documentId);
  }
  updateSettings(settings) {
    return this.store.updateSettings(settings);
  }
  async openDocument(filePath) {
    await shell.openPath(filePath);
  }
  getQueryLogs(limit = 50) {
    return this.store.listQueryLogs(limit);
  }
  updateQueryLogStatus(logId, status, note = null) {
    this.store.updateQueryLogStatus(logId, status, note);
    return this.store.listQueryLogs(50);
  }
  getEvalCandidateDrafts(limit = 20) {
    const logs = this.store.listQueryLogs(Math.max(limit * 3, limit));
    return buildEvalCaseDrafts(logs.filter((log) => log.feedbackStatus === "benchmark_candidate")).slice(0, limit);
  }
}
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
let mainWindow = null;
const store = new AppStore();
const knowledgeService = new KnowledgeService(store);
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    title: "个人知识库 RAG",
    webPreferences: {
      preload: path.join(__dirname$1, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    await mainWindow.loadURL(rendererUrl);
  } else {
    await mainWindow.loadFile(path.join(__dirname$1, "../../dist/renderer/index.html"));
  }
}
app.whenReady().then(async () => {
  ipcMain.handle("snapshot:get", () => knowledgeService.getSnapshot());
  ipcMain.handle("files:import", async (_event, filePaths) => {
    try {
      const requestedPaths = filePaths?.filter(Boolean) ?? [];
      if (requestedPaths.length > 0) {
        return knowledgeService.importFiles(requestedPaths, (progress) => {
          mainWindow?.webContents.send("library:task-progress", progress);
        });
      }
      const dialogOptions = {
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "Supported documents",
            extensions: ["pdf", "md", "txt", "docx"]
          }
        ]
      };
      const result = mainWindow ? await dialog.showOpenDialog(mainWindow, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
      if (result.canceled || result.filePaths.length === 0) {
        return { imported: [], skipped: [], skippedDetails: [] };
      }
      return knowledgeService.importFiles(result.filePaths, (progress) => {
        mainWindow?.webContents.send("library:task-progress", progress);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown file picker error";
      throw new Error(`Failed to import files: ${message}`);
    }
  });
  ipcMain.handle("chat:create-session", () => knowledgeService.createChatSession());
  ipcMain.handle("chat:turns", (_event, sessionId) => knowledgeService.getChatTurns(sessionId));
  ipcMain.handle("chat:ask", (_event, sessionId, question) => knowledgeService.askQuestion(sessionId, question));
  ipcMain.handle("chat:delete-session", (_event, sessionId) => knowledgeService.deleteChatSession(sessionId));
  ipcMain.handle("chat:clear-sessions", () => knowledgeService.clearChatSessions());
  ipcMain.handle("document:get", (_event, documentId) => knowledgeService.getDocument(documentId));
  ipcMain.handle("document:chunks", (_event, documentId) => knowledgeService.getDocumentChunks(documentId));
  ipcMain.handle(
    "library:reindex",
    () => knowledgeService.reindexLibrary((progress) => {
      mainWindow?.webContents.send("library:task-progress", progress);
    })
  );
  ipcMain.handle("library:health", () => knowledgeService.getLibraryHealth());
  ipcMain.handle(
    "library:reindex-documents",
    (_event, documentIds) => knowledgeService.reindexDocuments(documentIds, (progress) => {
      mainWindow?.webContents.send("library:task-progress", progress);
    })
  );
  ipcMain.handle("library:remove-documents", (_event, documentIds) => knowledgeService.removeDocuments(documentIds));
  ipcMain.handle("document:delete", (_event, documentId) => knowledgeService.deleteDocument(documentId));
  ipcMain.handle("library:clear", () => knowledgeService.clearLibrary());
  ipcMain.handle("settings:update", (_event, settings) => knowledgeService.updateSettings(settings));
  ipcMain.handle("document:open", (_event, filePath) => knowledgeService.openDocument(filePath));
  ipcMain.handle("query-logs:list", (_event, limit) => knowledgeService.getQueryLogs(limit));
  ipcMain.handle(
    "query-logs:update-status",
    (_event, logId, status, note) => knowledgeService.updateQueryLogStatus(logId, status, note)
  );
  ipcMain.handle("query-logs:eval-drafts", (_event, limit) => knowledgeService.getEvalCandidateDrafts(limit));
  await createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
});

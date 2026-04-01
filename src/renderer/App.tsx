import { useEffect, useState } from "react";
import type { AppSettings, ChatAnswer, ChunkRecord, DesktopApi, DocumentRecord } from "../lib/shared/types";

type Screen = "library" | "chat" | "detail" | "settings";

const EMPTY_ANSWER: ChatAnswer = { answer: "", citations: [] };

function getDesktopApi(): DesktopApi {
  if (!window.desktopApi) {
    throw new Error("Desktop bridge unavailable. Please restart the Electron app.");
  }

  return window.desktopApi;
}

export function App() {
  const [screen, setScreen] = useState<Screen>("library");
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<DocumentRecord | null>(null);
  const [selectedChunks, setSelectedChunks] = useState<ChunkRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    libraryPath: null,
    chunkSize: 180,
    chunkOverlap: 40
  });
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<ChatAnswer>(EMPTY_ANSWER);
  const [status, setStatus] = useState("Ready");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    void refreshSnapshot();
  }, []);

  async function refreshSnapshot(): Promise<void> {
    try {
      const api = getDesktopApi();
      const snapshot = await api.getSnapshot();
      setDocuments(snapshot.documents);
      setSettings(snapshot.settings);
      setErrorMessage("");
      setStatus("Ready");

      if (selectedDocument) {
        const freshDoc = snapshot.documents.find((item) => item.id === selectedDocument.id) ?? null;
        setSelectedDocument(freshDoc);
        if (freshDoc) {
          const chunks = await api.getDocumentChunks(freshDoc.id);
          setSelectedChunks(chunks);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown startup error";
      setErrorMessage(message);
      setStatus("Desktop bridge failed");
    }
  }

  async function handleImport(): Promise<void> {
    try {
      const api = getDesktopApi();
      setErrorMessage("");
      setStatus("Opening file picker...");
      const result = await api.importFiles();

      if (result.imported.length === 0 && result.skipped.length === 0) {
        setStatus("Import cancelled");
        return;
      }

      await refreshSnapshot();
      setScreen("library");

      if (result.skipped.length > 0) {
        setErrorMessage(`Some files could not be imported: ${result.skipped.join(", ")}`);
      }

      setStatus(`Import complete: ${result.imported.length} file(s) added`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown import error";
      setErrorMessage(message);
      setStatus("Import failed");
    }
  }

  async function handleAskQuestion(): Promise<void> {
    if (!question.trim()) {
      return;
    }
    try {
      const api = getDesktopApi();
      setErrorMessage("");
      setStatus("Searching indexed knowledge...");
      const result = await api.askQuestion(question);
      setAnswer(result);
      setStatus("Answer ready");
      setScreen("chat");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown chat error";
      setErrorMessage(message);
      setStatus("Answer failed");
    }
  }

  async function handleSelectDocument(document: DocumentRecord): Promise<void> {
    try {
      const api = getDesktopApi();
      const chunks = await api.getDocumentChunks(document.id);
      setSelectedDocument(document);
      setSelectedChunks(chunks);
      setScreen("detail");
      setErrorMessage("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown document error";
      setErrorMessage(message);
      setStatus("Document load failed");
    }
  }

  async function handleReindex(): Promise<void> {
    try {
      const api = getDesktopApi();
      setErrorMessage("");
      setStatus("Reindexing library...");
      const snapshot = await api.reindexLibrary();
      setDocuments(snapshot.documents);
      setSettings(snapshot.settings);
      setStatus("Reindex complete");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown reindex error";
      setErrorMessage(message);
      setStatus("Reindex failed");
    }
  }

  async function handleSettingsChange(next: Partial<AppSettings>): Promise<void> {
    try {
      const api = getDesktopApi();
      setErrorMessage("");
      const updated = await api.updateSettings(next);
      setSettings(updated);
      setStatus("Settings saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown settings error";
      setErrorMessage(message);
      setStatus("Settings failed");
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Local-first RAG</p>
          <h1>Personal Knowledge RAG</h1>
          <p className="muted">Mac-friendly desktop knowledge base with grounded answers and citations.</p>
        </div>

        <nav className="nav">
          <button className={screen === "library" ? "active" : ""} onClick={() => setScreen("library")}>Library</button>
          <button className={screen === "chat" ? "active" : ""} onClick={() => setScreen("chat")}>Chat</button>
          <button className={screen === "settings" ? "active" : ""} onClick={() => setScreen("settings")}>Settings</button>
        </nav>

        <div className="sidebar-actions">
          <button onClick={() => void handleImport()}>Import Files</button>
          <button onClick={() => void handleReindex()} className="secondary">Reindex</button>
        </div>

        <div className="status-card">
          <p className="eyebrow">Status</p>
          <strong>{status}</strong>
          <p className="muted">{documents.length} documents indexed</p>
          {errorMessage && <p className="error-text">{errorMessage}</p>}
        </div>
      </aside>

      <main className="content">
        <section className="hero-card">
          <div>
            <p className="eyebrow">Ask your library</p>
            <h2>Grounded answers from local files</h2>
          </div>
          <div className="hero-form">
            <textarea
              rows={3}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask a question about your imported notes, PDFs, and documents..."
            />
            <button onClick={() => void handleAskQuestion()}>Ask</button>
          </div>
        </section>

        {screen === "library" && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Library</p>
                <h3>Imported documents</h3>
              </div>
              <span>{documents.length} files</span>
            </div>
            <div className="document-list">
              {documents.length === 0 && <p className="muted">No files imported yet. Start with PDF, Markdown, TXT, or DOCX.</p>}
              {documents.map((document) => (
                <button key={document.id} className="document-card" onClick={() => void handleSelectDocument(document)}>
                  <div>
                    <strong>{document.fileName}</strong>
                    <p>{document.fileType.toUpperCase()} • {document.chunkCount} chunks</p>
                  </div>
                  <span>{new Date(document.updatedAt).toLocaleString()}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {screen === "chat" && (
          <section className="panel panel-grid">
            <div>
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Chat</p>
                  <h3>Answer</h3>
                </div>
              </div>
              <pre className="answer-box">{answer.answer || "Ask a question to search your knowledge base."}</pre>
            </div>
            <div>
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Citations</p>
                  <h3>Source passages</h3>
                </div>
              </div>
              <div className="citation-list">
                {answer.citations.map((citation) => (
                  <article key={citation.chunkId} className="citation-card">
                    <header>
                      <strong>{citation.fileName}</strong>
                      <span>Chunk {citation.chunkIndex + 1}</span>
                    </header>
                    <p>{citation.snippet}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        {screen === "detail" && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Document Detail</p>
                <h3>{selectedDocument?.fileName ?? "Document"}</h3>
              </div>
              {selectedDocument && (
                <button className="secondary" onClick={() => void getDesktopApi().openDocument(selectedDocument.filePath)}>
                  Open Source File
                </button>
              )}
            </div>
            <div className="detail-meta">
              <span>{selectedDocument?.fileType?.toUpperCase() ?? "N/A"}</span>
              <span>{selectedDocument?.chunkCount ?? 0} chunks</span>
              <span>{selectedDocument?.filePath}</span>
            </div>
            <div className="chunk-list">
              {selectedChunks.map((chunk) => (
                <article key={chunk.id} className="chunk-card">
                  <header>
                    <strong>Chunk {chunk.chunkIndex + 1}</strong>
                    <span>{chunk.tokenCount} tokens</span>
                  </header>
                  <p>{chunk.text}</p>
                </article>
              ))}
            </div>
          </section>
        )}

        {screen === "settings" && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Settings</p>
                <h3>Indexing controls</h3>
              </div>
            </div>
            <div className="settings-grid">
              <label>
                <span>Chunk size</span>
                <input
                  type="number"
                  min={60}
                  max={400}
                  value={settings.chunkSize}
                  onChange={(event) => void handleSettingsChange({ chunkSize: Number(event.target.value) })}
                />
              </label>
              <label>
                <span>Chunk overlap</span>
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={settings.chunkOverlap}
                  onChange={(event) => void handleSettingsChange({ chunkOverlap: Number(event.target.value) })}
                />
              </label>
              <div className="settings-note">
                This first MVP uses reliable local lexical retrieval. The module boundaries are ready for adding embeddings and local LLM answering next.
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

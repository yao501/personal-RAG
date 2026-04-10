import { useEffect, useMemo, useState, type ReactNode } from "react";
import { renderEvalCaseDraft } from "../lib/eval/queryLogDrafts";
import { extractSectionRootLabel } from "../lib/modules/citation/sectionRoot";
import type {
  AppInfo,
  AppSettings,
  ChatAnswer,
  Citation,
  EvalCaseDraft,
  DocumentQuestionMatch,
  ImportIssueDetail,
  LibraryHealthReport,
  QueryLogRecord,
  QueryLogFeedbackStatus,
  ChatSession,
  ChatTurn,
  ChunkRecord,
  DesktopApi,
  DocumentRecord,
  LibraryTaskProgress,
  RendererErrorInfo,
  SupportedFileType,
  SystemStatus
} from "../lib/shared/types";

type Screen = "library" | "chat" | "detail" | "settings";
type DetailSortMode = "structure" | "question";

const EMPTY_ANSWER: ChatAnswer = {
  answer: "",
  directAnswer: "",
  supportingPoints: [],
  sourceDocumentCount: 0,
  basedOnSingleDocument: false,
  citations: []
};

const EMPTY_STATUS: SystemStatus = {
  documentCount: 0,
  chunkCount: 0,
  embeddingAvailable: false,
  embeddingReason: null
};

const EMPTY_APP_INFO: AppInfo = {
  version: "0.0.0",
  platform: "unknown",
  userDataPath: "",
  databasePath: ""
};

const EMPTY_LIBRARY_HEALTH: LibraryHealthReport = {
  generatedAt: "",
  summary: {
    totalDocuments: 0,
    issueCount: 0,
    missingSourceCount: 0,
    reindexNeededCount: 0
  },
  issues: []
};

function getDesktopApi(): DesktopApi {
  if (!window.desktopApi) {
    throw new Error("Desktop bridge unavailable. Please restart the Electron app.");
  }

  return window.desktopApi;
}

function renderHighlightedText(fullText: string, highlightStart?: number | null, highlightEnd?: number | null): ReactNode {
  if (highlightStart === null || highlightStart === undefined || highlightEnd === null || highlightEnd === undefined) {
    return fullText;
  }

  return (
    <>
      {fullText.slice(0, highlightStart)}
      <mark>{fullText.slice(highlightStart, highlightEnd)}</mark>
      {fullText.slice(highlightEnd)}
    </>
  );
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function buildDiagnosticsText(appInfo: AppInfo, systemStatus: SystemStatus): string {
  return [
    `version: ${appInfo.version}`,
    `platform: ${appInfo.platform}`,
    `userDataPath: ${appInfo.userDataPath}`,
    `databasePath: ${appInfo.databasePath}`,
    `documentCount: ${systemStatus.documentCount}`,
    `chunkCount: ${systemStatus.chunkCount}`,
    `embeddingAvailable: ${systemStatus.embeddingAvailable ? "yes" : "no"}`,
    `embeddingReason: ${systemStatus.embeddingReason ?? "n/a"}`
  ].join("\n");
}

function renderSourceExcerpt(fullText: string, startOffset: number, endOffset: number, radius = 280): ReactNode {
  const excerptStart = Math.max(0, startOffset - radius);
  const excerptEnd = Math.min(fullText.length, endOffset + radius);
  const prefix = fullText.slice(excerptStart, startOffset);
  const focus = fullText.slice(startOffset, endOffset);
  const suffix = fullText.slice(endOffset, excerptEnd);

  return (
    <>
      {excerptStart > 0 ? "... " : ""}
      {prefix}
      <mark>{focus}</mark>
      {suffix}
      {excerptEnd < fullText.length ? " ..." : ""}
    </>
  );
}

function normalizeInlineText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function buildCitationGroupSummary(citations: Citation[]): string {
  const evidence = citations
    .map((citation) => normalizeInlineText(citation.evidenceText ?? citation.snippet))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  if (evidence.length === 0) {
    return "这一组依据共同支撑同一章节下的答案。";
  }

  const combined = evidence
    .slice(0, 2)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (combined.length <= 120) {
    return combined;
  }

  return `${combined.slice(0, 117).trimEnd()}...`;
}

function collectCitationSectionTitles(citations: Citation[]): string[] {
  const seen = new Set<string>();
  return citations
    .map((citation) => citation.sectionTitle?.trim())
    .filter((title): title is string => Boolean(title))
    .filter((title) => {
      if (seen.has(title)) {
        return false;
      }
      seen.add(title);
      return true;
    });
}

function buildCitationGroupKey(label: string | null, groupIndex: number): string {
  return `${label ?? "ungrouped"}-${groupIndex}`;
}

function formatQuestionMatchScore(score: number): string {
  const normalized = Math.max(1, Math.min(99, Math.round(score * 18)));
  return `${normalized}/99`;
}

function formatImportIssueSummary(item: ImportIssueDetail): string {
  const suffix = item.suggestion ? ` 建议：${item.suggestion}` : "";
  return `[${item.code}] ${item.reason}${suffix}`;
}

function extractRendererErrorInfo(error: unknown): RendererErrorInfo | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const record = error as Record<string, unknown>;
  const info = record.errorInfo;
  if (typeof info !== "object" || info === null) {
    return null;
  }
  const candidate = info as Partial<RendererErrorInfo>;
  if (!candidate.code || !candidate.stage || !candidate.message) {
    return null;
  }
  return candidate as RendererErrorInfo;
}

function formatRendererError(info: RendererErrorInfo): string {
  const bits = [`[${info.code}]`, info.stage ? `(${info.stage})` : "", info.message].filter(Boolean);
  const suggestion = info.suggestion ? ` 建议：${info.suggestion}` : "";
  const retryable = info.retryable ? "（可重试）" : "（不建议重试）";
  return `${bits.join(" ")}${retryable}${suggestion}`;
}

export function App() {
  const [screen, setScreen] = useState<Screen>("library");
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<DocumentRecord | null>(null);
  const [selectedChunks, setSelectedChunks] = useState<ChunkRecord[]>([]);
  const [highlightedChunkId, setHighlightedChunkId] = useState<string | null>(null);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [queryLogs, setQueryLogs] = useState<QueryLogRecord[]>([]);
  const [evalDrafts, setEvalDrafts] = useState<EvalCaseDraft[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>(EMPTY_STATUS);
  const [appInfo, setAppInfo] = useState<AppInfo>(EMPTY_APP_INFO);
  const [libraryHealth, setLibraryHealth] = useState<LibraryHealthReport>(EMPTY_LIBRARY_HEALTH);
  const [isLibraryHealthLoading, setIsLibraryHealthLoading] = useState(false);
  const [settings, setSettings] = useState<AppSettings>({
    libraryPath: null,
    chunkSize: 180,
    chunkOverlap: 40
  });
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<ChatAnswer>(EMPTY_ANSWER);
  const [lastAskedQuestion, setLastAskedQuestion] = useState("");
  const [status, setStatus] = useState("就绪");
  const [errorMessage, setErrorMessage] = useState("");
  const [libraryTaskProgress, setLibraryTaskProgress] = useState<LibraryTaskProgress | null>(null);
  const [recentTaskSkippedDetails, setRecentTaskSkippedDetails] = useState<ImportIssueDetail[]>([]);
  const [expandedCitationIds, setExpandedCitationIds] = useState<string[]>([]);
  const [expandedCitationGroupLabels, setExpandedCitationGroupLabels] = useState<string[]>([]);
  const [expandedDetailSectionLabels, setExpandedDetailSectionLabels] = useState<string[]>([]);
  const [isAsking, setIsAsking] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryTypeFilter, setLibraryTypeFilter] = useState<SupportedFileType | "all">("all");
  const [detailQuery, setDetailQuery] = useState("");
  const [detailSortMode, setDetailSortMode] = useState<DetailSortMode>("structure");
  const [detailQuestionMatches, setDetailQuestionMatches] = useState<DocumentQuestionMatch[]>([]);
  const [isDetailQuestionLoading, setIsDetailQuestionLoading] = useState(false);

  const filteredDocuments = useMemo(() => {
    const keyword = libraryQuery.trim().toLowerCase();

    return documents.filter((document) => {
      const matchesType = libraryTypeFilter === "all" || document.fileType === libraryTypeFilter;
      const haystack = [document.title, document.fileName, document.filePath].join(" ").toLowerCase();
      const matchesQuery = !keyword || haystack.includes(keyword);
      return matchesType && matchesQuery;
    });
  }, [documents, libraryQuery, libraryTypeFilter]);

  const selectedTurn = useMemo(
    () => chatTurns.find((turn) => turn.id === selectedTurnId) ?? null,
    [chatTurns, selectedTurnId]
  );
  const currentDetailQuestion = useMemo(
    () => selectedTurn?.question?.trim() || lastAskedQuestion.trim(),
    [lastAskedQuestion, selectedTurn]
  );
  const libraryTaskBusy = Boolean(libraryTaskProgress && !libraryTaskProgress.done);
  const filteredChunks = useMemo(() => {
    const keyword = detailQuery.trim().toLowerCase();
    if (!keyword) {
      return selectedChunks;
    }

    return selectedChunks.filter((chunk) =>
      [chunk.sectionTitle, chunk.sectionPath, chunk.text]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(keyword)
      );
  }, [detailQuery, selectedChunks]);
  const detailQuestionMatchMap = useMemo(
    () => new Map(detailQuestionMatches.map((match) => [match.chunkId, match])),
    [detailQuestionMatches]
  );
  const questionSortedChunks = useMemo(() => {
    return filteredChunks
      .slice()
      .sort((left, right) => {
        const leftMatch = detailQuestionMatchMap.get(left.id);
        const rightMatch = detailQuestionMatchMap.get(right.id);

        if (leftMatch && rightMatch) {
          if (leftMatch.matchRank !== rightMatch.matchRank) {
            return leftMatch.matchRank - rightMatch.matchRank;
          }

          if (rightMatch.score !== leftMatch.score) {
            return rightMatch.score - leftMatch.score;
          }
        }

        if (leftMatch) {
          return -1;
        }

        if (rightMatch) {
          return 1;
        }

        return left.chunkIndex - right.chunkIndex;
      });
  }, [detailQuestionMatchMap, filteredChunks]);
  const visibleDetailChunks = detailSortMode === "question" ? questionSortedChunks : filteredChunks;
  const topQuestionMatches = useMemo(
    () => detailQuestionMatches.slice(0, 6),
    [detailQuestionMatches]
  );
  const selectedDetailChunk = useMemo(() => {
    if (highlightedChunkId) {
      return selectedChunks.find((chunk) => chunk.id === highlightedChunkId) ?? null;
    }

    return visibleDetailChunks[0] ?? selectedChunks[0] ?? null;
  }, [highlightedChunkId, selectedChunks, visibleDetailChunks]);
  const selectedDetailQuestionMatch = useMemo(
    () => (selectedDetailChunk ? detailQuestionMatchMap.get(selectedDetailChunk.id) ?? null : null),
    [detailQuestionMatchMap, selectedDetailChunk]
  );
  const selectedDetailSectionRoot = useMemo(
    () => extractSectionRootLabel(selectedDetailChunk?.sectionPath),
    [selectedDetailChunk]
  );
  const relatedSectionChunks = useMemo(() => {
    if (!selectedDetailSectionRoot) {
      return [];
    }

    return selectedChunks.filter((chunk) => extractSectionRootLabel(chunk.sectionPath) === selectedDetailSectionRoot);
  }, [selectedChunks, selectedDetailSectionRoot]);
  const relatedSectionTitles = useMemo(() => {
    const seen = new Set<string>();
    return relatedSectionChunks
      .map((chunk) => chunk.sectionTitle?.trim())
      .filter((title): title is string => Boolean(title))
      .filter((title) => {
        if (seen.has(title)) {
          return false;
        }
        seen.add(title);
        return true;
      });
  }, [relatedSectionChunks]);
  const detailChunkGroups = useMemo(() => {
    if (detailSortMode === "question") {
      const matchedChunks = visibleDetailChunks.filter((chunk) => detailQuestionMatchMap.has(chunk.id));
      const unmatchedChunks = visibleDetailChunks.filter((chunk) => !detailQuestionMatchMap.has(chunk.id));
      const groups: Array<{ label: string | null; items: ChunkRecord[] }> = [];

      if (matchedChunks.length > 0) {
        groups.push({ label: "当前问题最相关", items: matchedChunks });
      }

      if (unmatchedChunks.length > 0) {
        groups.push({ label: "文档中其余片段", items: unmatchedChunks });
      }

      return groups;
    }

    const groups: Array<{ label: string | null; items: ChunkRecord[] }> = [];

    for (const chunk of visibleDetailChunks) {
      const label = extractSectionRootLabel(chunk.sectionPath);
      const existing = groups.find((group) => group.label === label);
      if (existing) {
        existing.items.push(chunk);
      } else {
        groups.push({ label, items: [chunk] });
      }
    }

    return groups;
  }, [detailQuestionMatchMap, detailSortMode, visibleDetailChunks]);
  const recentFailedImports = useMemo(
    () => recentTaskSkippedDetails.filter((item) => item.disposition === "failed"),
    [recentTaskSkippedDetails]
  );
  const recentSkippedImports = useMemo(
    () => recentTaskSkippedDetails.filter((item) => item.disposition === "skipped"),
    [recentTaskSkippedDetails]
  );

  useEffect(() => {
    void refreshSnapshot();
  }, []);

  useEffect(() => {
    const api = getDesktopApi();
    return api.onLibraryTaskProgress((progress) => {
      setLibraryTaskProgress(progress);
      setStatus(progress.message);
      if (progress.phase !== "completed") {
        setErrorMessage("");
      }
    });
  }, []);

  useEffect(() => {
    if (screen !== "detail" || !highlightedChunkId) {
      return;
    }

    window.requestAnimationFrame(() => {
      window.document.getElementById(`chunk-${highlightedChunkId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    });
  }, [screen, highlightedChunkId, selectedChunks]);

  useEffect(() => {
    if (screen === "settings") {
      void loadLibraryHealth();
    }
  }, [screen]);

  useEffect(() => {
    if (!selectedDetailSectionRoot) {
      return;
    }

    setExpandedDetailSectionLabels((current) =>
      current.includes(selectedDetailSectionRoot) ? current : [...current, selectedDetailSectionRoot]
    );
  }, [selectedDetailSectionRoot]);

  useEffect(() => {
    if (!selectedDocument || !currentDetailQuestion || selectedChunks.length === 0) {
      setDetailQuestionMatches([]);
      setIsDetailQuestionLoading(false);
      if (detailSortMode === "question" && !currentDetailQuestion) {
        setDetailSortMode("structure");
      }
      return;
    }

    let cancelled = false;
    const api = getDesktopApi();

    setIsDetailQuestionLoading(true);
    void api
      .getDocumentQuestionMatches(selectedDocument.id, currentDetailQuestion, Math.min(Math.max(selectedChunks.length, 6), 18))
      .then((matches) => {
        if (cancelled) {
          return;
        }

        setDetailQuestionMatches(matches);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setDetailQuestionMatches([]);
        const message = error instanceof Error ? error.message : "未知问题相关性错误";
        setErrorMessage(message);
        setStatus("文档相关片段分析失败");
      })
      .finally(() => {
        if (!cancelled) {
          setIsDetailQuestionLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentDetailQuestion, detailSortMode, selectedChunks.length, selectedDocument]);

  async function refreshSnapshot(preferredSessionId?: string | null): Promise<void> {
    try {
      const api = getDesktopApi();
      const snapshot = await api.getSnapshot();
      setDocuments(snapshot.documents);
      setSettings(snapshot.settings);
      setChatSessions(snapshot.chatSessions);
      setSystemStatus(snapshot.systemStatus);
      setAppInfo(snapshot.appInfo);
      setQueryLogs(await api.getQueryLogs(12));
      setEvalDrafts(await api.getEvalCandidateDrafts(12));
      setErrorMessage("");
      setStatus("就绪");

      const nextSessionId = preferredSessionId ?? currentSessionId ?? snapshot.chatSessions[0]?.id ?? null;
      setCurrentSessionId(nextSessionId);

      if (nextSessionId) {
        const turns = await api.getChatTurns(nextSessionId);
        setChatTurns(turns);
        const latestTurn = turns.at(-1) ?? null;
        setSelectedTurnId(latestTurn?.id ?? null);
        setAnswer(latestTurn?.answer ?? EMPTY_ANSWER);
        setLastAskedQuestion(latestTurn?.question ?? "");
        setExpandedCitationIds([]);
        setExpandedCitationGroupLabels([]);
        setExpandedDetailSectionLabels([]);
      } else {
        setChatTurns([]);
        setSelectedTurnId(null);
        setAnswer(EMPTY_ANSWER);
        setLastAskedQuestion("");
      }

      if (selectedDocument) {
        const freshDoc = snapshot.documents.find((item) => item.id === selectedDocument.id) ?? null;
        setSelectedDocument(freshDoc);
        if (freshDoc) {
          const chunks = await api.getDocumentChunks(freshDoc.id);
          setSelectedChunks(chunks);
        } else {
          setSelectedChunks([]);
          setHighlightedChunkId(null);
          setDetailQuestionMatches([]);
          setDetailSortMode("structure");
        }
      }

      if (screen === "settings") {
        void loadLibraryHealth();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知启动错误";
      setErrorMessage(message);
      setStatus("桌面桥接失败");
    }
  }

  async function ensureChatSession(): Promise<string> {
    if (currentSessionId) {
      return currentSessionId;
    }

    const api = getDesktopApi();
    const session = await api.createChatSession();
    setCurrentSessionId(session.id);
    setChatSessions((current) => [session, ...current]);
    setChatTurns([]);
    setSelectedTurnId(null);
    return session.id;
  }

  async function handleCreateChatSession(): Promise<void> {
    try {
      const api = getDesktopApi();
      setErrorMessage("");
      const session = await api.createChatSession();
      setChatSessions((current) => [session, ...current]);
      setCurrentSessionId(session.id);
      setChatTurns([]);
      setSelectedTurnId(null);
      setAnswer(EMPTY_ANSWER);
      setLastAskedQuestion("");
      setQuestion("");
      setExpandedCitationIds([]);
      setExpandedCitationGroupLabels([]);
      setExpandedDetailSectionLabels([]);
      setScreen("chat");
      setStatus("已新建对话");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知新建对话错误";
      setErrorMessage(message);
      setStatus("新建对话失败");
    }
  }

  async function handleSelectChatSession(sessionId: string): Promise<void> {
    try {
      const api = getDesktopApi();
      const turns = await api.getChatTurns(sessionId);
      setCurrentSessionId(sessionId);
      setChatTurns(turns);
      const latestTurn = turns.at(-1) ?? null;
      setSelectedTurnId(latestTurn?.id ?? null);
      setAnswer(latestTurn?.answer ?? EMPTY_ANSWER);
      setLastAskedQuestion(latestTurn?.question ?? "");
      setExpandedCitationIds([]);
      setExpandedCitationGroupLabels([]);
      setExpandedDetailSectionLabels([]);
      setScreen("chat");
      setStatus("已切换对话");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知加载对话错误";
      setErrorMessage(message);
      setStatus("加载对话失败");
    }
  }

  async function handleDeleteChatSession(sessionId: string): Promise<void> {
    const session = chatSessions.find((item) => item.id === sessionId);
    const confirmed = window.confirm(`确认删除对话“${session?.title ?? "未命名对话"}”吗？`);
    if (!confirmed) {
      return;
    }

    try {
      const api = getDesktopApi();
      setErrorMessage("");
      setStatus("正在删除对话...");
      const snapshot = await api.deleteChatSession(sessionId);
      setDocuments(snapshot.documents);
      setSettings(snapshot.settings);
      setChatSessions(snapshot.chatSessions);
      setSystemStatus(snapshot.systemStatus);
      setAppInfo(snapshot.appInfo);

      const nextSessionId = sessionId === currentSessionId ? snapshot.chatSessions[0]?.id ?? null : currentSessionId;
      if (nextSessionId) {
        await handleSelectChatSession(nextSessionId);
      } else {
        setCurrentSessionId(null);
        setChatTurns([]);
        setSelectedTurnId(null);
        setAnswer(EMPTY_ANSWER);
        setLastAskedQuestion("");
      }

      setStatus("对话已删除");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知删除对话错误";
      setErrorMessage(message);
      setStatus("删除对话失败");
    }
  }

  async function handleClearChatSessions(): Promise<void> {
    const confirmed = window.confirm("确认清空全部对话历史吗？");
    if (!confirmed) {
      return;
    }

    try {
      const api = getDesktopApi();
      setErrorMessage("");
      setStatus("正在清空对话历史...");
      const snapshot = await api.clearChatSessions();
      setDocuments(snapshot.documents);
      setSettings(snapshot.settings);
      setChatSessions(snapshot.chatSessions);
      setSystemStatus(snapshot.systemStatus);
      setAppInfo(snapshot.appInfo);
      setCurrentSessionId(null);
      setChatTurns([]);
      setSelectedTurnId(null);
      setAnswer(EMPTY_ANSWER);
      setLastAskedQuestion("");
      setExpandedCitationIds([]);
      setExpandedCitationGroupLabels([]);
      setExpandedDetailSectionLabels([]);
      setStatus("对话历史已清空");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知清空对话错误";
      setErrorMessage(message);
      setStatus("清空对话失败");
    }
  }

  async function handleImport(): Promise<void> {
    if (libraryTaskBusy) {
      setStatus("当前已有资料库任务在执行，请等待完成");
      return;
    }

    try {
      const api = getDesktopApi();
      setErrorMessage("");
      setRecentTaskSkippedDetails([]);
      setStatus("正在打开文件选择器...");
      const result = await api.importFiles();

      if (result.imported.length === 0 && result.skipped.length === 0 && result.skippedDetails.length === 0) {
        setStatus("已取消导入");
        return;
      }

      await refreshSnapshot(currentSessionId);
      setScreen("library");
      setRecentTaskSkippedDetails(result.skippedDetails);

      const failedDetails = result.skippedDetails.filter((item) => item.disposition === "failed");
      const skippedDetails = result.skippedDetails.filter((item) => item.disposition === "skipped");

      if (failedDetails.length > 0) {
        setErrorMessage(`部分文件导入失败：${failedDetails.map((item) => `${item.filePath} [${item.code}]`).join(", ")}`);
      } else if (skippedDetails.length > 0) {
        setErrorMessage("");
      }

      setStatus(`导入完成：新增 ${result.imported.length}，跳过 ${skippedDetails.length}，失败 ${failedDetails.length}`);
    } catch (error) {
      const info = extractRendererErrorInfo(error);
      const message = info ? formatRendererError(info) : (error instanceof Error ? error.message : "未知导入错误");
      setErrorMessage(message);
      setStatus("导入失败");
    }
  }

  async function handleRetryFailedImports(): Promise<void> {
    if (libraryTaskBusy || recentFailedImports.length === 0) {
      return;
    }

    try {
      const api = getDesktopApi();
      const filePaths = recentFailedImports.map((item) => item.filePath);
      setErrorMessage("");
      setStatus(`正在重试 ${filePaths.length} 个失败文件...`);
      const result = await api.importFiles(filePaths);
      await refreshSnapshot(currentSessionId);
      setScreen("library");
      setRecentTaskSkippedDetails(result.skippedDetails);

      const failedDetails = result.skippedDetails.filter((item) => item.disposition === "failed");
      const skippedDetails = result.skippedDetails.filter((item) => item.disposition === "skipped");

      if (failedDetails.length > 0) {
        setErrorMessage(`仍有文件导入失败：${failedDetails.map((item) => `${item.filePath} [${item.code}]`).join(", ")}`);
      } else if (skippedDetails.length > 0) {
        setErrorMessage("");
      }

      setStatus(`重试完成：成功 ${result.imported.length}，跳过 ${skippedDetails.length}，失败 ${failedDetails.length}`);
    } catch (error) {
      const info = extractRendererErrorInfo(error);
      const message = info ? formatRendererError(info) : (error instanceof Error ? error.message : "未知重试错误");
      setErrorMessage(message);
      setStatus("重试失败");
    }
  }

  async function handleRepairHealthIssues(): Promise<void> {
    const documentIds = [...new Set(
      libraryHealth.issues
        .filter((issue) => issue.recommendedAction === "reindex_document")
        .map((issue) => issue.documentId)
    )];

    if (documentIds.length === 0) {
      setStatus("当前没有需要定向修复的文档");
      return;
    }

    if (libraryTaskBusy) {
      setStatus("当前已有资料库任务在执行，请等待完成");
      return;
    }

    try {
      const api = getDesktopApi();
      setStatus(`正在修复 ${documentIds.length} 个问题文档...`);
      const snapshot = await api.reindexDocuments(documentIds);
      setDocuments(snapshot.documents);
      setSettings(snapshot.settings);
      setChatSessions(snapshot.chatSessions);
      setSystemStatus(snapshot.systemStatus);
      setAppInfo(snapshot.appInfo);
      await loadLibraryHealth();
      setErrorMessage("");
      setStatus("问题文档修复完成");
    } catch (error) {
      const info = extractRendererErrorInfo(error);
      const message = info ? formatRendererError(info) : (error instanceof Error ? error.message : "未知修复错误");
      setErrorMessage(message);
      setStatus("问题文档修复失败");
    }
  }

  async function loadLibraryHealth(): Promise<void> {
    try {
      const api = getDesktopApi();
      setIsLibraryHealthLoading(true);
      const report = await api.getLibraryHealth();
      setLibraryHealth(report);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知健康检查错误";
      setErrorMessage(message);
      setStatus("资料库健康检查失败");
    } finally {
      setIsLibraryHealthLoading(false);
    }
  }

  async function handleUpdateQueryLogStatus(logId: string, statusValue: QueryLogFeedbackStatus): Promise<void> {
    try {
      const api = getDesktopApi();
      const updatedLogs = await api.updateQueryLogStatus(logId, statusValue);
      setQueryLogs(updatedLogs);
      setEvalDrafts(await api.getEvalCandidateDrafts(12));
      setStatus("日志状态已更新");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知日志更新错误";
      setErrorMessage(message);
      setStatus("日志状态更新失败");
    }
  }

  async function handleCopyEvalDraft(draft: EvalCaseDraft): Promise<void> {
    try {
      await copyTextToClipboard(renderEvalCaseDraft(draft));
      setErrorMessage("");
      setStatus("Eval Draft 已复制");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知复制错误";
      setErrorMessage(message);
      setStatus("复制 Eval Draft 失败");
    }
  }

  async function handleCopyDiagnostics(): Promise<void> {
    try {
      await copyTextToClipboard(buildDiagnosticsText(appInfo, systemStatus));
      setErrorMessage("");
      setStatus("诊断信息已复制");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知复制错误";
      setErrorMessage(message);
      setStatus("复制诊断信息失败");
    }
  }

  async function handleRemoveMissingSourceRecords(): Promise<void> {
    const documentIds = [...new Set(
      libraryHealth.issues
        .filter((issue) => issue.kind === "missing_source")
        .map((issue) => issue.documentId)
    )];

    if (documentIds.length === 0) {
      setStatus("当前没有缺失源文件记录需要清理");
      return;
    }

    const confirmed = window.confirm(`确认移除 ${documentIds.length} 个缺失源文件记录吗？这不会删除原始文件，只会清理本地索引记录。`);
    if (!confirmed) {
      return;
    }

    try {
      const api = getDesktopApi();
      const snapshot = await api.removeDocuments(documentIds);
      setDocuments(snapshot.documents);
      setSettings(snapshot.settings);
      setChatSessions(snapshot.chatSessions);
      setSystemStatus(snapshot.systemStatus);
      setAppInfo(snapshot.appInfo);
      if (selectedDocument && documentIds.includes(selectedDocument.id)) {
        setSelectedDocument(null);
        setSelectedChunks([]);
        setHighlightedChunkId(null);
        setDetailQuery("");
        setDetailQuestionMatches([]);
        setDetailSortMode("structure");
        setScreen("library");
      }
      await loadLibraryHealth();
      setStatus("缺失源文件记录已清理");
      setErrorMessage("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知清理错误";
      setErrorMessage(message);
      setStatus("清理缺失记录失败");
    }
  }

  async function handleAskQuestion(): Promise<void> {
    if (!question.trim()) {
      return;
    }

    try {
      const api = getDesktopApi();
      const sessionId = await ensureChatSession();
      setErrorMessage("");
      setExpandedCitationIds([]);
      setExpandedCitationGroupLabels([]);
      setLastAskedQuestion(question.trim());
      setIsAsking(true);
      setStatus("正在检索知识库...");
      setScreen("chat");
      window.scrollTo({ top: 0, behavior: "smooth" });
      const turn = await api.askQuestion(sessionId, question.trim());

      setChatTurns((current) => [...current, turn]);
      setSelectedTurnId(turn.id);
      setAnswer(turn.answer);
      setQuestion("");
      await refreshSnapshot(sessionId);
      setStatus("答案已生成");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知问答错误";
      setErrorMessage(message);
      setStatus("回答失败");
    } finally {
      setIsAsking(false);
    }
  }

  async function handleSelectTurn(turnId: string): Promise<void> {
    const turn = chatTurns.find((item) => item.id === turnId);
    if (!turn) {
      return;
    }

    setSelectedTurnId(turnId);
    setAnswer(turn.answer);
    setLastAskedQuestion(turn.question);
    setExpandedCitationIds([]);
    setExpandedCitationGroupLabels([]);
    setStatus("已切换问答记录");
  }

  async function handleSelectDocument(document: DocumentRecord): Promise<void> {
    try {
      const api = getDesktopApi();
      const chunks = await api.getDocumentChunks(document.id);
      setSelectedDocument(document);
      setSelectedChunks(chunks);
      setHighlightedChunkId(null);
      setDetailQuery("");
      setDetailQuestionMatches([]);
      setDetailSortMode("structure");
      setExpandedDetailSectionLabels([]);
      setScreen("detail");
      setErrorMessage("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知文档错误";
      setErrorMessage(message);
      setStatus("文档加载失败");
    }
  }

  async function handleReindex(): Promise<void> {
    if (libraryTaskBusy) {
      setStatus("当前已有资料库任务在执行，请等待完成");
      return;
    }

    try {
      const api = getDesktopApi();
      setErrorMessage("");
      setRecentTaskSkippedDetails([]);
      setStatus("正在重建索引...");
      const snapshot = await api.reindexLibrary();
      setDocuments(snapshot.documents);
      setSettings(snapshot.settings);
      setChatSessions(snapshot.chatSessions);
      setSystemStatus(snapshot.systemStatus);
      setAppInfo(snapshot.appInfo);
      setStatus("重建索引完成");
    } catch (error) {
      const info = extractRendererErrorInfo(error);
      const message = info ? formatRendererError(info) : (error instanceof Error ? error.message : "未知重建索引错误");
      setErrorMessage(message);
      setStatus("重建索引失败");
    }
  }

  async function handleDeleteDocument(documentId: string, title: string): Promise<void> {
    if (libraryTaskBusy) {
      setStatus("当前已有资料库任务在执行，请等待完成");
      return;
    }

    const confirmed = window.confirm(`确认删除文档“${title}”吗？这会同时删除它的索引内容。`);
    if (!confirmed) {
      return;
    }

    try {
      const api = getDesktopApi();
      setErrorMessage("");
      setStatus("正在删除文档...");
      const snapshot = await api.deleteDocument(documentId);
      setDocuments(snapshot.documents);
      setSettings(snapshot.settings);
      setChatSessions(snapshot.chatSessions);
      setSystemStatus(snapshot.systemStatus);
      setAppInfo(snapshot.appInfo);
      if (selectedDocument?.id === documentId) {
        setSelectedDocument(null);
        setSelectedChunks([]);
        setHighlightedChunkId(null);
        setDetailQuery("");
        setDetailQuestionMatches([]);
        setDetailSortMode("structure");
        setScreen("library");
      }
      setStatus("文档已删除");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知删除错误";
      setErrorMessage(message);
      setStatus("删除失败");
    }
  }

  async function handleClearLibrary(): Promise<void> {
    if (libraryTaskBusy) {
      setStatus("当前已有资料库任务在执行，请等待完成");
      return;
    }

    const confirmed = window.confirm("确认清空整个资料库吗？这会删除所有已导入文档及其索引，并清空现有问答历史。");
    if (!confirmed) {
      return;
    }

    try {
      const api = getDesktopApi();
      setErrorMessage("");
      setStatus("正在清空资料库...");
      await api.clearChatSessions();
      const snapshot = await api.clearLibrary();
      setDocuments(snapshot.documents);
      setSettings(snapshot.settings);
      setChatSessions([]);
      setSystemStatus(snapshot.systemStatus);
      setAppInfo(snapshot.appInfo);
      setSelectedDocument(null);
      setSelectedChunks([]);
      setHighlightedChunkId(null);
      setDetailQuery("");
      setDetailQuestionMatches([]);
      setDetailSortMode("structure");
      setCurrentSessionId(null);
      setChatTurns([]);
      setSelectedTurnId(null);
      setAnswer(EMPTY_ANSWER);
      setExpandedCitationIds([]);
      setExpandedCitationGroupLabels([]);
      setExpandedDetailSectionLabels([]);
      setLastAskedQuestion("");
      setQuestion("");
      setScreen("library");
      setStatus("资料库已清空");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知清空错误";
      setErrorMessage(message);
      setStatus("清空资料库失败");
    }
  }

  async function handleSettingsChange(next: Partial<AppSettings>): Promise<void> {
    try {
      const api = getDesktopApi();
      setErrorMessage("");
      const updated = await api.updateSettings(next);
      setSettings(updated);
      setStatus("设置已保存");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知设置错误";
      setErrorMessage(message);
      setStatus("设置保存失败");
    }
  }

  function handleSelectDetailChunk(chunkId: string): void {
    setHighlightedChunkId(chunkId);
  }

  async function handleOpenDocumentAtLocation(filePath: string, pageNumber?: number | null): Promise<void> {
    try {
      const api = getDesktopApi();
      await api.openDocumentAtLocation(filePath, pageNumber);
      setErrorMessage("");
      setStatus(pageNumber ? `已打开原文并尝试跳转到第 ${pageNumber} 页` : "已打开原文");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知原文打开错误";
      setErrorMessage(message);
      setStatus("打开原文失败");
    }
  }

  async function handleOpenCitationOriginal(citation: Citation): Promise<void> {
    try {
      const api = getDesktopApi();
      const document = await api.getDocument(citation.documentId);
      if (!document) {
        setStatus("引用来源文档不存在或已被删除");
        return;
      }

      await handleOpenDocumentAtLocation(document.filePath, citation.pageStart ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知引用原文打开错误";
      setErrorMessage(message);
      setStatus("打开引用原文失败");
    }
  }

  async function handleOpenCitationContext(citation: Citation): Promise<void> {
    try {
      const api = getDesktopApi();
      const document = await api.getDocument(citation.documentId);
      if (!document) {
        setStatus("引用来源文档不存在或已被删除");
        return;
      }

      const chunks = await api.getDocumentChunks(document.id);
      setSelectedDocument(document);
      setSelectedChunks(chunks);
      setHighlightedChunkId(citation.chunkId);
      setDetailQuery("");
      setDetailSortMode(currentDetailQuestion ? "question" : "structure");
      setExpandedDetailSectionLabels([]);
      setScreen("detail");
      setErrorMessage("");
      setStatus("已打开引用来源上下文");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知来源上下文错误";
      setErrorMessage(message);
      setStatus("打开引用来源失败");
    }
  }

  async function handleOpenCitationGroupContext(citations: Citation[], sectionRootLabel: string | null): Promise<void> {
    const firstCitation = citations[0];
    if (!firstCitation) {
      return;
    }

    try {
      const api = getDesktopApi();
      const document = await api.getDocument(firstCitation.documentId);
      if (!document) {
        setStatus("引用来源文档不存在或已被删除");
        return;
      }

      const chunks = await api.getDocumentChunks(document.id);
      const relatedChunkIds = new Set(
        citations
          .filter((citation) => citation.documentId === document.id)
          .map((citation) => citation.chunkId)
      );
      const firstMatchingChunk = chunks.find((chunk) => relatedChunkIds.has(chunk.id))
        ?? chunks.find((chunk) => extractSectionRootLabel(chunk.sectionPath) === sectionRootLabel)
        ?? chunks[0]
        ?? null;

      setSelectedDocument(document);
      setSelectedChunks(chunks);
      setHighlightedChunkId(firstMatchingChunk?.id ?? null);
      setDetailQuery(sectionRootLabel ?? "");
      setDetailSortMode(currentDetailQuestion ? "question" : "structure");
      setExpandedDetailSectionLabels(sectionRootLabel ? [sectionRootLabel] : []);
      setScreen("detail");
      setErrorMessage("");
      setStatus(sectionRootLabel ? `已打开章节上下文：${sectionRootLabel}` : "已打开章节上下文");
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知章节上下文错误";
      setErrorMessage(message);
      setStatus("打开章节上下文失败");
    }
  }

  function toggleCitation(chunkId: string): void {
    setExpandedCitationIds((current) =>
      current.includes(chunkId)
        ? current.filter((id) => id !== chunkId)
        : [chunkId]
    );
  }

  function toggleCitationGroup(groupKey: string): void {
    setExpandedCitationGroupLabels((current) =>
      current.includes(groupKey)
        ? current.filter((key) => key !== groupKey)
        : [...current, groupKey]
    );
  }

  function toggleDetailSectionGroup(label: string | null): void {
    if (!label) {
      return;
    }

    setExpandedDetailSectionLabels((current) =>
      current.includes(label)
        ? current.filter((item) => item !== label)
        : [...current, label]
    );
  }

  function clearCurrentAnswer(): void {
    setSelectedTurnId(null);
    setAnswer(EMPTY_ANSWER);
    setExpandedCitationIds([]);
    setExpandedCitationGroupLabels([]);
    setExpandedDetailSectionLabels([]);
    setLastAskedQuestion("");
    setErrorMessage("");
    setStatus("当前问答已清空");
  }

  const displayedAnswer = selectedTurn?.answer ?? answer;
  const taskProgressPercent = libraryTaskProgress && libraryTaskProgress.total > 0
    ? Math.min(100, Math.round((libraryTaskProgress.current / libraryTaskProgress.total) * 100))
    : 0;
  const citationGroups = displayedAnswer.citations.reduce<Array<{ label: string | null; items: Citation[] }>>((groups, citation) => {
    const label = citation.sectionRootLabel ?? null;
    const existing = groups.find((group) => group.label === label);
    if (existing) {
      existing.items.push(citation);
      return groups;
    }

    groups.push({ label, items: [citation] });
    return groups;
  }, []);
  const citationGroupCards = citationGroups.map((group) => ({
    ...group,
    summary: buildCitationGroupSummary(group.items),
    sectionTitles: collectCitationSectionTitles(group.items)
  }));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">本地优先 RAG</p>
          <h1>个人知识库 RAG</h1>
          <p className="muted">面向 macOS 的本地知识库桌面应用，支持可核查引用的问答。</p>
        </div>

        <nav className="nav">
          <button className={screen === "library" ? "active" : ""} onClick={() => setScreen("library")}>资料库</button>
          <button className={screen === "chat" ? "active" : ""} onClick={() => setScreen("chat")}>问答</button>
          <button className={screen === "settings" ? "active" : ""} onClick={() => setScreen("settings")}>设置</button>
        </nav>

        <div className="sidebar-actions">
          <button onClick={() => void handleImport()} disabled={libraryTaskBusy}>导入文件</button>
          <button onClick={() => void handleCreateChatSession()} className="secondary">新建对话</button>
          <button onClick={() => void handleReindex()} className="secondary" disabled={libraryTaskBusy}>重建索引</button>
          <button onClick={() => void handleClearLibrary()} className="secondary" disabled={libraryTaskBusy}>清空资料库</button>
        </div>

        <section className="status-card">
          <p className="eyebrow">状态</p>
          <strong>{status}</strong>
          <p className="muted">已索引 {systemStatus.documentCount} 个文档 / {systemStatus.chunkCount} 个片段</p>
          {libraryTaskProgress && (
            <div className="task-progress-card">
              <div className="task-progress-meta">
                <span>{libraryTaskProgress.kind === "import" ? "导入任务" : "重建索引"}</span>
                <span>{libraryTaskProgress.current} / {libraryTaskProgress.total}</span>
              </div>
              <div className="task-progress-bar" aria-hidden="true">
                <div className="task-progress-fill" style={{ width: `${taskProgressPercent}%` }} />
              </div>
              <p className="muted">{libraryTaskProgress.message}</p>
              {libraryTaskProgress.currentFile && (
                <p className="muted task-current-file">{libraryTaskProgress.currentFile}</p>
              )}
              <p className="muted">
                成功 {libraryTaskProgress.succeeded} / 跳过 {libraryTaskProgress.skipped} / 失败 {libraryTaskProgress.failed}
              </p>
            </div>
          )}
          <p className="muted">
            语义检索模型：
            {systemStatus.embeddingAvailable ? "已就绪" : "未就绪"}
          </p>
          {!systemStatus.embeddingAvailable && systemStatus.embeddingReason && (
            <p className="error-text">模型状态：{systemStatus.embeddingReason}</p>
          )}
          {(recentFailedImports.length > 0 || recentSkippedImports.length > 0) && (
            <div className="task-issues">
              <p className="eyebrow">最近导入记录</p>
              {recentFailedImports.length > 0 && (
                <>
                  <div className="log-actions">
                    <button type="button" className="secondary" disabled={libraryTaskBusy} onClick={() => void handleRetryFailedImports()}>
                      重试失败文件
                    </button>
                  </div>
                  {recentFailedImports.slice(0, 3).map((item) => (
                    <p key={`${item.filePath}-${item.reason}`} className="error-text">
                      {item.filePath}: {formatImportIssueSummary(item)}
                    </p>
                  ))}
                </>
              )}
              {recentSkippedImports.length > 0 && (
                <>
                  {recentSkippedImports.slice(0, 2).map((item) => (
                    <p key={`${item.filePath}-${item.reason}`} className="muted">
                      已跳过：{item.filePath} · {formatImportIssueSummary(item)}
                    </p>
                  ))}
                </>
              )}
            </div>
          )}
          {errorMessage && <p className="error-text">{errorMessage}</p>}
        </section>

        <section className="status-card session-panel">
          <div className="panel-header compact-header">
            <div>
              <p className="eyebrow">对话历史</p>
              <strong>{chatSessions.length} 个会话</strong>
            </div>
            {chatSessions.length > 0 && (
              <button type="button" className="secondary session-clear" onClick={() => void handleClearChatSessions()}>
                清空
              </button>
            )}
          </div>
          <div className="session-list">
            {chatSessions.length === 0 && <p className="muted">还没有历史对话。可以先提一个问题。</p>}
            {chatSessions.map((session) => (
              <div key={session.id} className={`session-card ${session.id === currentSessionId ? "active-session" : ""}`}>
                <button type="button" className="session-main" onClick={() => void handleSelectChatSession(session.id)}>
                  <strong>{session.title}</strong>
                  <p>{session.lastQuestion ?? "尚无提问记录"}</p>
                  <span>{new Date(session.updatedAt).toLocaleString()}</span>
                </button>
                <button type="button" className="session-delete" onClick={() => void handleDeleteChatSession(session.id)}>
                  删除
                </button>
              </div>
            ))}
          </div>
        </section>
      </aside>

      <main className="content">
        <section className="hero-card">
          <div>
            <p className="eyebrow">向你的资料库提问</p>
            <h2>从本地文件中得到带引用的答案</h2>
          </div>
          <div className="hero-form">
            <textarea
              rows={3}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="输入一个问题，查询你已导入的笔记、PDF 和文档..."
            />
            <button onClick={() => void handleAskQuestion()} disabled={isAsking || !question.trim()}>
              {isAsking ? "处理中..." : "提问"}
            </button>
          </div>
        </section>

        {screen === "library" && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">资料库</p>
                <h3>已导入文档</h3>
              </div>
              <span>{filteredDocuments.length} / {documents.length} 个文件</span>
            </div>
            <div className="library-toolbar">
              <input
                value={libraryQuery}
                onChange={(event) => setLibraryQuery(event.target.value)}
                placeholder="搜索标题、文件名或路径..."
              />
              <select
                value={libraryTypeFilter}
                onChange={(event) => setLibraryTypeFilter(event.target.value as SupportedFileType | "all")}
              >
                <option value="all">全部类型</option>
                <option value="pdf">PDF</option>
                <option value="md">Markdown</option>
                <option value="txt">TXT</option>
                <option value="docx">DOCX</option>
              </select>
            </div>
            <div className="document-list">
              {filteredDocuments.length === 0 && <p className="muted">没有匹配的文档。可以调整筛选条件或继续导入文件。</p>}
              {filteredDocuments.map((document) => (
                <div key={document.id} className="document-card document-card-shell">
                  <button className="document-card-main" onClick={() => void handleSelectDocument(document)}>
                    <div>
                      <strong>{document.title}</strong>
                      <p>{document.fileName} • {document.fileType.toUpperCase()} • {document.chunkCount} 个片段</p>
                    </div>
                    <span>{new Date(document.sourceUpdatedAt ?? document.updatedAt).toLocaleString()}</span>
                  </button>
                  <button
                    type="button"
                    className="document-delete"
                    onClick={() => void handleDeleteDocument(document.id, document.title)}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {screen === "chat" && (
          <section className="panel panel-grid">
            <div>
              <div className="panel-header">
                <div>
                  <p className="eyebrow">问答</p>
                  <h3>回答</h3>
                  {lastAskedQuestion && <p className="muted">当前问题：{lastAskedQuestion}</p>}
                </div>
                <button type="button" className="secondary" onClick={clearCurrentAnswer}>清空当前问答</button>
              </div>

              <div className="turn-list">
                {chatTurns.map((turn) => (
                  <button
                    key={turn.id}
                    type="button"
                    className={`turn-card ${turn.id === selectedTurnId ? "active-turn" : ""}`}
                    onClick={() => void handleSelectTurn(turn.id)}
                  >
                    <strong>{turn.question}</strong>
                    <span>{new Date(turn.createdAt).toLocaleString()}</span>
                  </button>
                ))}
              </div>

              {isAsking ? (
                <div className="answer-summary">
                  <p className="eyebrow">处理中</p>
                  <p className="direct-answer">正在根据当前问题检索文档、排序证据并生成回答...</p>
                </div>
              ) : displayedAnswer.directAnswer ? (
                <div className="answer-layout">
                  <div className="answer-summary">
                    <p className="eyebrow">直接答案</p>
                    <p className="direct-answer">{displayedAnswer.directAnswer}</p>
                    <p className="muted">
                      {displayedAnswer.basedOnSingleDocument
                        ? "基于 1 个文档"
                        : `基于 ${displayedAnswer.sourceDocumentCount} 个文档`}
                    </p>
                  </div>
                  <div className="support-panel">
                    <p className="eyebrow">关键支撑点</p>
                    <div className="support-list">
                      {displayedAnswer.supportingPoints.map((point, index) => (
                        <p key={`${index}-${point}`}>{index + 1}. {point}</p>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <pre className="answer-box">输入一个问题，系统会在你的知识库中检索并生成回答。</pre>
              )}
            </div>
            <div>
              <div className="panel-header">
                <div>
                  <p className="eyebrow">引用</p>
                  <h3>来源片段</h3>
                </div>
              </div>
              <div className="citation-list">
                {citationGroupCards.map((group, groupIndex) => {
                  const groupKey = buildCitationGroupKey(group.label, groupIndex);
                  const groupExpanded = group.items.length <= 1 || expandedCitationGroupLabels.includes(groupKey);

                  return (
                  <div key={groupKey} className="citation-group">
                    {group.label && group.items.length > 1 && (
                      <div className="citation-group-header">
                        <p className="eyebrow">章节范围</p>
                        <strong>{group.label}</strong>
                        <span>{group.items.length} 条相关依据</span>
                        <p className="citation-group-summary">{group.summary}</p>
                        {group.sectionTitles.length > 0 && (
                          <div className="citation-group-tags">
                            {group.sectionTitles.map((title) => (
                              <span key={`${group.label}-${title}`} className="citation-group-tag">{title}</span>
                            ))}
                          </div>
                        )}
                        <div className="log-actions citation-group-actions">
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => void handleOpenCitationGroupContext(group.items, group.label)}
                          >
                            查看整节上下文
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => toggleCitationGroup(groupKey)}
                          >
                            {groupExpanded ? "收起子节依据" : "展开子节依据"}
                          </button>
                        </div>
                      </div>
                    )}
                    {groupExpanded && group.items.map((citation) => (
                      <article key={citation.chunkId} className="citation-card">
                        <header className="citation-header">
                          <div>
                            <strong>{citation.documentTitle}</strong>
                            <p>{citation.fileName}</p>
                          </div>
                          <span>{citation.anchorLabel ?? citation.locatorLabel ?? `Chunk ${citation.chunkIndex + 1}`}</span>
                        </header>
                        <div className="citation-meta">
                          <span>{citation.sectionTitle ?? "通用内容"}</span>
                          {citation.anchorLabel && <span>{citation.anchorLabel}</span>}
                          {!citation.anchorLabel && citation.locatorLabel && <span>{citation.locatorLabel}</span>}
                          {citation.sourceUpdatedAt && <span>更新于 {new Date(citation.sourceUpdatedAt).toLocaleDateString()}</span>}
                        </div>
                        {citation.evidenceText && (
                          <p className="citation-anchor">
                            {citation.anchorLabel ? `锚点证据 · ${citation.anchorLabel}：` : "锚点证据："}
                            {citation.evidenceText}
                          </p>
                        )}
                        <p className="citation-body">{citation.snippet}</p>
                        <div className="log-actions">
                          <button type="button" className="secondary" onClick={() => void handleOpenCitationContext(citation)}>
                            查看来源上下文
                          </button>
                          <button type="button" className="secondary" onClick={() => void handleOpenCitationOriginal(citation)}>
                            {citation.pageStart ? `打开原文到 p.${citation.pageStart}` : "打开原文"}
                          </button>
                        </div>
                        <button
                          type="button"
                          className="citation-toggle"
                          onClick={() => toggleCitation(citation.chunkId)}
                        >
                          {expandedCitationIds.includes(citation.chunkId) ? "收起完整 Chunk" : "展开完整 Chunk"}
                        </button>
                        {expandedCitationIds.includes(citation.chunkId) && (
                          <pre className="citation-full-text">
                            {renderHighlightedText(citation.fullText, citation.highlightStart, citation.highlightEnd)}
                          </pre>
                        )}
                      </article>
                    ))}
                  </div>
                )})}
              </div>
            </div>
          </section>
        )}

        {screen === "detail" && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">文档详情</p>
                <h3>{selectedDocument?.title ?? "文档"}</h3>
              </div>
              {selectedDocument && (
                <div className="log-actions detail-open-actions">
                  {selectedDetailChunk?.pageStart && (
                    <button
                      className="secondary"
                      onClick={() => void handleOpenDocumentAtLocation(selectedDocument.filePath, selectedDetailChunk.pageStart ?? null)}
                    >
                      打开原文到 p.{selectedDetailChunk.pageStart}
                    </button>
                  )}
                  <button className="secondary" onClick={() => void handleOpenDocumentAtLocation(selectedDocument.filePath)}>
                    打开原始文件
                  </button>
                </div>
              )}
            </div>
            <div className="library-toolbar">
              <input
                value={detailQuery}
                onChange={(event) => setDetailQuery(event.target.value)}
                placeholder="在当前文档中搜索标题或内容..."
              />
              <div className="detail-toolbar-actions">
                <div className="settings-note">
                  {visibleDetailChunks.length} / {selectedChunks.length} 个片段
                </div>
                {currentDetailQuestion && (
                  <div className="detail-mode-toggle" role="tablist" aria-label="详情视图模式">
                    <button
                      type="button"
                      className={detailSortMode === "structure" ? "secondary active-detail-mode" : "secondary"}
                      onClick={() => setDetailSortMode("structure")}
                    >
                      结构浏览
                    </button>
                    <button
                      type="button"
                      className={detailSortMode === "question" ? "secondary active-detail-mode" : "secondary"}
                      onClick={() => setDetailSortMode("question")}
                    >
                      当前问题相关
                    </button>
                  </div>
                )}
              </div>
            </div>
            {selectedDetailChunk && selectedDocument && (
              <div className="answer-layout detail-preview-layout">
                <div className="answer-summary">
                  <p className="eyebrow">源文预览</p>
                  <p className="direct-answer">
                    {renderSourceExcerpt(selectedDocument.content, selectedDetailChunk.startOffset, selectedDetailChunk.endOffset)}
                  </p>
                  <p className="muted">
                    当前位置：{selectedDetailChunk.locatorLabel ?? `Chunk ${selectedDetailChunk.chunkIndex + 1}`}
                  </p>
                  {selectedDetailQuestionMatch && (
                    <div className="citation-anchor detail-question-evidence">
                      <strong>问题相关证据 · {formatQuestionMatchScore(selectedDetailQuestionMatch.score)}</strong>
                      <p>{selectedDetailQuestionMatch.evidenceText ?? selectedDetailQuestionMatch.snippet}</p>
                    </div>
                  )}
                  <p className="muted">
                    偏移：{selectedDetailChunk.startOffset} - {selectedDetailChunk.endOffset}
                  </p>
                </div>
                <div className="support-panel">
                  <p className="eyebrow">片段导航</p>
                  <div className="support-list">
                    <p>当前章节：{selectedDetailChunk.sectionTitle ?? "通用内容"}</p>
                    <p>路径：{selectedDetailChunk.sectionPath ?? "无层级路径"}</p>
                    <p>Token 数：{selectedDetailChunk.tokenCount}</p>
                    {selectedDetailChunk.pageStart && <p>页码：p.{selectedDetailChunk.pageStart}{selectedDetailChunk.pageEnd && selectedDetailChunk.pageEnd !== selectedDetailChunk.pageStart ? ` - p.${selectedDetailChunk.pageEnd}` : ""}</p>}
                    {selectedDetailSectionRoot && <p>父章节：{selectedDetailSectionRoot}</p>}
                    {currentDetailQuestion && <p>当前问题：{currentDetailQuestion}</p>}
                  </div>
                </div>
              </div>
            )}
            {currentDetailQuestion && (
              <div className="detail-section-nav detail-question-panel">
                <div className="panel-header compact-header">
                  <div>
                    <p className="eyebrow">相关性视图</p>
                    <strong>{currentDetailQuestion}</strong>
                  </div>
                  <span>{isDetailQuestionLoading ? "正在分析..." : `命中 ${detailQuestionMatches.length} 个高相关片段`}</span>
                </div>
                {detailQuestionMatches.length > 0 ? (
                  <div className="detail-section-list">
                    {topQuestionMatches.map((match) => (
                      <button
                        key={`question-match-${match.chunkId}`}
                        type="button"
                        className={`detail-section-item ${match.chunkId === selectedDetailChunk?.id ? "active-turn" : ""}`}
                        onClick={() => {
                          setDetailSortMode("question");
                          handleSelectDetailChunk(match.chunkId);
                        }}
                      >
                        <strong>{match.sectionTitle ?? match.locatorLabel ?? `Chunk ${match.chunkIndex + 1}`}</strong>
                        <span>{match.anchorLabel ?? match.locatorLabel ?? `Chunk ${match.chunkIndex + 1}`} · 相关度 {formatQuestionMatchScore(match.score)}</span>
                        <span>{normalizeInlineText(match.evidenceText ?? match.snippet)}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="muted">当前问题还没有命中足够强的文档片段，可以先用结构浏览继续查看原文。</p>
                )}
              </div>
            )}
            {selectedDetailSectionRoot && relatedSectionChunks.length > 1 && (
              <div className="detail-section-nav">
                <div className="panel-header compact-header">
                  <div>
                    <p className="eyebrow">章节导航</p>
                    <strong>{selectedDetailSectionRoot}</strong>
                  </div>
                  <span>{relatedSectionChunks.length} 个相关片段</span>
                </div>
                {relatedSectionTitles.length > 0 && (
                  <div className="citation-group-tags detail-section-tags">
                    {relatedSectionTitles.map((title) => (
                      <span key={`${selectedDetailSectionRoot}-${title}`} className="citation-group-tag">{title}</span>
                    ))}
                  </div>
                )}
                <div className="detail-section-list">
                  {relatedSectionChunks.map((chunk) => (
                    <button
                      key={`section-nav-${chunk.id}`}
                      type="button"
                      className={`detail-section-item ${chunk.id === selectedDetailChunk?.id ? "active-turn" : ""}`}
                      onClick={() => handleSelectDetailChunk(chunk.id)}
                    >
                      <strong>{chunk.sectionTitle ?? chunk.locatorLabel ?? `Chunk ${chunk.chunkIndex + 1}`}</strong>
                      <span>{chunk.locatorLabel ?? `Chunk ${chunk.chunkIndex + 1}`}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="detail-meta">
              <span>{selectedDocument?.fileType?.toUpperCase() ?? "未知"}</span>
              <span>{selectedDocument?.chunkCount ?? 0} 个片段</span>
              {selectedDocument?.sourceUpdatedAt && <span>更新于 {new Date(selectedDocument.sourceUpdatedAt).toLocaleString()}</span>}
              <span>{selectedDocument?.filePath}</span>
            </div>
            <div className="chunk-list">
              {detailChunkGroups.map((group, groupIndex) => {
                const groupKey = buildCitationGroupKey(group.label, groupIndex);
                const isExpanded = !group.label || group.items.length <= 1 || expandedDetailSectionLabels.includes(group.label);

                return (
                  <div key={`detail-${groupKey}`} className="detail-chunk-group">
                    {group.label && group.items.length > 1 && (
                      <div className="detail-chunk-group-header">
                        <div>
                          <p className="eyebrow">父章节</p>
                          <strong>{group.label}</strong>
                        </div>
                        <div className="detail-chunk-group-actions">
                          <span>{group.items.length} 个片段</span>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => toggleDetailSectionGroup(group.label)}
                          >
                            {isExpanded ? "收起本节" : "展开本节"}
                          </button>
                        </div>
                      </div>
                    )}
                    {isExpanded && group.items.map((chunk) => (
                      <article
                        key={chunk.id}
                        id={`chunk-${chunk.id}`}
                        className={`chunk-card detail-chunk-card ${(chunk.id === highlightedChunkId || (!highlightedChunkId && chunk.id === selectedDetailChunk?.id)) ? "highlighted-chunk" : ""}`}
                        onClick={() => handleSelectDetailChunk(chunk.id)}
                      >
                        <header>
                          <strong>{chunk.locatorLabel ?? `Chunk ${chunk.chunkIndex + 1}`}</strong>
                          <span>
                            {detailQuestionMatchMap.get(chunk.id)
                              ? `相关度 ${formatQuestionMatchScore(detailQuestionMatchMap.get(chunk.id)?.score ?? 0)}`
                              : `${chunk.tokenCount} 个 tokens`}
                          </span>
                        </header>
                        <div className="citation-meta">
                          <span>{chunk.sectionTitle ?? "通用内容"}</span>
                          {chunk.sectionPath && <span>{chunk.sectionPath}</span>}
                          {chunk.pageStart && <span>p.{chunk.pageStart}</span>}
                        </div>
                        {detailQuestionMatchMap.get(chunk.id)?.evidenceText && (
                          <p className="citation-anchor">
                            证据句：{detailQuestionMatchMap.get(chunk.id)?.evidenceText}
                          </p>
                        )}
                        <p>{chunk.text}</p>
                      </article>
                    ))}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {screen === "settings" && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">设置</p>
                <h3>索引控制</h3>
              </div>
            </div>
            <div className="settings-grid">
              <label>
                <span>Chunk 大小</span>
                <input
                  type="number"
                  min={60}
                  max={400}
                  value={settings.chunkSize}
                  onChange={(event) => void handleSettingsChange({ chunkSize: Number(event.target.value) })}
                />
              </label>
              <label>
                <span>Chunk 重叠</span>
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={settings.chunkOverlap}
                  onChange={(event) => void handleSettingsChange({ chunkOverlap: Number(event.target.value) })}
                />
              </label>
              <div className="settings-note">
                当前版本已经支持文档管理、会话历史、混合检索、定位型 citation，以及真实 query log 留存。后续仍可继续增强模型缓存、导入进度和更强的本地语义检索。
              </div>
              <div className="settings-note">版本：{appInfo.version} · 平台：{appInfo.platform}</div>
              <div className="settings-note">数据目录：{appInfo.userDataPath}</div>
              <div className="settings-note">本地数据库：{appInfo.databasePath}</div>
              <button type="button" className="secondary" onClick={() => void handleCopyDiagnostics()}>
                复制诊断信息
              </button>
            </div>
            <div className="panel-header" style={{ marginTop: 24 }}>
              <div>
                <p className="eyebrow">资料库健康</p>
                <h3>健康检查与修复</h3>
              </div>
              <div className="log-actions">
                <button type="button" className="secondary" onClick={() => void loadLibraryHealth()} disabled={isLibraryHealthLoading}>
                  {isLibraryHealthLoading ? "检查中..." : "刷新检查"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void handleRemoveMissingSourceRecords()}
                  disabled={isLibraryHealthLoading || libraryHealth.summary.missingSourceCount === 0}
                >
                  清理缺失源文件记录
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void handleRepairHealthIssues()}
                  disabled={isLibraryHealthLoading || libraryTaskBusy || libraryHealth.summary.reindexNeededCount === 0}
                >
                  修复问题文档
                </button>
              </div>
            </div>
            <div className="answer-layout">
              <div className="answer-summary">
                <p className="eyebrow">概览</p>
                <p className="direct-answer">{libraryHealth.summary.issueCount === 0 ? "资料库健康状态良好" : `发现 ${libraryHealth.summary.issueCount} 条健康问题`}</p>
                <p className="muted">文档总数：{libraryHealth.summary.totalDocuments}</p>
                <p className="muted">缺失源文件：{libraryHealth.summary.missingSourceCount}</p>
                <p className="muted">建议重建索引的文档：{libraryHealth.summary.reindexNeededCount}</p>
              </div>
              <div className="support-panel">
                <p className="eyebrow">建议操作</p>
                <div className="support-list">
                  <p>1. 源文件缺失时，优先清理无效记录或重新导入。</p>
                  <p>2. 出现“源文件已更新”或“配置不一致”时，直接执行一次重建索引。</p>
                  <p>3. 如果健康检查为空但检索异常，可先复制诊断信息再进一步排查。</p>
                </div>
              </div>
            </div>
            <div className="chunk-list">
              {libraryHealth.issues.length === 0 && !isLibraryHealthLoading && (
                <p className="muted">当前未发现需要处理的资料库健康问题。</p>
              )}
              {libraryHealth.issues.map((issue, index) => (
                <article key={`${issue.documentId}-${issue.kind}-${index}`} className={`chunk-card health-issue ${issue.severity === "error" ? "health-issue-error" : "health-issue-warning"}`}>
                  <header>
                    <strong>{issue.documentTitle}</strong>
                    <span>{issue.fileName}</span>
                  </header>
                  <div className="citation-meta">
                    <span>{issue.kind}</span>
                    <span>{issue.severity === "error" ? "错误" : "警告"}</span>
                    <span>建议：{issue.recommendedAction === "remove_document" ? "清理记录" : "重建索引"}</span>
                  </div>
                  <p>{issue.detail}</p>
                </article>
              ))}
            </div>
            <div className="panel-header" style={{ marginTop: 24 }}>
              <div>
                <p className="eyebrow">日志闭环</p>
                <h3>最近真实提问</h3>
              </div>
              <span>{queryLogs.length} 条</span>
            </div>
            <div className="chunk-list">
              {queryLogs.length === 0 && <p className="muted">还没有真实提问日志。进入聊天页提问后，这里会自动沉淀检索与 citation 快照。</p>}
              {queryLogs.map((log) => (
                <article key={log.id} className="chunk-card">
                  <header>
                    <strong>{log.question}</strong>
                    <span>{new Date(log.createdAt).toLocaleString()}</span>
                  </header>
                  <div className="citation-meta">
                    <span>状态：{log.feedbackStatus}</span>
                    <span>{log.citations.length} 条 citation</span>
                  </div>
                  <p>{log.answer.directAnswer || "暂无直接答案"}</p>
                  <div className="log-actions">
                    <button type="button" className="secondary" onClick={() => void handleUpdateQueryLogStatus(log.id, "benchmark_candidate")}>
                      标记为评测候选
                    </button>
                    <button type="button" className="secondary" onClick={() => void handleUpdateQueryLogStatus(log.id, "promoted")}>
                      标记已转评测
                    </button>
                    <button type="button" className="secondary" onClick={() => void handleUpdateQueryLogStatus(log.id, "ignored")}>
                      忽略
                    </button>
                  </div>
                  {log.citations[0] && (
                    <p className="muted">
                      首条依据：{log.citations[0].documentTitle}
                      {(log.citations[0].anchorLabel ?? log.citations[0].locatorLabel)
                        ? ` · ${log.citations[0].anchorLabel ?? log.citations[0].locatorLabel}`
                        : ""}
                    </p>
                  )}
                </article>
              ))}
            </div>
            <div className="panel-header" style={{ marginTop: 24 }}>
              <div>
                <p className="eyebrow">评测候选</p>
                <h3>自动生成的 Eval Draft</h3>
              </div>
              <span>{evalDrafts.length} 条</span>
            </div>
            <div className="chunk-list">
              {evalDrafts.length === 0 && <p className="muted">把真实日志标记为“评测候选”后，这里会自动生成可转入 benchmark 的草稿。</p>}
              {evalDrafts.map((draft) => (
                <article key={draft.id} className="chunk-card">
                  <header>
                    <strong>{draft.question}</strong>
                    <span>{draft.category}</span>
                  </header>
                  <div className="citation-meta">
                    <span>topK {draft.expectation.topK}</span>
                    {draft.expectation.fileNameIncludes && <span>{draft.expectation.fileNameIncludes}</span>}
                  </div>
                  <div className="log-actions">
                    <button type="button" className="secondary" onClick={() => void handleCopyEvalDraft(draft)}>
                      复制草稿
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void handleUpdateQueryLogStatus(draft.sourceLogId, "promoted")}
                    >
                      标记原日志已转评测
                    </button>
                  </div>
                  <pre className="citation-full-text">{renderEvalCaseDraft(draft)}</pre>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

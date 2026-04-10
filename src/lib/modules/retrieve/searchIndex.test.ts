import { describe, expect, it } from "vitest";
import { searchChunks } from "./searchIndex";
import type { ChunkRecord, DocumentRecord } from "../../shared/types";

describe("searchChunks", () => {
  it("returns the most relevant chunk first", () => {
    const documents: DocumentRecord[] = [
      {
        id: "doc-1",
        filePath: "/tmp/notes.md",
        fileName: "notes.md",
        title: "Architecture Notes",
        fileType: "md",
        content: "",
        importedAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        sourceCreatedAt: "2026-03-31T00:00:00.000Z",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        chunkCount: 2
      },
      {
        id: "doc-2",
        filePath: "/tmp/recent.md",
        fileName: "recent.md",
        title: "Recent Product Update",
        fileType: "md",
        content: "",
        importedAt: "2026-04-02T00:00:00.000Z",
        updatedAt: "2026-04-02T00:00:00.000Z",
        sourceCreatedAt: "2026-04-02T00:00:00.000Z",
        sourceUpdatedAt: "2026-04-02T00:00:00.000Z",
        chunkCount: 1
      }
    ];

    const chunks: ChunkRecord[] = [
      {
        id: "chunk-1",
        documentId: "doc-1",
        text: "SQLite stores metadata for imported files and chunks.",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 53,
        tokenCount: 8,
        sectionTitle: "Storage",
        sectionPath: "Architecture Notes > Storage",
        headingTrail: "Architecture Notes > Storage"
      },
      {
        id: "chunk-2",
        documentId: "doc-1",
        text: "The UI shows citations for grounded answers in chat.",
        chunkIndex: 1,
        startOffset: 54,
        endOffset: 106,
        tokenCount: 10,
        sectionTitle: "Chat",
        sectionPath: "Architecture Notes > Chat",
        headingTrail: "Architecture Notes > Chat"
      },
      {
        id: "chunk-3",
        documentId: "doc-2",
        text: "The latest retrieval update adds hybrid ranking with recency-aware reranking.",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 80,
        tokenCount: 10,
        sectionTitle: "Retrieval",
        sectionPath: "Recent Product Update > Retrieval",
        headingTrail: "Recent Product Update > Retrieval"
      }
    ];

    const results = searchChunks("citations in chat", documents, chunks, 2);

    expect(results[0]?.chunkId).toBe("chunk-2");
  });

  it("prefers more recent chunks when the query asks for the latest status", () => {
    const documents: DocumentRecord[] = [
      {
        id: "doc-1",
        filePath: "/tmp/old.md",
        fileName: "old.md",
        title: "Older Note",
        fileType: "md",
        content: "",
        importedAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
        sourceCreatedAt: "2026-03-01T00:00:00.000Z",
        sourceUpdatedAt: "2026-03-01T00:00:00.000Z",
        chunkCount: 1
      },
      {
        id: "doc-2",
        filePath: "/tmp/new.md",
        fileName: "new.md",
        title: "Newer Note",
        fileType: "md",
        content: "",
        importedAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        sourceCreatedAt: "2026-04-01T00:00:00.000Z",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        chunkCount: 1
      }
    ];

    const chunks: ChunkRecord[] = [
      {
        id: "old",
        documentId: "doc-1",
        text: "The roadmap status is pending with no recent changes.",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 53,
        tokenCount: 9,
        sectionTitle: "Status",
        sectionPath: "Older Note > Status",
        headingTrail: "Older Note > Status"
      },
      {
        id: "new",
        documentId: "doc-2",
        text: "The latest roadmap status is in progress after the April update.",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 64,
        tokenCount: 11,
        sectionTitle: "Status",
        sectionPath: "Newer Note > Status",
        headingTrail: "Newer Note > Status"
      }
    ];

    const results = searchChunks("latest roadmap status", documents, chunks, 2);

    expect(results[0]?.chunkId).toBe("new");
  });

  it("matches Chinese queries to the most explanatory chunk", () => {
    const documents: DocumentRecord[] = [
      {
        id: "doc-1",
        filePath: "/tmp/stable.md",
        fileName: "stable.md",
        title: "Stable Diffusion 原理",
        fileType: "md",
        content: "",
        importedAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        sourceCreatedAt: "2026-04-01T00:00:00.000Z",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        chunkCount: 2
      },
      {
        id: "doc-2",
        filePath: "/tmp/design.md",
        fileName: "design.md",
        title: "玻璃设计记录",
        fileType: "md",
        content: "",
        importedAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        sourceCreatedAt: "2026-04-01T00:00:00.000Z",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        chunkCount: 1
      }
    ];

    const chunks: ChunkRecord[] = [
      {
        id: "chunk-a",
        documentId: "doc-1",
        text: "Stable Diffusion 本质上是一种在潜空间中进行扩散与去噪的生成模型。",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 38,
        tokenCount: 14,
        sectionTitle: "定义",
        sectionPath: "Stable Diffusion 原理 > 定义",
        headingTrail: "Stable Diffusion 原理 > 定义"
      },
      {
        id: "chunk-b",
        documentId: "doc-2",
        text: "这个玻璃设计项目也使用过 Stable Diffusion 做风格参考，但重点是设计流程。",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 40,
        tokenCount: 16,
        sectionTitle: "项目",
        sectionPath: "玻璃设计记录 > 项目",
        headingTrail: "玻璃设计记录 > 项目"
      }
    ];

    const results = searchChunks("什么是 stable diffusion", documents, chunks, 2);

    expect(results[0]?.chunkId).toBe("chunk-a");
  });

  it("suppresses loosely related chunks when a stronger explanatory chunk exists", () => {
    const documents: DocumentRecord[] = [
      {
        id: "doc-1",
        filePath: "/tmp/explain.md",
        fileName: "explain.md",
        title: "Stable Diffusion 解释",
        fileType: "md",
        content: "",
        importedAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        sourceCreatedAt: "2026-04-01T00:00:00.000Z",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        chunkCount: 1
      },
      {
        id: "doc-2",
        filePath: "/tmp/noise.md",
        fileName: "noise.md",
        title: "设计杂记",
        fileType: "md",
        content: "",
        importedAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        sourceCreatedAt: "2026-04-01T00:00:00.000Z",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        chunkCount: 1
      }
    ];

    const chunks: ChunkRecord[] = [
      {
        id: "relevant",
        documentId: "doc-1",
        text: "Stable Diffusion 是一种文本到图像的扩散生成模型，用于根据文本描述逐步生成图像。",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 46,
        tokenCount: 18,
        sectionTitle: "定义",
        sectionPath: "Stable Diffusion 解释 > 定义",
        headingTrail: "Stable Diffusion 解释 > 定义"
      },
      {
        id: "noise",
        documentId: "doc-2",
        text: "我们在项目里提到过 stable diffusion，但这里只是在比较几个设计工具，没有解释它是什么。",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 49,
        tokenCount: 20,
        sectionTitle: "对比",
        sectionPath: "设计杂记 > 对比",
        headingTrail: "设计杂记 > 对比"
      }
    ];

    const results = searchChunks("什么是 stable diffusion", documents, chunks, 2);

    expect(results[0]?.chunkId).toBe("relevant");
    expect(results.some((result) => result.chunkId === "noise")).toBe(false);
  });

  it("retrieves a concrete Chinese device-related answer instead of unrelated mentions", () => {
    const documents: DocumentRecord[] = [
      {
        id: "doc-1",
        filePath: "/tmp/usb.md",
        fileName: "usb.md",
        title: "U盘权限处理",
        fileType: "md",
        content: "",
        importedAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        sourceCreatedAt: "2026-04-01T00:00:00.000Z",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        chunkCount: 1
      },
      {
        id: "doc-2",
        filePath: "/tmp/ai.md",
        fileName: "ai.md",
        title: "AI 工具杂记",
        fileType: "md",
        content: "",
        importedAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        sourceCreatedAt: "2026-04-01T00:00:00.000Z",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        chunkCount: 1
      }
    ];

    const chunks: ChunkRecord[] = [
      {
        id: "usb-fix",
        documentId: "doc-1",
        text: "如果 U 盘被禁用，可以先检查系统策略、磁盘工具中的挂载状态，以及设备权限限制，再决定是否重新启用。",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 52,
        tokenCount: 20,
        sectionTitle: "解除禁用",
        sectionPath: "U盘权限处理 > 解除禁用",
        headingTrail: "U盘权限处理 > 解除禁用"
      },
      {
        id: "ai-noise",
        documentId: "doc-2",
        text: "这篇笔记提到过 stable diffusion 和其他工具，但与 U 盘禁用问题无关。",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 40,
        tokenCount: 17,
        sectionTitle: "杂记",
        sectionPath: "AI 工具杂记 > 杂记",
        headingTrail: "AI 工具杂记 > 杂记"
      }
    ];

    const results = searchChunks("如何解除U盘禁用啊", documents, chunks, 3);

    expect(results[0]?.chunkId).toBe("usb-fix");
    expect(results.some((result) => result.chunkId === "ai-noise")).toBe(false);
  });

  it("filters low-quality status chunks that only share surface keywords", () => {
    const documents: DocumentRecord[] = [
      {
        id: "doc-1",
        filePath: "/tmp/manual.pdf",
        fileName: "manual.pdf",
        title: "设备状态手册",
        fileType: "pdf",
        content: "",
        importedAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        sourceCreatedAt: "2026-04-01T00:00:00.000Z",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        chunkCount: 1
      }
    ];

    const chunks: ChunkRecord[] = [
      {
        id: "status-only",
        documentId: "doc-1",
        text: "通道被禁用时指示灯熄灭，状态字显示为异常，相关模块进入保护状态。",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 35,
        tokenCount: 14,
        sectionTitle: "状态说明",
        sectionPath: "设备状态手册 > 状态说明",
        headingTrail: "设备状态手册 > 状态说明"
      }
    ];

    const results = searchChunks("如何取消U盘禁用", documents, chunks, 3);

    expect(results).toHaveLength(0);
  });

  it("builds snippets around the best matching sentence instead of the chunk opening", () => {
    const documents: DocumentRecord[] = [
      {
        id: "doc-1",
        filePath: "/tmp/opc.pdf",
        fileName: "opc.pdf",
        title: "软件安装",
        fileType: "pdf",
        content: "",
        importedAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        sourceCreatedAt: "2026-04-01T00:00:00.000Z",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        chunkCount: 1
      }
    ];

    const chunks: ChunkRecord[] = [
      {
        id: "opc",
        documentId: "doc-1",
        text: "操作员站用于进行生产现场的监视和管理。历史站用于完成系统历史数据的采集、存储与归档。通讯站用于安装和运行 OPC 通讯软件，对第三方 OPC Server 进行数据读写。",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 80,
        tokenCount: 60,
        sectionTitle: "通讯站",
        sectionPath: "软件安装 > 通讯站",
        headingTrail: "软件安装 > 通讯站"
      }
    ];

    const results = searchChunks("如何进行OPC通讯？", documents, chunks, 2);

    expect(results[0]?.snippet).toContain("OPC 通讯软件");
    expect(results[0]?.snippet).not.toContain("操作员站用于进行生产现场的监视和管理");
  });

  it("uses intent routing to prefer procedural sections over descriptive mentions", () => {
    const documents: DocumentRecord[] = [
      {
        id: "doc-1",
        filePath: "/tmp/manual.pdf",
        fileName: "manual.pdf",
        title: "HOLLiAS MACS 安装手册",
        fileType: "pdf",
        content: "",
        importedAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        sourceCreatedAt: "2026-04-01T00:00:00.000Z",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        chunkCount: 2
      }
    ];

    const chunks: ChunkRecord[] = [
      {
        id: "mention",
        documentId: "doc-1",
        text: "系统支持 OPC 通讯能力，可用于与第三方服务器交换数据。",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 32,
        tokenCount: 18,
        sectionTitle: "产品概述",
        sectionPath: "HOLLiAS MACS 安装手册 > 产品概述",
        headingTrail: "HOLLiAS MACS 安装手册 > 产品概述"
      },
      {
        id: "procedure",
        documentId: "doc-1",
        text: "如需配置 OPC 通讯，可先打开通讯站安装界面，然后选择 OPC 组件并完成参数设置。",
        chunkIndex: 1,
        startOffset: 33,
        endOffset: 76,
        tokenCount: 24,
        sectionTitle: "OPC 通讯配置步骤",
        sectionPath: "HOLLiAS MACS 安装手册 > OPC 通讯配置步骤",
        headingTrail: "HOLLiAS MACS 安装手册 > OPC 通讯配置步骤"
      }
    ];

    const results = searchChunks("如何配置 OPC 通讯？", documents, chunks, 2);

    expect(results[0]?.chunkId).toBe("procedure");
    expect(results[0]?.evidenceText).toContain("打开通讯站安装界面");
  });

  it("penalizes install-step chunks for explanatory role questions", () => {
    const documents: DocumentRecord[] = [
      {
        id: "doc-1",
        filePath: "/tmp/manual.pdf",
        fileName: "manual.pdf",
        title: "软件安装",
        fileType: "pdf",
        content: "",
        importedAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        sourceCreatedAt: "2026-04-01T00:00:00.000Z",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        chunkCount: 2
      }
    ];

    const chunks: ChunkRecord[] = [
      {
        id: "install",
        documentId: "doc-1",
        text: "安装通讯站时，启动安装向导并勾选通讯站，然后单击下一步继续安装。",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 36,
        tokenCount: 18,
        sectionTitle: "通讯站的安装步骤",
        sectionPath: "软件安装 > 通讯站的安装步骤",
        headingTrail: "软件安装 > 通讯站的安装步骤"
      },
      {
        id: "role",
        documentId: "doc-1",
        text: "通讯站用于安装和运行 OPC 通讯软件，对第三方 OPC Server 进行数据读写。",
        chunkIndex: 1,
        startOffset: 37,
        endOffset: 75,
        tokenCount: 18,
        sectionTitle: "系统组成",
        sectionPath: "软件安装 > 系统组成",
        headingTrail: "软件安装 > 系统组成"
      }
    ];

    const results = searchChunks("通讯站有什么作用？", documents, chunks, 2);

    expect(results[0]?.chunkId).toBe("role");
    expect(results[0]?.evidenceText).toContain("用于安装和运行 OPC 通讯软件");
  });

  it("prefers label-plus-value evidence for definition questions", () => {
    const documents: DocumentRecord[] = [
      {
        id: "doc-1",
        filePath: "/tmp/rag.txt",
        fileName: "rag.txt",
        title: "RAG 说明",
        fileType: "txt",
        content: "",
        importedAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        sourceCreatedAt: "2026-04-01T00:00:00.000Z",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        chunkCount: 1
      }
    ];

    const chunks: ChunkRecord[] = [
      {
        id: "rag-definition",
        documentId: "doc-1",
        text: "RAG 的全称是：\n\nRetrieval-Augmented Generation\n\n中文通常翻译为：\n\n检索增强生成。",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 58,
        tokenCount: 18,
        sectionTitle: "定义",
        sectionPath: "RAG 说明 > 定义",
        headingTrail: "RAG 说明 > 定义"
      }
    ];

    const results = searchChunks("RAG是什么？", documents, chunks, 1);

    expect(results[0]?.evidenceText).toMatch(/Retrieval-Augmented Generation|检索增强生成/);
  });

  it("prefers purpose-and-benefit evidence for why questions", () => {
    const documents: DocumentRecord[] = [
      {
        id: "doc-1",
        filePath: "/tmp/chunking.txt",
        fileName: "chunking.txt",
        title: "Chunking 说明",
        fileType: "txt",
        content: "",
        importedAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        sourceCreatedAt: "2026-04-01T00:00:00.000Z",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        chunkCount: 1
      }
    ];

    const chunks: ChunkRecord[] = [
      {
        id: "chunking-why",
        documentId: "doc-1",
        text: "这些文档通常篇幅较长，大模型无法直接稳定处理。\n\n需要把文档拆分成多个小段。\n\n这样做的目的：\n\n* 提高检索精度\n\n* 降低上下文长度",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 70,
        tokenCount: 30,
        sectionTitle: "文档切分",
        sectionPath: "Chunking 说明 > 文档切分",
        headingTrail: "Chunking 说明 > 文档切分"
      }
    ];

    const results = searchChunks("为什么要做文档切分？", documents, chunks, 1);

    expect(results[0]?.evidenceText).toContain("提高检索精度");
  });

  it("returns highlight offsets for the selected evidence span", () => {
    const documents: DocumentRecord[] = [
      {
        id: "doc-1",
        filePath: "/tmp/opc.pdf",
        fileName: "opc.pdf",
        title: "软件安装",
        fileType: "pdf",
        content: "",
        importedAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        sourceCreatedAt: "2026-04-01T00:00:00.000Z",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        chunkCount: 1
      }
    ];

    const text = "操作员站用于监视和管理。通讯站用于安装和运行 OPC 通讯软件，对第三方 OPC Server 进行数据读写。";
    const chunks: ChunkRecord[] = [
      {
        id: "opc-highlight",
        documentId: "doc-1",
        text,
        chunkIndex: 0,
        startOffset: 0,
        endOffset: text.length,
        tokenCount: 24,
        sectionTitle: "通讯站",
        sectionPath: "软件安装 > 通讯站",
        headingTrail: "软件安装 > 通讯站",
        pageStart: 5,
        pageEnd: 5,
        paragraphStart: 12,
        paragraphEnd: 12,
        locatorLabel: "p.5 | para 12"
      }
    ];

    const results = searchChunks("如何进行OPC通讯？", documents, chunks, 1);

    expect(results[0]?.highlightText).toContain("OPC 通讯软件");
    expect(results[0]?.highlightStart).toBeGreaterThanOrEqual(0);
    expect(results[0]?.highlightEnd).toBeGreaterThan(results[0]?.highlightStart ?? -1);
    expect(results[0]?.anchorLabel).toBe("p.5 | para 12 | sent 2");
  });

  it("prefers sibling procedural chunks from the same parent section when they jointly support the answer", () => {
    const documents: DocumentRecord[] = [
      {
        id: "doc-1",
        filePath: "/tmp/manual.pdf",
        fileName: "manual.pdf",
        title: "系统软件工具",
        fileType: "pdf",
        content: "",
        importedAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        sourceCreatedAt: "2026-04-01T00:00:00.000Z",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        chunkCount: 3
      }
    ];

    const chunks: ChunkRecord[] = [
      {
        id: "server-config",
        documentId: "doc-1",
        text: "打开 Macs6 服务器配置对话框，填写域号并确认服务器参数。",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 32,
        tokenCount: 18,
        sectionTitle: "5.4.3.1 服务器配置",
        sectionPath: "第5章 系统软件工具 > 5.4 OPC客户端 > 5.4.3 配置与调试 > 5.4.3.1 服务器配置",
        headingTrail: "第5章 系统软件工具 > 5.4 OPC客户端 > 5.4.3 配置与调试 > 5.4.3.1 服务器配置"
      },
      {
        id: "direction",
        documentId: "doc-1",
        text: "如果需要自动进行通讯链接，可以在在线通讯菜单下设置自动运行，并确认通讯方向。",
        chunkIndex: 1,
        startOffset: 33,
        endOffset: 76,
        tokenCount: 24,
        sectionTitle: "5.4.4.5 设置通讯方向",
        sectionPath: "第5章 系统软件工具 > 5.4 OPC客户端 > 5.4.4 通信功能 > 5.4.4.5 设置通讯方向",
        headingTrail: "第5章 系统软件工具 > 5.4 OPC客户端 > 5.4.4 通信功能 > 5.4.4.5 设置通讯方向"
      },
      {
        id: "overview-only",
        documentId: "doc-1",
        text: "系统支持 OPC 通讯能力，可用于与第三方设备交换数据。",
        chunkIndex: 2,
        startOffset: 77,
        endOffset: 107,
        tokenCount: 16,
        sectionTitle: "产品概述",
        sectionPath: "第5章 系统软件工具 > 产品概述",
        headingTrail: "第5章 系统软件工具 > 产品概述"
      }
    ];

    const results = searchChunks("如何与Macs6系统进行OPC通讯？", documents, chunks, 3);

    expect(results[0]?.sectionRootLabel).toBe("5.4 OPC客户端");
    expect(results[1]?.sectionRootLabel).toBe("5.4 OPC客户端");
    expect(results.slice(0, 2).map((result) => result.chunkId).sort()).toEqual(["direction", "server-config"]);
  });
});

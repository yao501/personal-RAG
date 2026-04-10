import { describe, expect, it } from "vitest";
import { answerQuestion } from "./answerQuestion";
import type { SearchResult } from "../../shared/types";

describe("answerQuestion", () => {
  it("filters truncated numbered-list supporting points", () => {
    const results: SearchResult[] = [
      {
        documentId: "doc-1",
        fileName: "stable_diffusion.md",
        documentTitle: "Stable Diffusion Notes",
        chunkId: "chunk-1",
        snippet: "它的核心思想不是“根据文本一次性直接画出图片”，而是通过多步去噪逐渐生成图像。",
        score: 3,
        chunkIndex: 0,
        sectionTitle: "原理",
        sectionPath: "Stable Diffusion Notes > 原理",
        sourceUpdatedAt: "2026-03-27T00:00:00.000Z",
        importedAt: "2026-03-27T00:00:00.000Z",
        fullText: [
          "它的核心思想不是“根据文本一次性直接画出图片”，而是：",
          "1. 从噪声出发，逐步去噪。",
          "2. 在文本条件引导下逼近目标图像。"
        ].join("\n"),
        text: [
          "它的核心思想不是“根据文本一次性直接画出图片”，而是：",
          "1. 从噪声出发，逐步去噪。",
          "2. 在文本条件引导下逼近目标图像。"
        ].join("\n"),
        lexicalScore: 1,
        semanticScore: 1,
        freshnessScore: 0.5,
        rerankScore: 1,
        qualityScore: 0.9
      }
    ];

    const answer = answerQuestion("什么是 stable diffusion?", results);

    expect(answer.supportingPoints[0]).not.toContain("而是： 1.");
    expect(answer.supportingPoints[0]).not.toContain("而是： 1");
  });

  it("falls back when the top result is low-quality operational noise", () => {
    const results: SearchResult[] = [
      {
        documentId: "doc-1",
        fileName: "manual.pdf",
        documentTitle: "设备状态手册",
        chunkId: "chunk-1",
        snippet: "通道被禁用时指示灯熄灭，状态字显示为异常。",
        score: 2.1,
        chunkIndex: 0,
        sectionTitle: "状态说明",
        sectionPath: "设备状态手册 > 状态说明",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        importedAt: "2026-04-01T00:00:00.000Z",
        text: "通道被禁用时指示灯熄灭，状态字显示为异常，相关模块进入保护状态。",
        lexicalScore: 1.2,
        semanticScore: 0.8,
        freshnessScore: 0.5,
        rerankScore: 0.9,
        qualityScore: -0.6,
        fullText: "通道被禁用时指示灯熄灭，状态字显示为异常，相关模块进入保护状态。"
      }
    ];

    const answer = answerQuestion("如何取消U盘禁用", results);

    expect(answer.directAnswer).toContain("I could not find grounded evidence");
    expect(answer.citations).toHaveLength(0);
  });

  it("keeps only the strongest evidence citations when weaker chunks trail far behind", () => {
    const results: SearchResult[] = [
      {
        documentId: "doc-1",
        fileName: "manual-1.pdf",
        documentTitle: "软件安装",
        chunkId: "top",
        snippet: "可在系统任务栏节点守护图标上单击右键，选择【启用/禁用设备】。",
        score: 3.4,
        chunkIndex: 60,
        sectionTitle: "启用/禁用设备",
        sectionPath: "软件安装 > 启用/禁用设备",
        sourceUpdatedAt: "2024-07-31T00:00:00.000Z",
        importedAt: "2026-04-08T00:00:00.000Z",
        text: "如需手动启动或禁用设备，可在系统任务栏节点守护图标上单击右键，在菜单中选择【启用/禁用设备】。",
        lexicalScore: 2.1,
        semanticScore: 1.2,
        freshnessScore: 0.4,
        rerankScore: 1.5,
        qualityScore: 1.1,
        fullText: "如需手动启动或禁用设备，可在系统任务栏节点守护图标上单击右键，在菜单中选择【启用/禁用设备】。"
      },
      {
        documentId: "doc-2",
        fileName: "manual-2.pdf",
        documentTitle: "图形编辑",
        chunkId: "weak",
        snippet: "撤销可取消本次操作并恢复至先前状态。",
        score: 1.7,
        chunkIndex: 11,
        sectionTitle: "编辑工具栏",
        sectionPath: "图形编辑 > 编辑工具栏",
        sourceUpdatedAt: "2024-07-31T00:00:00.000Z",
        importedAt: "2026-04-08T00:00:00.000Z",
        text: "撤销可取消本次操作并恢复至先前状态，最多可取消本次以前的 20 次操作。",
        lexicalScore: 0.7,
        semanticScore: 0.24,
        freshnessScore: 0.4,
        rerankScore: 0.68,
        qualityScore: 0.35,
        fullText: "撤销可取消本次操作并恢复至先前状态，最多可取消本次以前的 20 次操作。"
      }
    ];

    const answer = answerQuestion("如何取消U盘禁用？", results);

    expect(answer.citations.map((citation) => citation.chunkId)).toEqual(["top"]);
  });

  it("uses the sentence that best matches the question instead of the chunk opening", () => {
    const results: SearchResult[] = [
      {
        documentId: "doc-1",
        fileName: "opc.pdf",
        documentTitle: "软件安装",
        chunkId: "opc",
        snippet: "通讯站用于安装和运行 OPC 通讯软件，对第三方 OPC Server 进行数据读写。",
        score: 3.1,
        chunkIndex: 35,
        sectionTitle: "通讯站",
        sectionPath: "软件安装 > 通讯站",
        sourceUpdatedAt: "2024-07-31T00:00:00.000Z",
        importedAt: "2026-04-08T00:00:00.000Z",
        text: "操作员站用于监视和管理。历史站用于历史数据采集与归档。通讯站用于安装和运行 OPC 通讯软件，对第三方 OPC Server 进行数据读写。",
        lexicalScore: 1.8,
        semanticScore: 1,
        freshnessScore: 0.4,
        rerankScore: 1.3,
        qualityScore: 1,
        fullText: "操作员站用于监视和管理。历史站用于历史数据采集与归档。通讯站用于安装和运行 OPC 通讯软件，对第三方 OPC Server 进行数据读写。"
      }
    ];

    const answer = answerQuestion("如何与Macs6系统进行OPC通讯？", results);

    expect(answer.directAnswer).toContain("通讯站用于安装和运行 OPC 通讯软件");
    expect(answer.directAnswer).not.toContain("操作员站用于监视和管理");
  });

  it("aggregates a parent procedure section instead of answering with only one child step", () => {
    const results: SearchResult[] = [
      {
        documentId: "doc-1",
        fileName: "manual.pdf",
        documentTitle: "第1章 关于本文档（软件安装）",
        chunkId: "intro",
        snippet: "本软件是运行于 MACS6 系统下的 OPC Client 通信软件。",
        score: 8.8,
        chunkIndex: 277,
        sectionTitle: "5.4.1 软件介绍",
        sectionPath: "第5章 系统软件工具 > 5.4 OPC客户端 > 5.4.1 软件介绍",
        sourceUpdatedAt: "2024-07-31T00:00:00.000Z",
        importedAt: "2026-04-08T00:00:00.000Z",
        text: "本软件是运行于 MACS6 系统下的 OPC Client 通信软件，软件作为 DCS 系统的一个接口实现与其他系统厂商设备之间进行数据交换。",
        lexicalScore: 2.1,
        semanticScore: 1.4,
        freshnessScore: 0.4,
        rerankScore: 1.7,
        qualityScore: 1,
        fullText: "本软件是运行于 MACS6 系统下的 OPC Client 通信软件，软件作为 DCS 系统的一个接口实现与其他系统厂商设备之间进行数据交换。"
      },
      {
        documentId: "doc-1",
        fileName: "manual.pdf",
        documentTitle: "第1章 关于本文档（软件安装）",
        chunkId: "server",
        snippet: "打开“Macs6 服务器配置”对话框如下图所示。",
        score: 9.0,
        chunkIndex: 283,
        sectionTitle: "5.4.3.1 服务器配置",
        sectionPath: "第5章 系统软件工具 > 5.4 OPC客户端 > 5.4.2 启动客户端 > 5.4.3 配置与调试 > 5.4.3.1 服务器配置",
        sourceUpdatedAt: "2024-07-31T00:00:00.000Z",
        importedAt: "2026-04-08T00:00:00.000Z",
        text: "打开“Macs6 服务器配置”对话框如下图所示。这里的域号与 MACS6 系统中的域的概念相同。",
        lexicalScore: 2.3,
        semanticScore: 1.5,
        freshnessScore: 0.4,
        rerankScore: 1.8,
        qualityScore: 1,
        fullText: "打开“Macs6 服务器配置”对话框如下图所示。这里的域号与 MACS6 系统中的域的概念相同。"
      },
      {
        documentId: "doc-1",
        fileName: "manual.pdf",
        documentTitle: "第1章 关于本文档（软件安装）",
        chunkId: "direction",
        snippet: "如果需要在客户端运行后自动进行通讯链接，可以勾选【在线通讯】菜单下的【自动运行】命令。",
        score: 9.1,
        chunkIndex: 294,
        sectionTitle: "5.4.4.5 设置通讯方向",
        sectionPath: "第5章 系统软件工具 > 5.4 OPC客户端 > 5.4.4 通信功能 > 5.4.4.5 设置通讯方向",
        sourceUpdatedAt: "2024-07-31T00:00:00.000Z",
        importedAt: "2026-04-08T00:00:00.000Z",
        text: "如果需要在客户端运行后自动进行通讯链接，可以勾选【在线通讯】菜单下的【自动运行】命令进行设置。",
        lexicalScore: 2.4,
        semanticScore: 1.6,
        freshnessScore: 0.4,
        rerankScore: 1.9,
        qualityScore: 1,
        fullText: "如果需要在客户端运行后自动进行通讯链接，可以勾选【在线通讯】菜单下的【自动运行】命令进行设置。"
      }
    ];

    const answer = answerQuestion("如何与Macs6系统进行OPC通讯？", results);

    expect(answer.directAnswer).toContain("5.4 OPC客户端");
    expect(answer.directAnswer).toContain("服务器配置");
    expect(answer.directAnswer).toContain("设置通讯方向");
    expect(answer.citations).toHaveLength(3);
  });

  it("allows a borderline single hit when score, quality, and rerank jointly support it (Sprint 5.1)", () => {
    const results: SearchResult[] = [
      {
        documentId: "doc-1",
        fileName: "guide.md",
        documentTitle: "使用指南",
        chunkId: "border",
        snippet: "只有背景说明，没有编号步骤。",
        score: 2.45,
        chunkIndex: 0,
        sectionTitle: "背景",
        sectionPath: "使用指南 > 背景",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        importedAt: "2026-04-01T00:00:00.000Z",
        text: "只有背景说明，没有编号步骤。",
        lexicalScore: 0.9,
        semanticScore: 0.55,
        freshnessScore: 0.3,
        rerankScore: 1.0,
        qualityScore: 0.2,
        fullText: "只有背景说明，没有编号步骤。"
      }
    ];

    const answer = answerQuestion("怎么完成导入？", results);

    expect(answer.directAnswer).not.toContain("概述性内容");
  });

  it("prefers an explicit overview caveat for weak procedural hits without actionable cues", () => {
    const results: SearchResult[] = [
      {
        documentId: "doc-1",
        fileName: "guide.md",
        documentTitle: "使用指南",
        chunkId: "ov",
        snippet: "本节只描述背景信息。",
        score: 1.35,
        chunkIndex: 0,
        sectionTitle: "背景",
        sectionPath: "使用指南 > 背景",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        importedAt: "2026-04-01T00:00:00.000Z",
        text: "本节只描述背景信息，不包含逐步操作。",
        lexicalScore: 0.55,
        semanticScore: 0.42,
        freshnessScore: 0.3,
        rerankScore: 0.88,
        qualityScore: 0.2,
        fullText: "本节只描述背景信息，不包含逐步操作。"
      }
    ];

    const answer = answerQuestion("如何完成导入？", results);

    expect(answer.directAnswer).toContain("概述性");
    expect(answer.citations.length).toBeGreaterThan(0);
  });

  it("returns localized direct answers instead of English grounding boilerplate", () => {
    const results: SearchResult[] = [
      {
        documentId: "doc-1",
        fileName: "manual.pdf",
        documentTitle: "软件安装",
        chunkId: "top",
        snippet: "可在系统任务栏节点守护图标上单击右键，选择【启用/禁用设备】。",
        score: 3.4,
        chunkIndex: 60,
        sectionTitle: "启用/禁用设备",
        sectionPath: "软件安装 > 启用/禁用设备",
        sourceUpdatedAt: "2024-07-31T00:00:00.000Z",
        importedAt: "2026-04-08T00:00:00.000Z",
        text: "如需手动启动或禁用设备，可在系统任务栏节点守护图标上单击右键，在菜单中选择【启用/禁用设备】。",
        lexicalScore: 2.1,
        semanticScore: 1.2,
        freshnessScore: 0.4,
        rerankScore: 1.5,
        qualityScore: 1.1,
        fullText: "如需手动启动或禁用设备，可在系统任务栏节点守护图标上单击右键，在菜单中选择【启用/禁用设备】。"
      }
    ];

    const answer = answerQuestion("如何取消U盘禁用？", results);

    expect(answer.directAnswer).toContain("主要依据《软件安装》");
    expect(answer.directAnswer).not.toContain("This answer is primarily grounded");
  });
});

import { describe, expect, it } from "vitest";
import { chunkText } from "./chunkText";

describe("chunkText", () => {
  it("preserves section context while creating natural chunks", () => {
    const text = [
      "# Project Notes",
      "",
      "## Retrieval",
      "",
      "Hybrid retrieval combines lexical and semantic ranking.",
      "",
      "Reranking improves precision for the final answer.",
      "",
      "## Freshness",
      "",
      "Recent notes should be preferred when the query asks for current status."
    ].join("\n");
    const chunks = chunkText("doc-1", text, { chunkSize: 12, chunkOverlap: 4, documentTitle: "Project Notes" });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.sectionTitle).toBe("Retrieval");
    expect(chunks[0]?.sectionPath).toContain("Retrieval");
    expect(chunks.some((chunk) => chunk.sectionTitle === "Freshness")).toBe(true);
  });

  it("keeps continuation paragraphs with short lead-in text", () => {
    const text = [
      "# Stable Diffusion",
      "",
      "## Project value",
      "",
      "在你的玻璃品设计项目里，Stable Diffusion 的价值并不只是“用了一个文生图模型”，更关键的是：",
      "",
      "它可以帮助你快速生成风格探索草图，并把抽象概念转成可讨论的视觉方向。"
    ].join("\n");

    const chunks = chunkText("doc-2", text, { chunkSize: 24, chunkOverlap: 4, documentTitle: "Stable Diffusion" });

    expect(chunks[0]?.text).toContain("更关键的是：");
    expect(chunks[0]?.text).toContain("它可以帮助你快速生成风格探索草图");
  });

  it("splits long Chinese prose into multiple chunks without relying on spaces", () => {
    const text = [
      "# U盘处理",
      "",
      "## 故障恢复",
      "",
      "如果U盘被系统禁用，先检查磁盘工具是否还能识别设备，然后确认系统策略、权限设置和安全软件限制。",
      "如果设备仍然可见，再尝试重新挂载、退出占用进程、重新插拔，并记录报错提示。",
      "只有在确认数据已备份后，再进行修复、格式化或驱动层面的排查。"
    ].join("\n");

    const chunks = chunkText("doc-cn", text, { chunkSize: 40, chunkOverlap: 8, documentTitle: "U盘处理" });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.tokenCount <= 60)).toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes("重新挂载"))).toBe(true);
  });

  it("keeps adjacent role list items in separate chunks for better retrieval targeting", () => {
    const text = [
      "# 系统组成",
      "",
      "## 站点角色",
      "",
      "■ 操作员站 用于进行生产现场的监视和管理，包括系统数据监视和控制操作。",
      "",
      "■ 历史站 用于完成系统历史数据的采集、存储与归档服务。",
      "",
      "■ 通讯站 用于安装和运行 OPC 通讯软件，对第三方 OPC Server 进行数据读写。"
    ].join("\n");

    const chunks = chunkText("doc-role", text, { chunkSize: 120, chunkOverlap: 16, documentTitle: "系统组成" });

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.some((chunk) => chunk.text.includes("通讯站") && !chunk.text.includes("操作员站"))).toBe(true);
  });

  it("attaches page and paragraph locators when source page spans are available", () => {
    const text = [
      "# 报告",
      "",
      "## 第一部分",
      "",
      "第一页内容。",
      "",
      "## 第二部分",
      "",
      "第二页内容。"
    ].join("\n");

    const chunks = chunkText("doc-pages", text, {
      chunkSize: 20,
      chunkOverlap: 4,
      documentTitle: "报告",
      pageSpans: [
        { pageNumber: 1, startOffset: 0, endOffset: 20 },
        { pageNumber: 2, startOffset: 20, endOffset: text.length }
      ]
    });

    expect(chunks[0]?.locatorLabel).toContain("p.");
    expect(chunks[0]?.locatorLabel).toContain("para");
  });

  it("B4 single-rule: coalesces PDF term/table whitespace around 参数对齐 so key phrases stay in one chunk", () => {
    const fragment = [
      "# 功能块",
      "",
      "## 1.6 术语",
      "",
      "参数对齐",
      "",
      "该属性设为 TRUE 的参数，在工程进行下装时，系统会将在线值和离线值进行对比并做值比较；若不一致会给出同步提示，由用户选择是否进行同步；若为 FALSE 则不进行值比较。",
      "",
      // table-like short lines with blank rows (common in PDF extraction)
      "0.00",
      "",
      "否",
      "",
      "否",
      "",
      "请赋值为“副调点名.OVE”"
    ].join("\n");

    // Before (simulate non-PDF path: pageSpans absent => rule disabled)
    const before = chunkText("doc-b4-before", fragment, {
      chunkSize: 30,
      chunkOverlap: 4,
      documentTitle: "功能块"
    });
    const beforeHasAll = before.some(
      (c) =>
        (c.sectionTitle === "参数对齐" || c.text.includes("参数对齐")) &&
        /TRUE/.test(c.text) &&
        /FALSE/.test(c.text) &&
        c.text.includes("在线值") &&
        c.text.includes("离线值") &&
        c.text.includes("同步") &&
        c.text.includes("值比较")
    );
    expect(beforeHasAll).toBe(false);

    // After (PDF path: pageSpans present => rule enabled)
    const after = chunkText("doc-b4-after", fragment, {
      chunkSize: 30,
      chunkOverlap: 4,
      documentTitle: "功能块",
      pageSpans: [{ pageNumber: 1, startOffset: 0, endOffset: fragment.length }]
    });
    const afterHasAll = after.some(
      (c) =>
        (c.sectionTitle === "参数对齐" || c.text.includes("参数对齐")) &&
        /TRUE/.test(c.text) &&
        /FALSE/.test(c.text) &&
        c.text.includes("在线值") &&
        c.text.includes("离线值") &&
        c.text.includes("同步") &&
        c.text.includes("值比较")
    );
    expect(afterHasAll).toBe(true);
  });

  it("B4 non-target: keeps ordinary prose chunking behavior unchanged for non-PDF input", () => {
    const prose = [
      "# 说明",
      "",
      "这是一段普通说明文本，不包含布尔属性或参数表等提示。",
      "",
      "它应该按现有策略正常切分，不应触发 B4 的空行折叠规则。"
    ].join("\n");

    const chunks = chunkText("doc-b4-prose", prose, { chunkSize: 24, chunkOverlap: 4, documentTitle: "说明" });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.some((c) => c.text.includes("参数对齐"))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { cleanPdfText, cleanStructuredText } from "./parseDocument";

describe("cleanPdfText", () => {
  it("turns numbered PDF headings into markdown-style structure for downstream chunking", () => {
    const text = [
      "1 软件安装",
      "1.1 通讯站",
      "通讯站用于安装和运行 OPC 通讯软件，对第三方 OPC Server 进行数据读写。",
      "1.2 启用/禁用设备",
      "如需手动启动或禁用设备，可在系统任务栏节点守护图标上单击右键。"
    ].join("\n");

    const cleaned = cleanPdfText(text);

    expect(cleaned).toContain("# 1 软件安装");
    expect(cleaned).toContain("## 1.1 通讯站");
    expect(cleaned).toContain("## 1.2 启用/禁用设备");
    expect(cleaned).toContain("通讯站用于安装和运行 OPC 通讯软件");
  });

  it("does not turn table-like numeric rows into headings", () => {
    const text = [
      "10 MB",
      "5400 rpm，500",
      "5.4 OPC客户端",
      "本软件是运行于 MACS6 系统下的 OPC Client 通信软件。"
    ].join("\n");

    const cleaned = cleanPdfText(text);

    expect(cleaned).not.toContain("# 10 MB");
    expect(cleaned).not.toContain("# 5400 rpm，500");
    expect(cleaned).toContain("## 5.4 OPC客户端");
  });

  it("preserves docx-style table rows and joins key-value continuations", () => {
    const text = [
      "项目经理\t孙光耀\t13800000000",
      "",
      "实施策略：",
      "POC试点验证+分步推广"
    ].join("\n");

    const cleaned = cleanStructuredText(text);

    expect(cleaned).toContain("项目经理 | 孙光耀 | 13800000000");
    expect(cleaned).toContain("实施策略： POC试点验证+分步推广");
  });
});

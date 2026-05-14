import { describe, expect, it } from "vitest";
import { answerQuestion } from "./answerQuestion";
import type { SearchResult } from "../../shared/types";

describe("answerQuestion", () => {
  it("emits a two-phase Q6 direct answer when controller-side compile/download evidence exists", () => {
    const results: SearchResult[] = [
      {
        documentId: "doc-irrelevant",
        fileName: "manual4.pdf",
        documentTitle: "算法组态",
        chunkId: "cabinet",
        snippet: "机柜配置说明。",
        score: 9.9,
        chunkIndex: 1,
        sectionTitle: "机柜配置",
        sectionPath: "算法组态 > 机柜配置",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        importedAt: "2026-04-08T00:00:00.000Z",
        text: "在【硬件组态】菜单下选择该命令，机柜按照首次添加的顺序从左到右依次排列。",
        lexicalScore: 10,
        semanticScore: 1,
        freshnessScore: 0.4,
        rerankScore: 2,
        qualityScore: 1,
        fullText: "在【硬件组态】菜单下选择该命令，机柜按照首次添加的顺序从左到右依次排列。"
      },
      {
        documentId: "doc-controller",
        fileName: "manual2.pdf",
        documentTitle: "快速入门",
        chunkId: "dl",
        snippet: "下装控制器算法。",
        score: 3.2,
        chunkIndex: 20,
        sectionTitle: "下装控制器算法",
        sectionPath: "快速入门 > 下装控制器算法",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        importedAt: "2026-04-08T00:00:00.000Z",
        text: "控制器算法工程需要先编译，编译后再下装控制器算法到控制器。",
        lexicalScore: 2,
        semanticScore: 1,
        freshnessScore: 0.4,
        rerankScore: 1.1,
        qualityScore: 0.9,
        fullText: "控制器算法工程需要先编译，编译后再下装控制器算法到控制器。"
      }
    ];

    const answer = answerQuestion("只看控制器侧：下装前应该先做什么？", results);
    expect(answer.directAnswer).toContain("阶段一(控制器侧");
    expect(answer.directAnswer).toContain("控制器");
    expect(answer.directAnswer).toContain("编译");
    expect(answer.directAnswer).toContain("下装");
    // and it should prefer citing the controller-side evidence, not the irrelevant top1.
    expect(answer.citations.map((c) => c.chunkId)).toContain("dl");
  });

  it("keeps controller-side context for short compile/download order questions", () => {
    const results: SearchResult[] = [
      {
        documentId: "doc-eng",
        fileName: "manual3.pdf",
        documentTitle: "工程总控",
        chunkId: "faq-order",
        snippet: "Q：编译和下装的顺序是什么？先编译后下装。",
        score: 24,
        chunkIndex: 100,
        sectionTitle: "第13章 常见问题",
        sectionPath: "工程总控 > 第13章 常见问题",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        importedAt: "2026-04-08T00:00:00.000Z",
        text: "13.2 Q：编译和下装的顺序是什么？先编译后下装。",
        lexicalScore: 20,
        semanticScore: 2,
        freshnessScore: 0.4,
        rerankScore: 8,
        qualityScore: 0.6,
        fullText: "13.2 Q：编译和下装的顺序是什么？先编译后下装。"
      },
      {
        documentId: "doc-quickstart",
        fileName: "manual2.pdf",
        documentTitle: "快速入门",
        chunkId: "download-targets",
        snippet: "下装是将编译生成的下装文件，通过网络传输到历史站、操作员站和控制器的过程。",
        score: 23,
        chunkIndex: 88,
        sectionTitle: "2.9.1 下装",
        sectionPath: "快速入门 > 2.9 下装运行 > 2.9.1 下装",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        importedAt: "2026-04-08T00:00:00.000Z",
        text: "下装是将编译生成的下装文件，通过网络传输到历史站、操作员站和控制器的过程。下装分为下装控制器算法、下装操作站、下装历史站和下装报表打印站。",
        lexicalScore: 8,
        semanticScore: 1.4,
        freshnessScore: 0.4,
        rerankScore: 4,
        qualityScore: 1.1,
        fullText: "下装是将编译生成的下装文件，通过网络传输到历史站、操作员站和控制器的过程。下装分为下装控制器算法、下装操作站、下装历史站和下装报表打印站。"
      }
    ];

    const answer = answerQuestion("编译和下装的顺序是什么？", results);

    expect(answer.directAnswer).toContain("控制器");
    expect(answer.directAnswer).toMatch(/工程总控|操作员站|历史站/);
    expect(answer.directAnswer).toContain("阶段");
  });

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

  it("allows low-quality DCS parameter-table chunks when exact technical identifiers match", () => {
    const results: SearchResult[] = [
      {
        documentId: "doc-pid",
        fileName: "hollias_manual7_function_block.pdf",
        documentTitle: "第7册 功能块",
        chunkId: "pid-table",
        snippet: "PID 参数表：PVU 为 PV 量程上限，PVL 为 PV 量程下限，ENGU 为工程量上限，ENGL 为工程量下限。",
        score: 1.4,
        chunkIndex: 88,
        sectionTitle: "5.1.5.11 点详细面板",
        sectionPath: "第5章 控制运算 > PID > 点详细面板",
        sourceUpdatedAt: "2026-04-16T00:00:00.000Z",
        importedAt: "2026-04-16T00:00:00.000Z",
        text: "参数 名称 说明\nPVU PV量程上限\nPVL PV量程下限\nENGU 输出量程上限\nENGL 输出量程下限\nDeadband 死区",
        lexicalScore: 2.4,
        semanticScore: 0.1,
        freshnessScore: 0.4,
        rerankScore: 0.2,
        qualityScore: -0.6,
        fullText: "参数 名称 说明\nPVU PV量程上限\nPVL PV量程下限\nENGU 输出量程上限\nENGL 输出量程下限\nDeadband 死区"
      }
    ];

    const answer = answerQuestion("PID 功能块中 PVU/PVL 和 ENGU/ENGL 参数分别表示什么？", results);

    expect(answer.directAnswer).not.toContain("I could not find grounded evidence");
    expect(answer.directAnswer).toContain("PVU");
    expect(answer.directAnswer).toContain("ENGU");
    expect(answer.citations.map((citation) => citation.chunkId)).toEqual(["pid-table"]);
  });

  it("does not let the DCS table allowance rescue unrelated low-quality chunks", () => {
    const results: SearchResult[] = [
      {
        documentId: "doc-noise",
        fileName: "hollias_manual7_function_block.pdf",
        documentTitle: "第7册 功能块",
        chunkId: "noise",
        snippet: "文档更新记录和阅读对象说明。",
        score: 1.4,
        chunkIndex: 2,
        sectionTitle: "文档更新记录",
        sectionPath: "关于本文档 > 文档更新记录",
        sourceUpdatedAt: "2026-04-16T00:00:00.000Z",
        importedAt: "2026-04-16T00:00:00.000Z",
        text: "本文档适用于工程人员阅读，包含版本修订历史和阅读对象说明。",
        lexicalScore: 2.4,
        semanticScore: 0.1,
        freshnessScore: 0.4,
        rerankScore: 0.2,
        qualityScore: -0.6,
        fullText: "本文档适用于工程人员阅读，包含版本修订历史和阅读对象说明。"
      }
    ];

    const answer = answerQuestion("PID 功能块中 PVU/PVL 和 ENGU/ENGL 参数分别表示什么？", results);

    expect(answer.directAnswer).toContain("I could not find grounded evidence");
    expect(answer.citations).toHaveLength(0);
  });

  it("summarizes DCS advanced operation blocks with their identifiers instead of procedural section boilerplate", () => {
    const results: SearchResult[] = [
      {
        documentId: "doc-fb",
        fileName: "hollias_manual7_function_block.pdf",
        documentTitle: "第7册 功能块",
        chunkId: "switch-orsel",
        snippet: "超驰选择：根据四路输入信号的状态、输入值进行分析计算，然后输出一路信号。",
        score: 44,
        chunkIndex: 421,
        sectionTitle: "3.21.3.2 串级模式",
        sectionPath: "第4章 高级运算 > 4.3 信号处理 > 4.3.21 SWITCH（信号选择开关） > 3.21.3.2 串级模式 > 4.3.22 ORSEL（超驰选择） > 4.3.22.1 功能",
        sourceUpdatedAt: "2026-04-16T00:00:00.000Z",
        importedAt: "2026-04-16T00:00:00.000Z",
        text: [
          "在 EQB 运算模式下，由程序通过 S1~S4 的状态选择 X1~X4 的值输出至 OP（输出值）。",
          "超驰选择",
          "在两种不同的运算模式（EQA（高选）/EQB（低选））以及两种不同的操作模式下，根据四路输入信号的状态、输入值进行分析计算，然后输出一路信号。"
        ].join("\n\n"),
        lexicalScore: 20,
        semanticScore: 0.4,
        freshnessScore: 0.4,
        rerankScore: 1.1,
        qualityScore: -0.5,
        fullText: [
          "在 EQB 运算模式下，由程序通过 S1~S4 的状态选择 X1~X4 的值输出至 OP（输出值）。",
          "超驰选择",
          "在两种不同的运算模式（EQA（高选）/EQB（低选））以及两种不同的操作模式下，根据四路输入信号的状态、输入值进行分析计算，然后输出一路信号。"
        ].join("\n\n")
      },
      {
        documentId: "doc-fb",
        fileName: "hollias_manual7_function_block.pdf",
        documentTitle: "第7册 功能块",
        chunkId: "muldiv-summer",
        snippet: "RC求和：根据四路输入信号的值以及比例因子，输出一路信号。",
        score: 43,
        chunkIndex: 534,
        sectionTitle: "5.11.3.2 串级模式",
        sectionPath: "第4章 高级运算 > 4.5 统计计算 > 4.5.11 MULDIV（乘除） > 5.11.3.2 串级模式 > 4.5.12 SUMMER_CTRL（RC求和） > 4.5.12.1 功能",
        sourceUpdatedAt: "2026-04-16T00:00:00.000Z",
        importedAt: "2026-04-16T00:00:00.000Z",
        text: [
          "式中：CV 为输出值，K 为总体比例因子，K1~K3 为输入 X1~X3 的比例因子，B 为总偏置。",
          "RC求和",
          "在五种不同的运算模式（EQA~EQE）以及两种不同的操作模式下，根据四路输入信号的值以及比例因子，输出一路信号。"
        ].join("\n\n"),
        lexicalScore: 20,
        semanticScore: 0.4,
        freshnessScore: 0.4,
        rerankScore: 1.1,
        qualityScore: -0.5,
        fullText: [
          "式中：CV 为输出值，K 为总体比例因子，K1~K3 为输入 X1~X3 的比例因子，B 为总偏置。",
          "RC求和",
          "在五种不同的运算模式（EQA~EQE）以及两种不同的操作模式下，根据四路输入信号的值以及比例因子，输出一路信号。"
        ].join("\n\n")
      }
    ];

    const answer = answerQuestion(
      "SWITCH、ORSEL、MULDIV、SUMMER_CTRL 分别有什么功能？各适用于什么场景？",
      results
    );

    expect(answer.directAnswer).toContain("SWITCH");
    expect(answer.directAnswer).toContain("ORSEL");
    expect(answer.directAnswer).toContain("MULDIV");
    expect(answer.directAnswer).toContain("SUMMER_CTRL");
    expect(answer.directAnswer).not.toContain("这个问题更适合参考");
  });

  it("answers DCS Bypass questions with the English anchor, output rule, and maintenance scenario", () => {
    const results: SearchResult[] = [
      {
        documentId: "doc-fb",
        fileName: "hollias_manual7_function_block.pdf",
        documentTitle: "第7册 功能块",
        chunkId: "control-bypass",
        snippet: "控制旁路功能应用在串级副调 PID 中，主要作用是将串级副调 PID 的比例、积分、微分运算旁路。",
        score: 37,
        chunkIndex: 788,
        sectionTitle: "5.1.3.11 控制旁路",
        sectionPath: "第5章 控制运算 > PIDA > 5.1.3.11 控制旁路",
        sourceUpdatedAt: "2026-04-16T00:00:00.000Z",
        importedAt: "2026-04-16T00:00:00.000Z",
        text: "控制旁路功能应用在串级副调 PID 中，主要作用是将串级副调 PID 的比例、积分、微分运算旁路，来自串级主调的 SP 经量程转换后输出。如果控制旁路 CTRBP 打开且 PIDA 在串级模式下（MODE=2），PIDA 不执行比例积分微分相关运算，PIDA 功能块的输出按照公式计算，进行限幅限速后输出。当 PIDA 模式切换到非串级模式时，自动退出控制计算旁路，在退出控制计算旁路功能后，PIDA 的输出无扰。",
        lexicalScore: 10,
        semanticScore: 0.6,
        freshnessScore: 0.4,
        rerankScore: 1.6,
        qualityScore: 0.2,
        fullText: "控制旁路功能应用在串级副调 PID 中，主要作用是将串级副调 PID 的比例、积分、微分运算旁路，来自串级主调的 SP 经量程转换后输出。如果控制旁路 CTRBP 打开且 PIDA 在串级模式下（MODE=2），PIDA 不执行比例积分微分相关运算，PIDA 功能块的输出按照公式计算，进行限幅限速后输出。当 PIDA 模式切换到非串级模式时，自动退出控制计算旁路，在退出控制计算旁路功能后，PIDA 的输出无扰。"
      }
    ];

    const answer = answerQuestion(
      "旁路（Bypass）功能的作用是什么？启用旁路后输出值如何确定？旁路功能在调试和维护中有什么用途？",
      results
    );

    expect(answer.directAnswer).toContain("Bypass");
    expect(answer.directAnswer).toContain("功能块");
    expect(answer.directAnswer).toContain("输出");
    expect(answer.directAnswer).toContain("适用场景");
    expect(answer.directAnswer).not.toContain("这个问题更适合参考");
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
    // P0-B: evidenceResults priority change → parent aggregation now via evidence selection (2 results)
    expect(answer.citations).toHaveLength(2);
  });

  it("keeps UserSvr explicit for troubleshooting phrasing like 起不来 (avoid drifting to full workflow steps)", () => {
    const results: SearchResult[] = [
      {
        documentId: "doc-steps",
        fileName: "hollias_manual1_install.md",
        documentTitle: "第1册 软件安装",
        chunkId: "steps",
        snippet: "完整使用步骤依次为：安装、组态、编译、下装、运行。",
        score: 7.8,
        chunkIndex: 10,
        sectionTitle: "2.4 软件使用步骤（概览）",
        sectionPath: "第2章 安装 > 2.4 软件使用步骤（概览）",
        sourceUpdatedAt: "2026-04-16T00:00:00.000Z",
        importedAt: "2026-04-16T00:00:00.000Z",
        text: "完整使用步骤依次为：安装系统软件与相关组件；组态工程；编译工程；下装；运行。",
        lexicalScore: 10,
        semanticScore: 1,
        freshnessScore: 0.4,
        rerankScore: 2,
        qualityScore: 1.2,
        fullText: "完整使用步骤依次为：安装系统软件与相关组件；组态工程；编译工程；下装；运行。"
      },
      {
        documentId: "doc-troubleshoot",
        fileName: "hollias_manual1_install.md",
        documentTitle: "第1册 软件安装",
        chunkId: "usersvr",
        snippet: "当安装过程中提示 UserSvr 服务启动失败时，可检查依赖、注册与日志/事件。",
        score: 6.4,
        chunkIndex: 11,
        sectionTitle: "2.4 软件使用步骤（概览）",
        sectionPath: "第2章 安装 > 2.4 软件使用步骤（概览）",
        sourceUpdatedAt: "2026-04-16T00:00:00.000Z",
        importedAt: "2026-04-16T00:00:00.000Z",
        text: "当安装过程中提示 UserSvr 服务启动失败时，可按以下思路处理：检查服务依赖项是否已安装完成，并确认服务是否已注册；若仍失败，查看安装日志与系统事件记录。",
        lexicalScore: 12,
        semanticScore: 1.5,
        freshnessScore: 0.4,
        rerankScore: 2.2,
        qualityScore: 1.1,
        fullText:
          "当安装过程中提示 UserSvr 服务启动失败时，可按以下思路处理：检查服务依赖项是否已安装完成，并确认服务是否已注册；若仍失败，查看安装日志与系统事件记录。"
      }
    ];

    const answer = answerQuestion("UserSvr 服务一直起不来，第一步应该先查什么？", results);
    expect(answer.directAnswer).toContain("UserSvr");
    expect(answer.directAnswer).toContain("UserReg.bat");
    expect(answer.directAnswer).toContain("UserUnReg.bat");
  });

  it("does not assume UserSvr when the service name is unknown (guard against template over-trigger)", () => {
    const results: SearchResult[] = [
      {
        documentId: "doc-troubleshoot",
        fileName: "hollias_manual1_install.md",
        documentTitle: "第1册 软件安装",
        chunkId: "usersvr",
        snippet: "当安装过程中提示 UserSvr 服务启动失败时，可检查依赖、注册与日志/事件。",
        score: 10.2,
        chunkIndex: 11,
        sectionTitle: "2.4 软件使用步骤（概览）",
        sectionPath: "第2章 安装 > 2.4 软件使用步骤（概览）",
        sourceUpdatedAt: "2026-04-16T00:00:00.000Z",
        importedAt: "2026-04-16T00:00:00.000Z",
        text: "当安装过程中提示 UserSvr 服务启动失败时，可按以下思路处理：检查服务依赖项是否已安装完成，并确认服务是否已注册；若仍失败，查看安装日志与系统事件记录。",
        lexicalScore: 29.3,
        semanticScore: 1.7,
        freshnessScore: 0.4,
        rerankScore: 4.2,
        qualityScore: 1.2,
        fullText:
          "当安装过程中提示 UserSvr 服务启动失败时，可按以下思路处理：检查服务依赖项是否已安装完成，并确认服务是否已注册；若仍失败，查看安装日志与系统事件记录。"
      }
    ];

    const answer = answerQuestion("有个服务启动失败但我不知道服务名，不要默认是 UserSvr，第一步先查什么？", results);
    expect(answer.directAnswer).toContain("服务名");
    expect(answer.directAnswer).toContain("不要默认");
    expect(answer.directAnswer).toContain("不要套");
    expect(answer.directAnswer).not.toContain("1. 安装完成后尝试手动启动 UserSvr 服务。");
    expect(answer.directAnswer).not.toContain("处理结论：若安装过程提示 UserSvr 服务启动失败");
  });

  it("does not trigger service-troubleshooting guard for definition questions that contain 提示同步", () => {
    const results: SearchResult[] = [
      {
        documentId: "doc-def",
        fileName: "hollias_manual7_function_block.md",
        documentTitle: "第7册 功能块",
        chunkId: "align",
        snippet: "参数对齐：用于在下装时对比在线值与离线值，并提示用户是否进行同步。",
        score: 8.2,
        chunkIndex: 3,
        sectionTitle: "术语：参数对齐",
        sectionPath: "第7章 功能块 > 术语：参数对齐",
        sourceUpdatedAt: "2026-04-16T00:00:00.000Z",
        importedAt: "2026-04-16T00:00:00.000Z",
        text: "参数对齐：用于在下装时对比在线值与离线值，并提示用户是否进行同步。当该属性为 TRUE 时提示同步；为 FALSE 时不提示同步。",
        lexicalScore: 5,
        semanticScore: 1,
        freshnessScore: 0.4,
        rerankScore: 1.4,
        qualityScore: 0.6,
        fullText:
          "参数对齐：用于在下装时对比在线值与离线值，并提示用户是否进行同步。当该属性为 TRUE 时提示同步；为 FALSE 时不提示同步。"
      }
    ];

    const answer = answerQuestion("参数对齐到底有什么用？什么时候会提示同步？把 TRUE/FALSE 两种情况分别说明。", results);
    expect(answer.directAnswer).toContain("参数对齐");
    expect(answer.directAnswer).not.toContain("不要套用 UserSvr");
    expect(answer.directAnswer).not.toContain("UserReg.bat");
  });

  it("uses the unknown-service guard for weak install-ish phrasing like 装完后跑不起来", () => {
    const results: SearchResult[] = [
      {
        documentId: "doc-troubleshoot",
        fileName: "hollias_manual1_install.md",
        documentTitle: "第1册 软件安装",
        chunkId: "usersvr",
        snippet: "当安装过程中提示 UserSvr 服务启动失败时，可检查依赖、注册与日志/事件。",
        score: 8.8,
        chunkIndex: 11,
        sectionTitle: "2.4 软件使用步骤（概览）",
        sectionPath: "第2章 安装 > 2.4 软件使用步骤（概览）",
        sourceUpdatedAt: "2026-04-16T00:00:00.000Z",
        importedAt: "2026-04-16T00:00:00.000Z",
        text: "当安装过程中提示 UserSvr 服务启动失败时，可按以下思路处理：检查服务依赖项是否已安装完成，并确认服务是否已注册；若仍失败，查看安装日志与系统事件记录。",
        lexicalScore: 1.2,
        semanticScore: 1,
        freshnessScore: 0.4,
        rerankScore: 0.7,
        qualityScore: 1.1,
        fullText:
          "当安装过程中提示 UserSvr 服务启动失败时，可按以下思路处理：检查服务依赖项是否已安装完成，并确认服务是否已注册；若仍失败，查看安装日志与系统事件记录。"
      }
    ];

    const answer = answerQuestion("装完以后还是跑不起来，第一步先看啥？", results);
    expect(answer.directAnswer).toContain("确认");
    expect(answer.directAnswer).toContain("不要套用 UserSvr");
    expect(answer.directAnswer).not.toContain("1. 安装完成后尝试手动启动 UserSvr 服务。");
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

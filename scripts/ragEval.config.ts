import type { SupportedFileType } from "../src/lib/shared/types";
import type { EvalCase } from "../src/lib/eval/ragEval";

export interface EvalDocumentConfig {
  id: string;
  filePath: string;
  title?: string;
  parserHint?: SupportedFileType;
}

export interface EvalDatasetConfig {
  id: string;
  description: string;
  chunkSize?: number;
  chunkOverlap?: number;
  documents: EvalDocumentConfig[];
  cases: EvalCase[];
}

const hollysysInstallPdf = process.env.HOLLIAS_INSTALL_PDF
  ?? "/Users/guangyaosun/Desktop/和利时DCS操作手册/HOLLiAS_MACS_V6.5用户手册1_软件安装.pdf";
const stableDiffusionSummary =
  "/Users/guangyaosun/Documents/简历/面试资料库/03 简历项目/02 玻璃AIGC产品设计/stable_diffusion_讨论总结.md";
const stableDiffusionInterview =
  "/Users/guangyaosun/Documents/简历/面试资料库/03 简历项目/02 玻璃AIGC产品设计/stable_diffusion项目面试讲解模块（aigc玻璃设计）-2.md";
const boilerLoadDoc =
  "/Users/guangyaosun/Documents/简历/面试资料库/03 简历项目/00 自动化类+传统AI项目/LSTM预测锅炉负荷.docx";
const ragInterviewNote =
  "/Users/guangyaosun/Documents/简历/面试资料库/03 简历项目/03 天然气安全+RAG/RAG";
const guanghuiContacts =
  "/Users/guangyaosun/多设备同步文件/基点起源/基点起源项目/01 新疆哈密项目/02 哈密第二次调研/05 解决方案/02 广汇环保科技/广汇人工智能试点项目各单位人员通讯录.docx";
const guanghuiIndustryReport =
  "/Users/guangyaosun/多设备同步文件/基点起源/基点起源项目/01 新疆哈密项目/02 哈密第二次调研/05 解决方案/广汇能源产业链研究报告-AI给出.pdf";
const guanghuiSafetyCommitment =
  "/Users/guangyaosun/多设备同步文件/基点起源/基点起源项目/01 新疆哈密项目/02 哈密第二次调研/05 解决方案/02 广汇环保科技/05 交付阶段/01 施工方案/乙二醇精馏数据采集项目安全承诺书.docx";
const guanghuiPocPlan =
  "/Users/guangyaosun/多设备同步文件/基点起源/基点起源项目/01 新疆哈密项目/02 哈密第二次调研/05 解决方案/02 广汇环保科技/05 交付阶段/01 施工方案/广汇乙二醇精馏全要素智能系统POC实施方案.docx";
const guanghuiDataCollectionPlan =
  "/Users/guangyaosun/多设备同步文件/基点起源/基点起源项目/01 新疆哈密项目/02 哈密第二次调研/05 解决方案/02 广汇环保科技/05 交付阶段/01 施工方案/数据采集方案/乙二醇精馏段全要素智能系统数采项目施工方案2.docx";

export const ragEvalDatasets: EvalDatasetConfig[] = [
  {
    id: "hollysys-install-manual",
    description: "HollySys installation manual covering OPC, workstation roles, and device enable/disable flows.",
    chunkSize: 180,
    chunkOverlap: 40,
    documents: [
      {
        id: "hollysys-install",
        filePath: hollysysInstallPdf,
        title: "HOLLiAS_MACS_V6.5用户手册1_软件安装"
      }
    ],
    cases: [
      {
        id: "opc-connect",
        category: "procedure",
        question: "如何与Macs6系统进行OPC通讯？",
        expectations: [
          {
            topK: 3,
            sectionPathIncludes: ["5.4 OPC客户端"],
            evidenceIncludes: ["OPC", "通信"]
          },
          {
            topK: 3,
            sectionPathIncludes: ["5.4 OPC客户端"],
            evidenceIncludes: ["通讯", "自动运行"]
          }
        ]
      },
      {
        id: "device-disable",
        category: "troubleshooting",
        question: "如何取消U盘禁用？",
        expectations: [
          {
            topK: 2,
            sectionPathIncludes: ["3.1.4 外围设备禁用"],
            evidenceIncludes: ["禁用设备"]
          }
        ]
      },
      {
        id: "comm-station-role",
        category: "role",
        question: "通讯站有什么作用？",
        expectations: [
          {
            topK: 5,
            sectionPathIncludes: ["2.2.4 系统组成"],
            evidenceIncludes: ["通讯站", "用于安装和运行 OPC 通讯软件"]
          }
        ]
      }
    ]
  },
  {
    id: "stable-diffusion-notes",
    description: "Stable Diffusion theory and interview notes covering definition, workflow, feature libraries, and LoRA.",
    documents: [
      {
        id: "sd-summary",
        filePath: stableDiffusionSummary,
        title: "Stable Diffusion 原理与讨论总结"
      },
      {
        id: "sd-interview",
        filePath: stableDiffusionInterview,
        title: "Stable Diffusion 项目讲解模块"
      }
    ],
    cases: [
      {
        id: "sd-definition",
        category: "definition",
        question: "Stable Diffusion 本质上是什么？",
        expectations: [
          {
            topK: 2,
            sectionPathIncludes: ["Stable Diffusion 本质上是什么"],
            evidenceIncludes: ["扩散生成模型"]
          }
        ]
      },
      {
        id: "feature-library-role",
        category: "role",
        question: "特征库在这个项目里的作用是什么？",
        expectations: [
          {
            topK: 3,
            sectionPathIncludes: ["特征库的作用"],
            evidenceIncludes: ["不是用于训练模型", "用于指导生成"]
          }
        ]
      },
      {
        id: "lora-purpose",
        category: "definition",
        question: "为什么要用LoRA微调？",
        expectations: [
          {
            topK: 3,
            sectionPathIncludes: ["Stable Diffusion 微调"],
            evidenceIncludes: ["风格一致性"]
          },
          {
            topK: 3,
            sectionPathIncludes: ["LoRA 与微调"],
            evidenceIncludes: ["业务风格"]
          },
          {
            topK: 3,
            sectionPathIncludes: ["LoRA 与微调"],
            evidenceIncludes: ["风格学习"]
          }
        ]
      }
    ]
  },
  {
    id: "boiler-lstm-project",
    description: "Industrial AI project note describing LSTM-based steam load prediction and boiler feedforward control.",
    documents: [
      {
        id: "boiler-lstm",
        filePath: boilerLoadDoc,
        title: "基于LSTM的蒸汽负荷预测与锅炉前馈控制系统"
      }
    ],
    cases: [
      {
        id: "project-goal",
        category: "definition",
        question: "这个LSTM项目的主要目标是什么？",
        expectations: [
          {
            topK: 2,
            evidenceIncludes: ["降低主汽压力波动", "提高锅炉响应速度"]
          },
          {
            topK: 2,
            evidenceIncludes: ["主要目标", "降低主汽压力波动"]
          },
          {
            topK: 2,
            evidenceIncludes: ["稳定蒸汽母管压力"]
          }
        ]
      },
      {
        id: "system-architecture",
        category: "definition",
        question: "系统总体架构分为哪几层？",
        expectations: [
          {
            topK: 2,
            sectionPathIncludes: ["系统总体架构"],
            evidenceIncludes: ["数据层", "AI预测层", "控制层"]
          }
        ]
      },
      {
        id: "why-predict-steam-total",
        category: "definition",
        question: "为什么模型预测目标选择 steam_total？",
        expectations: [
          {
            topK: 2,
            sectionPathIncludes: ["预测目标选择"],
            evidenceIncludes: ["蒸汽负荷是系统扰动源"]
          }
        ]
      }
    ]
  },
  {
    id: "rag-interview-note",
    description: "RAG interview note from a solution-architecture perspective.",
    documents: [
      {
        id: "rag-note",
        filePath: ragInterviewNote,
        title: "RAG理解与面试表达",
        parserHint: "txt"
      }
    ],
    cases: [
      {
        id: "rag-definition",
        category: "definition",
        question: "RAG是什么？",
        expectations: [
          {
            topK: 2,
            evidenceIncludes: ["检索增强生成"]
          },
          {
            topK: 2,
            evidenceIncludes: ["Retrieval-Augmented Generation"]
          }
        ]
      },
      {
        id: "rag-flow",
        category: "procedure",
        question: "RAG系统的完整流程是什么？",
        expectations: [
          {
            topK: 2,
            evidenceIncludes: ["文档准备", "文本切分", "向量化", "向量检索", "LLM生成回答"]
          }
        ]
      },
      {
        id: "why-chunking",
        category: "definition",
        question: "为什么要做文档切分？",
        expectations: [
          {
            topK: 2,
            sectionPathIncludes: ["第二步：文档切分"],
            evidenceIncludes: ["提高检索精度"]
          }
        ]
      }
    ]
  },
  {
    id: "guanghui-solution-docs",
    description: "Guanghui solution, project delivery, and industry-analysis documents spanning contacts, plans, and technical reports.",
    documents: [
      {
        id: "guanghui-contacts",
        filePath: guanghuiContacts,
        title: "广汇人工智能试点项目各单位人员通讯录"
      },
      {
        id: "guanghui-industry-report",
        filePath: guanghuiIndustryReport,
        title: "广汇能源产业链研究报告"
      },
      {
        id: "guanghui-safety-commitment",
        filePath: guanghuiSafetyCommitment,
        title: "乙二醇精馏数据采集项目安全承诺书"
      },
      {
        id: "guanghui-poc-plan",
        filePath: guanghuiPocPlan,
        title: "广汇乙二醇精馏全要素智能系统POC实施方案"
      },
      {
        id: "guanghui-data-plan",
        filePath: guanghuiDataCollectionPlan,
        title: "乙二醇精馏段全要素智能系统数采项目施工方案"
      }
    ],
    cases: [
      {
        id: "contact-project-manager",
        category: "definition",
        question: "基点起源的项目经理是谁？",
        expectations: [
          {
            topK: 2,
            evidenceIncludes: ["项目经理", "孙光耀"]
          },
          {
            topK: 3,
            evidenceIncludes: ["北京基点起源/孙光耀"]
          }
        ]
      },
      {
        id: "ethylene-capacity",
        category: "definition",
        question: "广汇环保科技乙二醇设计产能是多少？",
        expectations: [
          {
            topK: 2,
            sectionPathIncludes: ["2.3 合成气制乙二醇工艺"],
            evidenceIncludes: ["设计产能", "40万吨/年乙二醇"]
          }
        ]
      },
      {
        id: "ops-management-responsibility",
        category: "definition",
        question: "我方是否承担现场生产运行管理责任？",
        expectations: [
          {
            topK: 2,
            fileNameIncludes: "乙二醇精馏数据采集项目安全承诺书",
            evidenceIncludes: ["不承担现场生产运行管理责任"]
          }
        ]
      },
      {
        id: "poc-strategy",
        category: "definition",
        question: "本项目采取什么策略？",
        expectations: [
          {
            topK: 2,
            sectionPathIncludes: ["三、POC施工计划进度"],
            evidenceIncludes: ["POC试点验证+分步推广"]
          }
        ]
      },
      {
        id: "sampling-interval",
        category: "definition",
        question: "采集周期是多少？",
        expectations: [
          {
            topK: 2,
            sectionPathIncludes: ["3 项目背景与现状"],
            evidenceIncludes: ["1秒/次"]
          }
        ]
      }
    ]
  }
];

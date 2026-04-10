import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const runId = process.env.RUN_ID || "002";

function readRawRunJson() {
  const rawPath = path.join(root, `evals/raw/sprint-5.3-run-${runId}.raw.json`);
  let text = fs.readFileSync(rawPath, "utf8").trim();
  if (!text.startsWith("{")) {
    text = `{\n${text}`;
  }
  return JSON.parse(text);
}

const raw = readRawRunJson();
const template = JSON.parse(
  fs.readFileSync(path.join(root, "docs/evals/results/sprint-5.3-run-001.json"), "utf8")
);

/** run-001 人工评判（历史基线） */
const judgments001 = {
  Q1: {
    verdict: "partial",
    score: 0.5,
    matched_gold_points: ["下装分类（部分）"],
    missed_gold_points: [
      "安装→建工程→各类组态→编译→下装→运行 主链路",
      "引用段落偏离 Q1 而命中 Q5"
    ],
    fail_modes: ["ranking_miss", "should_refuse_or_be_cautious"],
    notes:
      "检索首选 Q5 块触发谨慎模板；未按 gold 给出从安装到运行的完整步骤。合成语料中 Q1 段存在但排序靠后。"
  },
  Q2: {
    verdict: "pass",
    score: 1.0,
    matched_gold_points: ["前期准备", "建工程", "导入数据库", "算法/图形/报表/操作组态", "下装运行", "仿真非必经"],
    missed_gold_points: [],
    fail_modes: [],
    notes: "与 gold 主干一致，citation 指向 Q2 段。"
  },
  Q3: {
    verdict: "pass",
    score: 1.0,
    matched_gold_points: ["区分工具与资料", "两类均来自前期准备"],
    missed_gold_points: [],
    fail_modes: [],
    notes: "gold 条目待补全时仍可判 pass；回答结构满足 checklist。"
  },
  Q4: {
    verdict: "pass",
    score: 1.0,
    matched_gold_points: ["命名规则", "创建后是否可修改", "勿混淆名称/项目/描述"],
    missed_gold_points: [],
    fail_modes: [],
    notes: "合成语料为占位表述，未给出具体字符规则（与 gold「待补全文」一致）。"
  },
  Q5: {
    verdict: "pass",
    score: 1.0,
    matched_gold_points: ["下装定义", "四类下装", "运行非下装类型"],
    missed_gold_points: [],
    fail_modes: [],
    notes: "要点在 supporting points 与语料一致。"
  },
  Q6: {
    verdict: "partial",
    score: 0.5,
    matched_gold_points: ["提及编译与下装"],
    missed_gold_points: ["先控制器算法编译下装，再工程总控编译下装操作站/历史站 的两段顺序"],
    fail_modes: ["procedural_order_wrong", "concept_confusion"],
    notes:
      "回答掺入 Q1 全流程，未按 gold 区分控制器侧与 HMI/历史侧两阶段顺序；与「编译和下装顺序」专指 FAQ 有偏差。"
  },
  Q7: {
    verdict: "pass",
    score: 1.0,
    matched_gold_points: ["站点/测点/数据库/功能块/域间引用/域号/画面结构等触发条件", "非任意小改都要编译"],
    missed_gold_points: [],
    fail_modes: [],
    notes: ""
  },
  Q8: {
    verdict: "partial",
    score: 0.5,
    matched_gold_points: ["TRUE 时比较在线离线并提示", "非自动覆盖", "FALSE 未在 direct 明示"],
    missed_gold_points: ["FALSE 时不比较——在 direct_answer 中未完整对仗陈述"],
    fail_modes: ["constraint_missing"],
    notes: "关键句在 supporting；direct 过短。"
  },
  Q9: {
    verdict: "partial",
    score: 0.5,
    matched_gold_points: ["域间引用表", "3000 点", "全局变量与类型", "编译下装本域"],
    missed_gold_points: [],
    fail_modes: ["should_refuse_or_be_cautious"],
    notes:
      "direct_answer 套谨慎模板，但引用块实际含完整要点；属回答层模板与证据强度不匹配。"
  },
  Q10: {
    verdict: "pass",
    score: 1.0,
    matched_gold_points: ["真实控制器不支持", "仅 HiaSimuRTS", "涉及 IP/组号/AT/下装等"],
    missed_gold_points: [],
    fail_modes: [],
    notes: "关键边界在 direct_answer 中突出显示。"
  },
  Q11: {
    verdict: "partial",
    score: 0.5,
    matched_gold_points: ["手动启动", "Common 路径", "UserReg/UserUnReg 脚本名出现"],
    missed_gold_points: ["supporting 中 .bat 名称被截断显示"],
    fail_modes: ["constraint_missing"],
    notes: "要点可辨；展示层截断影响可核查性。"
  },
  Q12: {
    verdict: "pass",
    score: 1.0,
    matched_gold_points: ["24M 现象", "升级 MACSV653B+授权", "HISCP/采集周期"],
    missed_gold_points: [],
    fail_modes: [],
    notes: "方案一/二均在 supporting points 中体现。"
  }
};

/** Sprint 5.3a：在 001 基础上更新曾 partial 的五题评判 */
const judgments002 = {
  ...judgments001,
  Q1: {
    verdict: "pass",
    score: 1.0,
    matched_gold_points: ["安装→建工程→组态→编译→下装→运行 主链路（结构化 direct）"],
    missed_gold_points: [],
    fail_modes: [],
    notes:
      "5.3a：全流程 query 轻量 bias + candidate 补块后命中主链路；direct 含总述/步骤/注意，无「概述性」壳层。"
  },
  Q6: {
    verdict: "pass",
    score: 1.0,
    matched_gold_points: [
      "先控制器算法编译下装",
      "再工程总控编译下装操作站/历史站",
      "两阶段顺序与易混警示"
    ],
    missed_gold_points: [],
    fail_modes: [],
    notes: "5.3a：补入 Q6 段后按阶段一/二结构化输出，并附依据句。"
  },
  Q8: {
    verdict: "pass",
    score: 1.0,
    matched_gold_points: ["定义", "TRUE 分支", "FALSE 分支", "易混淆项"],
    missed_gold_points: [],
    fail_modes: [],
    notes: "5.3a：定义类 direct 合并 TRUE/FALSE 与易混提示。"
  },
  Q9: {
    verdict: "pass",
    score: 1.0,
    matched_gold_points: ["域间引用表", "3000 点", "全局变量与类型", "EW=TRUE 条件", "编译下装本域", "非仅网络互通"],
    missed_gold_points: [],
    fail_modes: [],
    notes: "5.3a：证据覆盖足够时不套谨慎壳；域间访问结构化 direct。"
  },
  Q11: {
    verdict: "pass",
    score: 1.0,
    matched_gold_points: ["处理结论", "手动启动", "Common 路径", "UserReg.bat / UserUnReg.bat 完整名"],
    missed_gold_points: [],
    fail_modes: [],
    notes: "5.3a：故障类结构化步骤；句子切分保留 .bat，snippet 使用防截断策略。"
  }
};

const judgments = runId === "001" ? judgments001 : judgments002;

const byId = new Map(raw.results.map((r) => [r.id, r]));

const questions = template.questions.map((q) => {
  const run = byId.get(q.id);
  if (!run) {
    return q;
  }
  const j = judgments[q.id];
  if (!j) {
    throw new Error(`Missing judgment for ${q.id}`);
  }
  return {
    ...q,
    model_answer: run.model_answer,
    model_citations: run.model_citations,
    retrieval_debug: run.retrieval_debug,
    verdict: j.verdict,
    score: j.score,
    matched_gold_points: j.matched_gold_points,
    missed_gold_points: j.missed_gold_points,
    fail_modes: j.fail_modes,
    notes: j.notes ? `${q.notes ? `${q.notes} ` : ""}${j.notes}`.trim() : q.notes
  };
});

const out = {
  ...template,
  run_id: `sprint-5.3-run-${runId}`,
  generated_at: new Date().toISOString(),
  status: "completed",
  corpus_note:
    "答案基于仓库内 docs/evals/fixtures/sprint-5.3-synthetic-corpus.md（评测专用合成语料），非厂商手册原文；用于本地 RAG 管道回归，不替代真实文档评测。",
  questions
};

fs.mkdirSync(path.join(root, "evals/results"), { recursive: true });
const outPath = path.join(root, `evals/results/sprint-5.3-run-${runId}.json`);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
console.log(`Wrote ${path.relative(root, outPath)}`);

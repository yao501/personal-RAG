/**
 * 验证 BAAI/bge-small-zh-v1.5 嵌入模型是否正常加载
 * Usage: node --max-old-space-size=2048 ./node_modules/.bin/vite-node scripts/verifyEmbedModelUpgrade.ts
 */
import { embedTexts, cosineSimilarity } from "../src/lib/modules/embed/localEmbedder";

const tests: Array<{ label: string; pairs: [string, string]; expect: "high" | "low" }> = [
  {
    label: "功能块术语 ↔ 功能块术语 (应高)",
    pairs: ["基本运算功能块包括 ADD SUB MUL DIV", "PID 控制器 PVU PVL 参数"],
    expect: "high"
  },
  {
    label: "功能块术语 ↔ 无关内容 (应低)",
    pairs: ["基本运算功能块 ADD SUB MUL DIV", "图形软件安装和卸载步骤"],
    expect: "low"
  },
  {
    label: "符号库 ↔ 符号库 (应高)",
    pairs: ["MOT1 符号库用于马达电机", "VAL1 符号库用于阀门控制"],
    expect: "high"
  },
  {
    label: "中文同义 ↔ 中文同义 (应高)",
    pairs: ["在线修改参数的方法", "如何在运行中调整参数值"],
    expect: "high"
  },
  {
    label: "PVU/PVL 精确匹配",
    pairs: ["PID 功能块的 PVU 和 PVL 表示量程上下限", "PVU 是过程量上限 PVL 是过程量下限"],
    expect: "high"
  }
];

async function main() {
  console.log("🧪 bge-small-zh-v1.5 语义匹配验证\n");

  const allTexts = tests.flatMap(t => [t.pairs[0], t.pairs[1]]);
  console.log("加载模型并嵌入...");
  const start = Date.now();
  const vecs = await embedTexts(allTexts);
  const elapsed = (Date.now() - start) / 1000;

  console.log(`  维度: ${vecs[0].length}`);
  console.log(`  耗时: ${elapsed.toFixed(1)}s`);
  console.log(`  样本数: ${vecs.length}\n`);

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    const sim = cosineSimilarity(vecs[i * 2], vecs[i * 2 + 1]);
    const ok = t.expect === "high" ? sim > 0.3 : sim < 0.3;
    const emoji = ok ? "✅" : "❌";
    console.log(`${emoji} ${t.label}: sim=${sim.toFixed(4)} (预期${t.expect})`);
    if (ok) passed++; else failed++;
  }

  console.log(`\n📊 ${passed}/${tests.length} 通过`);
  if (failed > 0) {
    console.log("⚠️ 部分测试未通过，需检查模型适配");
  } else {
    console.log("✅ bge-small-zh-v1.5 中文语义匹配正常");
  }
}

main().catch(e => {
  console.error("❌", e.message);
  process.exit(1);
});

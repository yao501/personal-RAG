/** P0-B 诊断：检测 A4 的 queryIntent */
import { detectQueryIntent } from "../src/lib/modules/retrieve/queryIntent";

const qs = [
  "MACS V6.5 的仿真功能和在线调试功能有什么区别？分别在哪本手册中说明？使用仿真前需要完成哪些前置步骤？",
  "MACS V6.5 如何进行仿真？",
];

for (const q of qs) {
  const intent = detectQueryIntent(q);
  console.log(`Q: ${q.slice(0,50)}...`);
  console.log(`  wantsSteps: ${intent.wantsSteps}`);
  console.log(`  wantsDefinition: ${intent.wantsDefinition}`);
  console.log(`  wantsTroubleshooting: ${intent.wantsTroubleshooting}`);
  console.log(`  wantsLocation: ${intent.wantsLocation}`);
  console.log(`  tokens: ${intent.queryTokens.join(", ")}`);
}

/** P0-B: debug noise detection for A4 */
import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "../src/lib/modules/parse/parseDocument";
import { chunkText } from "../src/lib/modules/chunk/chunkText";
import { runRetrievalLikeDesktop } from "../src/lib/modules/retrieve/retrievalPipeline";

const dir = process.env.PKRAG_REALPDF_DIR!;
const names = fs.readdirSync(dir, { withFileTypes: true })
  .filter(d => d.isFile() && d.name.endsWith(".pdf"))
  .map(d => d.name).filter(n => /手册[34]_/.test(n)).sort();

const docs: any[] = []; const chs: any[] = [];
for (const name of names) {
  const parsed = await parseDocument(path.join(dir, name));
  const dc = chunkText(name.slice(0,40), parsed.content, { chunkSize:260, chunkOverlap:60, documentTitle:name.replace(".pdf",""), pageSpans:parsed.pageSpans });
  docs.push({ id:name.slice(0,40), filePath:path.join(dir,name), fileName:name, title:name.replace(".pdf",""), fileType:parsed.fileType, content:parsed.content, importedAt:new Date().toISOString(), updatedAt:new Date().toISOString(), sourceCreatedAt:new Date().toISOString(), sourceUpdatedAt:new Date().toISOString(), chunkCount:dc.length });
  chs.push(...dc);
}

const q = "MACS V6.5 的仿真功能和在线调试功能有什么区别？分别在哪本手册中说明？使用仿真前需要完成哪些前置步骤？";
const { results } = await runRetrievalLikeDesktop(q, docs, chs, { limit:5, hydrateEmbeddings:true });

const isNoise = (r: any) => {
  const meta = [r.sectionTitle, r.sectionPath].filter(Boolean).join(" ").toLowerCase();
  const m1 = /文档用途|阅读对象|文档更新|全局变量|名词缩写|版权声明/.test(meta);
  const m2 = /仿真|下装|编译|组态|调试/.test(meta.slice(0,60));
  return { meta: meta.slice(0,120), isNoise: m1 && !m2 };
};

console.log("Top-5 results:");
results.slice(0,5).forEach((r, i) => {
  const n = isNoise(r);
  console.log(`[${i}] ${r.fileName}`);
  console.log(`  sectionTitle: ${r.sectionTitle}`);
  console.log(`  isNoise: ${n.isNoise} (meta_has_noise=${/文档用途|阅读对象|文档更新|全局变量|名词缩写|版权声明/.test(n.meta)}, has_core=${/仿真|下装|编译|组态|调试/.test(n.meta.slice(0,60))})`);
  console.log(`  score: ${r.score?.toFixed(1)} q:${r.qualityScore?.toFixed(2)}`);
  console.log(`  first 80 text chars: ${r.text.slice(0,80)}`);
});

const usableTop = results.find((r: any) => !isNoise(r).isNoise && r.score >= 0.8);
console.log(`\nusableTop idx: ${usableTop ? results.indexOf(usableTop) : 'not found'}`);
if (usableTop) {
  const hasStep = /步骤|流程|可以|选择|打开|安装|运行|设置|启用|禁用|执行|先|再|然后|即可|可在|需要|应当|注意|依次/.test(usableTop.text);
  console.log(`usableTop has step-like content: ${hasStep}`);
  console.log(`usableTop text first 200: ${usableTop.text.slice(0,200)}`);
}

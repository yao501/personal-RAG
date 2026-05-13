/** P0-A Round 2：修复后完整验证 A1-A4 */
import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "../src/lib/modules/parse/parseDocument";
import { chunkText } from "../src/lib/modules/chunk/chunkText";
import { answerQuestion } from "../src/lib/modules/answer/answerQuestion";
import { runRetrievalLikeDesktop, DEFAULT_RETRIEVAL_LIMIT } from "../src/lib/modules/retrieve/retrievalPipeline";

const dir = process.env.PKRAG_REALPDF_DIR!;
const names = fs.readdirSync(dir, { withFileTypes: true })
  .filter(d => d.isFile() && d.name.endsWith(".pdf"))
  .map(d => d.name).filter(n => /手册[2-4]_/.test(n)).sort();

const docs: any[] = []; const chs: any[] = [];
for (const name of names) {
  const parsed = await parseDocument(path.join(dir, name));
  const dc = chunkText(name.slice(0,40), parsed.content, { chunkSize:260, chunkOverlap:60, documentTitle:name.replace(".pdf",""), pageSpans:parsed.pageSpans });
  docs.push({ id:name.slice(0,40), filePath:path.join(dir,name), fileName:name, title:name.replace(".pdf",""), fileType:parsed.fileType, content:parsed.content, importedAt:new Date().toISOString(), updatedAt:new Date().toISOString(), sourceCreatedAt:new Date().toISOString(), sourceUpdatedAt:new Date().toISOString(), chunkCount:dc.length });
  chs.push(...dc);
}

const cases = [
  { id:"A1", q:"在 HOLLiAS MACS V6.5 中，工程组态完成后，编译和下装的完整流程是怎样的？需要分别在哪些软件中进行编译操作？" },
  { id:"A2", q:"MACS V6.5 工程编译完成后，下装操作需要将文件下发到哪些目标站？控制器的下装和工程总控的下装各有什么不同？" },
  { id:"A3", q:"从新建工程到最终在线运行，MACS V6.5 工程组态的完整操作顺序是什么？编译、下装、调试分别在哪个阶段执行？" },
  { id:"A4", q:"MACS V6.5 的仿真功能和在线调试功能有什么区别？分别在哪本手册中说明？使用仿真前需要完成哪些前置步骤？" }
];

function judge(id: string, direct: string) {
  const t = direct;
  const m: string[] = [], mi: string[] = [];
  const n = (c: boolean, ok: string, bad: string) => c ? m.push(ok) : mi.push(bad);
  switch(id) {
    case "A1": n(/编译/.test(t),"提到编译","未提及编译"); n(/工程总控|AutoThink|控制器/.test(t),"区分编译方","未区分编译方"); n(/算法|控制站|控制器算法/.test(t),"涉及控制器侧","遗漏控制器侧"); n(/全编译|增量编译|FULL_COMPILE|ADD_COMPILE|编译设置/.test(t),"涉及编译方式","编译方式不足"); break;
    case "A2": n(/下装/.test(t),"提到下装","未提下装"); n(/历史站|操作站|报表/.test(t),"目标站","缺目标站"); n(/控制器|控制站/.test(t),"区分控制器下装","缺控制器"); n(/下装文件|数据生效/.test(t),"下装文件/数据生效","缺数据生效"); break;
    case "A3": n(/组态|工程/.test(t),"组态阶段","缺组态"); n(/编译/.test(t),"编译阶段","缺编译"); n(/下装/.test(t),"下装阶段","缺下装"); n(/运行|在线|调试|操作/.test(t),"运行阶段","缺运行"); n(/先.*后|然后|接着|最后|步骤|流程|顺序|阶段/.test(t),"有序","缺顺序"); break;
    case "A4": n(/仿真/.test(t),"提到仿真","缺仿真"); n(/调试|在线/.test(t),"提到调试","缺调试"); n(/编译|下装/.test(t),"仿真的前置步骤","缺前置步骤"); if(t.includes("仿真")&&t.includes("调试"))m.push("区分仿真调试");else mi.push("仿真调试不完整"); break;
  }
  let v: string; if(mi.length===0)v="pass"; else if(mi.length<=2)v="partial"; else v="fail";
  return { verdict:v, score:v==="pass"?1:v==="partial"?0.5:0, matched:m, missed:mi };
}

for (const c of cases) {
  const { results } = await runRetrievalLikeDesktop(c.q, docs, chs, { limit:DEFAULT_RETRIEVAL_LIMIT, hydrateEmbeddings:true });
  const ans = answerQuestion(c.q, results);
  const j = judge(c.id, ans.directAnswer);
  const e = j.verdict==="pass"?"✅":j.verdict==="partial"?"⚠️":"❌";
  console.log(`${e} ${c.id} [${j.verdict.toUpperCase()}] score=${j.score}`);
  console.log(`  + ${j.matched.join("; ")}`);
  if(j.missed.length) console.log(`  - ${j.missed.join("; ")}`);
  console.log(`  ${ans.directAnswer.slice(0,200)}`);
}

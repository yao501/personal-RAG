/**
 * C线 技术债诊断：检查 PDF 解析的章节归属和 TOC 污染问题
 * Usage:
 *   PKRAG_REALPDF_DIR="$HOME/Desktop/和利时DCS操作手册" \
 *   node --max-old-space-size=2048 \
 *   ./node_modules/.bin/vite-node scripts/diagnoseParseQuality.ts
 */
import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "../src/lib/modules/parse/parseDocument";
import { chunkText } from "../src/lib/modules/chunk/chunkText";

const dir = process.env.PKRAG_REALPDF_DIR!;
if (!dir) { console.error("Set PKRAG_REALPDF_DIR"); process.exit(1); }

interface Issue {
  kind: "toc_ghost" | "chapter_misattr" | "empty_section" | "noise_chapter";
  file: string;
  sectionPath: string;
  snippet: string;
}

const issues: Issue[] = [];
const noiseKeywords = [
  "全局变量", "文档用途", "阅读对象", "重要信息", "产品文档目录",
  "版权声明", "使用约定", "文档更新", "关于本文档", "关于本书"
];

async function diagnose(filePath: string, fileName: string) {
  console.log(`\n📄 ${fileName.slice(24, 35)}...`);
  const parsed = await parseDocument(filePath);
  const docId = "diag-" + fileName.slice(0, 30);
  const chunks = chunkText(docId, parsed.content, {
    chunkSize: 260, chunkOverlap: 60,
    documentTitle: fileName.replace(".pdf", ""),
    pageSpans: parsed.pageSpans
  });
  console.log(`   ${chunks.length} chunks`);

  // Check section path quality
  const sectionPaths = new Map<string, number>();
  let emptyPathCount = 0;
  let noisePathCount = 0;

  for (const ch of chunks) {
    const sp = ch.sectionPath || "(空)";
    sectionPaths.set(sp, (sectionPaths.get(sp) || 0) + 1);

    if (!ch.sectionPath || ch.sectionPath.trim() === "") {
      emptyPathCount++;
    }

    // Check for TOC ghost text (lines that look like TOC entries with dots)
    if (/\d+\.\d+.*\.{3,}\s*\d+/.test(ch.text)) {
      issues.push({
        kind: "toc_ghost",
        file: fileName,
        sectionPath: sp,
        snippet: ch.text.substring(0, 120)
      });
    }

    // Check for noise chapters
    for (const nk of noiseKeywords) {
      if (sp.includes(nk)) {
        noisePathCount++;
        break;
      }
    }
  }

  console.log(`   空 sectionPath: ${emptyPathCount}`);
  console.log(`   噪音 sectionPath: ${noisePathCount}`);

  // Show top 10 section paths
  const topPaths = [...sectionPaths.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  console.log(`   Top sectionPaths:`);
  for (const [p, n] of topPaths) {
    console.log(`     [${n} chunks] ${p.substring(0, 100)}`);
  }
}

async function main() {
  const pdfs = fs.readdirSync(dir)
    .filter(f => f.endsWith(".pdf") && f.includes("用户手册"))
    .sort();

  console.log(`🔍 诊断 ${pdfs.length} 个手册 PDF...`);

  for (const pdf of pdfs) {
    await diagnose(path.join(dir, pdf), pdf);
  }

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log(`📊 诊断总结`);
  console.log(`${"=".repeat(60)}`);

  const tocGhosts = issues.filter(i => i.kind === "toc_ghost");
  console.log(`\nTOC ghost text 污染: ${tocGhosts.length} 处`);
  if (tocGhosts.length > 0) {
    console.log("  示例:");
    tocGhosts.slice(0, 3).forEach(i => {
      console.log(`    [${i.file.slice(24, 35)}] ${i.snippet.substring(0, 80)}`);
    });
  }

  if (issues.length === 0) {
    console.log("\n✅ 未发现明显解析问题");
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });

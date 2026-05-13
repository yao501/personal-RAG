/**
 * 深度提取手册5、手册7的章节结构（含子章节）
 * Usage:
 *   PKRAG_REALPDF_DIR="$HOME/Desktop/和利时DCS操作手册" \
 *   node --max-old-space-size=2048 \
 *   ./node_modules/.bin/vite-node scripts/inspectVolumes57.ts
 */
import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "../src/lib/modules/parse/parseDocument";

const dir = process.env.PKRAG_REALPDF_DIR!;
if (!dir) { console.error("Set PKRAG_REALPDF_DIR"); process.exit(1); }

const targets = [
  "HOLLiAS_MACS_V6.5用户手册5_图形编辑.pdf",
  "HOLLiAS_MACS_V6.5用户手册7_功能块.pdf",
];

for (const name of targets) {
  const fp = path.join(dir, name);
  if (!fs.existsSync(fp)) continue;

  const short = name.slice(24, 30);
  console.log(`\n${"=".repeat(70)}`);
  console.log(`📄 ${short} — ${name}`);
  console.log(`${"=".repeat(70)}`);

  const parsed = await parseDocument(fp);
  const text = parsed.content;

  // Extract all lines that look like chapter/section headers
  const lines = text.split("\n");
  const headers: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.length > 100) continue;
    // Chinese chapter headers
    if (/^第[一二三四五六七八九十\d]+[章节]/.test(t)) {
      headers.push(t);
      continue;
    }
    // Numbered sections like 5.1, 5.1.1
    if (/^\d+\.\d+(\.\d+)?\s+\S/.test(t) && t.length < 60) {
      headers.push(t);
      continue;
    }
    // "常见问题" patterns
    if (/^\d+\.\d+\s+(Q|问)[：:]/.test(t) && t.length < 100) {
      headers.push(t);
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  let count = 0;
  for (const h of headers) {
    const key = h.replace(/\s+/g, " ").substring(0, 50);
    if (seen.has(key)) continue;
    seen.add(key);
    if (count < 80) {
      console.log(`  ${h}`);
      count++;
    }
  }
  if (headers.length > 80) console.log(`  ... (共 ${headers.length} 条，仅显示前 80)`);

  // Extract FAQ / common issues section
  const faqIdx = text.indexOf("常见问题");
  if (faqIdx >= 0) {
    console.log(`\n--- 常见问题区 (约500字) ---`);
    console.log(text.substring(faqIdx, faqIdx + 800));
  }

  // Extract some sample content from key chapters
  const keyChapters = short === "手册5"
    ? ["绘制流程图", "绘制操作面板", "图形特性", "交互特性", "符号库"]
    : ["基本运算", "高级运算", "控制运算", "I/O处理", "PID", "MOT"];

  for (const kw of keyChapters) {
    const idx = text.indexOf(kw);
    if (idx >= 0) {
      const ctx = text.substring(Math.max(0, idx - 30), idx + 300);
      console.log(`\n--- 关键词 "${kw}" 上下文 ---`);
      console.log(ctx.replace(/\n{3,}/g, "\n\n"));
    }
  }
}

console.log("\n✅ 完成");

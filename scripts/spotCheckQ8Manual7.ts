/**
 * Narrow Q8-family spot check on a single real PDF (manual 7).
 *
 * Goal: Compare chunking BEFORE vs AFTER B4 rule by toggling `pageSpans`:
 * - AFTER: pass `pageSpans` from `parseDocument` (PDF path => B4 rule enabled)
 * - BEFORE: omit `pageSpans` (simulates pre-B4 behavior without changing code)
 *
 * Usage:
 *   export PKRAG_REALPDF_DIR="$HOME/Desktop/和利时DCS操作手册"
 *   ./node_modules/.bin/vite-node scripts/spotCheckQ8Manual7.ts
 */
import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "../src/lib/modules/parse/parseDocument";
import { chunkText } from "../src/lib/modules/chunk/chunkText";

function findManual7Pdf(dir: string): string {
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((n) => /^HOLLiAS_MACS_V6\.5用户手册7_.+\.pdf$/i.test(n));
  if (names.length === 0) {
    throw new Error(`未找到 HOLLiAS_MACS_V6.5用户手册7_*.pdf：${dir}`);
  }
  // Prefer 功能块
  names.sort((a, b) => (a.includes("功能块") === b.includes("功能块") ? a.localeCompare(b) : a.includes("功能块") ? -1 : 1));
  return path.join(dir, names[0]!);
}

function hasKeyBundle(chunkTextValue: string, sectionTitle: string | null): boolean {
  const headOk = sectionTitle === "参数对齐" || /参数对齐/.test(chunkTextValue);
  return (
    headOk &&
    /TRUE/i.test(chunkTextValue) &&
    /FALSE/i.test(chunkTextValue) &&
    /在线值/.test(chunkTextValue) &&
    /离线值/.test(chunkTextValue) &&
    /值比较/.test(chunkTextValue) &&
    /同步/.test(chunkTextValue)
  );
}

function isTableNoiseCandidate(sectionTitle: string | null, text: string): boolean {
  const title = sectionTitle ?? "";
  if (/^\s*\d+(?:\.\d+)+/.test(title)) return true;
  if (/(?:^0\.\d+|否\s+否\s+否|请赋值|点名\.|OVE)/.test(title)) return true;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const shortLines = lines.filter((l) => l.length <= 10).length;
  const boolish = lines.filter((l) => /^(?:TRUE|FALSE|是|否|0|1|0\.\d+)/i.test(l)).length;
  return lines.length >= 4 && shortLines / lines.length >= 0.65 && boolish >= 2;
}

function summarize(label: string, chunks: Array<{ sectionTitle: string | null; sectionPath: string | null; text: string }>) {
  const keyBundleHits = chunks.filter((c) => hasKeyBundle(c.text, c.sectionTitle));
  const paramAlignAny = chunks.filter((c) => c.sectionTitle === "参数对齐" || c.text.includes("参数对齐"));
  const tableNoise = chunks.filter((c) => isTableNoiseCandidate(c.sectionTitle, c.text));

  const topParamAlign = [...paramAlignAny]
    .sort((a, b) => (b.text.length ?? 0) - (a.text.length ?? 0))
    .slice(0, 5)
    .map((c) => ({
      sectionTitle: c.sectionTitle,
      sectionPath: c.sectionPath,
      preview: c.text.replace(/\s+/g, " ").slice(0, 140)
    }));

  const topNoise = [...tableNoise]
    .slice(0, 8)
    .map((c) => ({
      sectionTitle: c.sectionTitle,
      sectionPath: c.sectionPath,
      preview: c.text.replace(/\s+/g, " ").slice(0, 110)
    }));

  return {
    label,
    totalChunks: chunks.length,
    paramAlignChunks: paramAlignAny.length,
    keyBundleChunks: keyBundleHits.length,
    tableNoiseChunks: tableNoise.length,
    topParamAlign,
    topNoise
  };
}

async function main(): Promise<void> {
  const dir = process.env.PKRAG_REALPDF_DIR?.trim();
  if (!dir || !fs.existsSync(dir)) {
    console.error("请设置 PKRAG_REALPDF_DIR 指向真实 PDF 目录（含 HOLLiAS_MACS_V6.5用户手册7_*.pdf）");
    process.exit(1);
  }

  const pdfPath = findManual7Pdf(dir);
  const parsed = await parseDocument(pdfPath);
  const title = path.basename(pdfPath).replace(/\.pdf$/i, "");

  const afterChunks = chunkText("spot-manual7-after", parsed.content, {
    chunkSize: 260,
    chunkOverlap: 60,
    documentTitle: title,
    pageSpans: parsed.pageSpans
  });

  const beforeChunks = chunkText("spot-manual7-before", parsed.content, {
    chunkSize: 260,
    chunkOverlap: 60,
    documentTitle: title
    // pageSpans omitted => PDF-path-only coalesce rule is disabled
  });

  const after = summarize("after(B4 enabled: pageSpans present)", afterChunks);
  const before = summarize("before(B4 disabled: pageSpans omitted)", beforeChunks);

  const out = {
    pdf: pdfPath,
    title,
    cue: "参数对齐 / TRUE / FALSE / 在线值 / 离线值 / 值比较 / 同步",
    before,
    after
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


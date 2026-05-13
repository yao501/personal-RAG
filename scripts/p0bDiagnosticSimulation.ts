import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "../src/lib/modules/parse/parseDocument";
import { chunkText } from "../src/lib/modules/chunk/chunkText";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = process.env.PKRAG_REALPDF_DIR!;
const file = path.join(dir, "HOLLiAS_MACS_V6.5用户手册3_工程总控.pdf");

const parsed = await parseDocument(file);
const chunks = chunkText("test", parsed.content, {
  chunkSize: 260,
  chunkOverlap: 60,
  documentTitle: "手册3_工程总控",
  pageSpans: parsed.pageSpans
});

// Find chunks around 仿真
const simChunks = chunks.filter((c) => c.text.includes("仿真"));
console.log("Total chunks:", chunks.length);
console.log("Chunks containing '仿真':", simChunks.length);

const sections = [...new Set(simChunks.map((c) => c.sectionTitle).filter(Boolean))];
console.log("\nUnique sectionTitles for 仿真 chunks:");
sections.slice(0, 15).forEach((t) => console.log("  -", t));

console.log("\nSample 仿真 chunks:");
simChunks.slice(0, 5).forEach((c, i) => {
  console.log(`\n[${i}] sectionTitle: ${c.sectionTitle}`);
  console.log(`    sectionPath: ${c.sectionPath || "(none)"}`);
  console.log(`    page: ${c.pageNumber ?? "?"}`);
  console.log(`    text: ${c.text.slice(0, 200)}`);
});

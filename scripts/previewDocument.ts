import { parseDocument } from "../src/lib/modules/parse/parseDocument";

const filePath = process.argv[2];
const limit = Number(process.argv[3] ?? 4000);

if (!filePath) {
  console.error("Usage: vite-node scripts/previewDocument.ts <file-path> [char-limit]");
  process.exit(1);
}

const parsed = await parseDocument(filePath);
console.log(`File type: ${parsed.fileType}`);
console.log(parsed.content.slice(0, limit));

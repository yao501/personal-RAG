import fs from "node:fs/promises";
import path from "node:path";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import type { SupportedFileType } from "../../shared/types";

export function getSupportedFileType(filePath: string): SupportedFileType | null {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".pdf") return "pdf";
  if (extension === ".md") return "md";
  if (extension === ".txt") return "txt";
  if (extension === ".docx") return "docx";
  return null;
}

async function parsePdf(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const result = await pdfParse(buffer);
  return result.text;
}

async function parseDocx(filePath: string): Promise<string> {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

export async function parseDocument(filePath: string): Promise<{ fileType: SupportedFileType; content: string }> {
  const fileType = getSupportedFileType(filePath);
  if (!fileType) {
    throw new Error(`Unsupported file type for ${filePath}`);
  }

  if (fileType === "txt" || fileType === "md") {
    const content = await fs.readFile(filePath, "utf8");
    return { fileType, content };
  }

  if (fileType === "pdf") {
    return { fileType, content: await parsePdf(filePath) };
  }

  return { fileType, content: await parseDocx(filePath) };
}


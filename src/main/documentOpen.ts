import path from "node:path";
import { pathToFileURL } from "node:url";
import { isAllowedExternalOpenTarget } from "./security";

export function buildDocumentOpenTarget(filePath: string, pageNumber?: number | null): string {
  const normalizedPage = typeof pageNumber === "number" && Number.isFinite(pageNumber) && pageNumber > 0
    ? Math.floor(pageNumber)
    : null;
  const isPdf = path.extname(filePath).toLowerCase() === ".pdf";

  if (!isPdf || normalizedPage === null) {
    return filePath;
  }

  const url = pathToFileURL(filePath);
  url.hash = `page=${normalizedPage}`;
  return url.toString();
}

export function shouldUseExternalDocumentOpenTarget(target: string): boolean {
  return isAllowedExternalOpenTarget(target);
}

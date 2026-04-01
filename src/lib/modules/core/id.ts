import { createHash } from "node:crypto";

export function createStableId(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}


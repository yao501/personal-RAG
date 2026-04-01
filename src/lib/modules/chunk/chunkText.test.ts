import { describe, expect, it } from "vitest";
import { chunkText } from "./chunkText";

describe("chunkText", () => {
  it("creates overlapping chunks", () => {
    const text = "one two three four five six seven eight nine ten";
    const chunks = chunkText("doc-1", text, { chunkSize: 4, chunkOverlap: 1 });

    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.text).toBe("one two three four");
    expect(chunks[1]?.text).toBe("four five six seven");
    expect(chunks[2]?.text).toBe("seven eight nine ten");
  });
});


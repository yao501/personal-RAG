import type { ChatAnswer, SearchResult } from "../../shared/types";

function createBulletSummary(results: SearchResult[]): string[] {
  return results.slice(0, 3).map((result, index) => {
    const sentence = result.text
      .split(/(?<=[.!?。！？])\s+/)
      .find((part) => part.trim().length > 0) ?? result.text;

    return `${index + 1}. ${sentence.trim()} [${result.fileName}#${result.chunkIndex + 1}]`;
  });
}

export function answerQuestion(question: string, results: SearchResult[]): ChatAnswer {
  if (results.length === 0) {
    return {
      answer:
        "I could not find grounded evidence for that question in the current library. Try importing more files or rephrasing the question.",
      citations: []
    };
  }

  const bullets = createBulletSummary(results);
  const answer = [
    `Question: ${question}`,
    "",
    "Grounded answer:",
    ...bullets,
    "",
    "Citations are attached below so you can inspect the original source passages."
  ].join("\n");

  return {
    answer,
    citations: results.map(({ text: _text, ...citation }) => citation)
  };
}


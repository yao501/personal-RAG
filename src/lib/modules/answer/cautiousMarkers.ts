import type { ChatAnswer } from "../../shared/types";

export const CAUTIOUS_PROCEDURAL_ANSWER_MARKER = "概述性内容";

export function isCautiousProceduralAnswer(answer: ChatAnswer): boolean {
  return answer.directAnswer.includes(CAUTIOUS_PROCEDURAL_ANSWER_MARKER);
}

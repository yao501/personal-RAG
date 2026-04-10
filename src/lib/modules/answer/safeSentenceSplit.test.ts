import { describe, expect, it } from "vitest";
import { splitSentenceLikePreservingTechnicalDots } from "./safeSentenceSplit";

describe("splitSentenceLikePreservingTechnicalDots", () => {
  it("does not split UserUnReg.bat across sentences", () => {
    const s = "在安装目录下运行 `UserUnReg.bat`。然后重启服务。";
    const parts = splitSentenceLikePreservingTechnicalDots(s);
    expect(parts.some((p) => p.includes("UserUnReg.bat"))).toBe(true);
    expect(parts.find((p) => p.includes("UserUnReg"))).toContain("UserUnReg.bat");
  });
});

import { describe, expect, it } from "vitest";
import { truncateSnippetPreservingIdentifiers } from "./snippetTruncate";

describe("truncateSnippetPreservingIdentifiers", () => {
  it("extends cut position to keep a .bat filename when maxLen would land inside the token", () => {
    const long =
      "安装过程中若提示 UserSvr 服务启动失败，安装完成后可手动启动 UserSvr 服务。在安装目录 `\\HOLLiAS_MACS\\Common` 下运行 `UserReg.bat` 进行注册。若提示删除 UserSvr 服务失败，则运行 `UserUnReg.bat`。";
    const out = truncateSnippetPreservingIdentifiers(long, 90);
    expect(out).toContain("UserReg.bat");
    expect(out.endsWith("…")).toBe(true);
  });
});

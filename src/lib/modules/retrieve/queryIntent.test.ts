import { describe, expect, it } from "vitest";
import { detectQueryIntent } from "./queryIntent";

describe("detectQueryIntent", () => {
  it("routes procedural queries with recency hints correctly", () => {
    const intent = detectQueryIntent("最新版本里如何配置 OPC 通讯？");

    expect(intent.primary).toBe("procedural");
    expect(intent.wantsRecency).toBe(true);
    expect(intent.wantsSteps).toBe(true);
  });

  it("routes troubleshooting queries separately from explanatory ones", () => {
    const intent = detectQueryIntent("设备启动失败应该怎么排查？");

    expect(intent.primary).toBe("troubleshooting");
    expect(intent.wantsTroubleshooting).toBe(true);
    expect(intent.wantsDefinition).toBe(false);
  });
});

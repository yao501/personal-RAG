import { describe, expect, it } from "vitest";
import { detectQueryIntent } from "./queryIntent";
import { expandQueryTokens } from "./queryFeatures";

function expansionsFor(query: string): string[] {
  return expandQueryTokens(query, detectQueryIntent(query));
}

describe("expandQueryTokens", () => {
  it("expands basic operation block acronyms into Chinese operation terms", () => {
    const expansions = expansionsFor("ADD、SUB、MUL、DIV 这些基本运算功能块有什么特点？");

    expect(expansions).toEqual(expect.arrayContaining(["加法运算", "减法运算", "乘法运算", "除法运算"]));
  });

  it("expands PID range acronyms into process and engineering range terms", () => {
    const expansions = expansionsFor("PVU/PVL 和 ENGU/ENGL 参数分别表示什么？");

    expect(expansions).toEqual(expect.arrayContaining(["过程量上限", "过程量下限", "工程量上限", "工程量下限"]));
  });

  it("expands advanced operation block acronyms into function descriptions", () => {
    const expansions = expansionsFor("SWITCH、ORSEL、MULDIV、SUMMER_CTRL 分别有什么功能？");

    expect(expansions).toEqual(expect.arrayContaining(["信号选择开关", "超驰选择", "乘除", "RC求和"]));
  });

  it("expands bypass questions into English and control-bypass parameter anchors", () => {
    const expansions = expansionsFor("旁路（Bypass）功能有什么作用？");

    expect(expansions).toEqual(expect.arrayContaining(["Bypass", "BYPASS", "控制旁路", "输入旁路", "CTRBP"]));
  });

  it("expands graphics symbol library acronyms into equipment terms", () => {
    const expansions = expansionsFor("MOT 系列符号库和 VAL 系列符号库各有什么用途？");

    expect(expansions).toEqual(expect.arrayContaining(["马达", "电机", "阀门", "符号库"]));
  });
});

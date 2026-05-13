import type { QueryIntent } from "./queryIntent";

export function isGenericQueryToken(token: string): boolean {
  const genericPrefixes = ["如何", "怎么", "怎样", "请问", "请教", "为什么", "为何"];
  const genericSuffixes = ["啊", "呀", "吗", "呢", "一下"];
  const genericStandalone = ["解决", "处理", "方法", "办法", "问题", "教程"];

  if (genericStandalone.includes(token)) {
    return true;
  }

  if (genericPrefixes.some((prefix) => token.startsWith(prefix) && token.length <= prefix.length + 2)) {
    return true;
  }

  if (genericSuffixes.some((suffix) => token.endsWith(suffix) && token.length <= suffix.length + 3)) {
    return true;
  }

  return false;
}

function anchorScore(token: string): number {
  const hasHan = /[\p{Script=Han}]/u.test(token);
  const hasLatinOrNumber = /[a-z0-9]/i.test(token);

  if (hasHan && hasLatinOrNumber) {
    return 10;
  }

  if (hasHan && token.length >= 2 && token.length <= 3) {
    return 8;
  }

  if (hasLatinOrNumber && token.length >= 2) {
    return 7;
  }

  if (hasHan && token.length === 4) {
    return 4;
  }

  return 1;
}

function isUsefulAnchorToken(token: string): boolean {
  const hasHan = /[\p{Script=Han}]/u.test(token);
  const hasLatinOrNumber = /[a-z0-9]/i.test(token);

  if (hasHan && hasLatinOrNumber) {
    return /^[a-z0-9]{1,6}[\p{Script=Han}]{1,2}$|^[\p{Script=Han}]{1,2}[a-z0-9]{1,6}$/iu.test(token);
  }

  if (hasLatinOrNumber) {
    return token.length >= 2;
  }

  if (!hasHan || token.length < 2 || token.length > 3) {
    return false;
  }

  if (/^[何怎如请为啥那这哪]/u.test(token) || /[啊呀吗呢吧嘛]$/u.test(token)) {
    return false;
  }

  if (["如何", "怎么", "怎样", "请问", "为何", "为啥"].some((prefix) => token.startsWith(prefix))) {
    return false;
  }

  return true;
}

export function selectAnchorTokens(queryTokens: string[]): string[] {
  return [...queryTokens]
    .filter((token, index, array) => {
      if (token.length < 2 || array.indexOf(token) !== index || isGenericQueryToken(token)) {
        return false;
      }

      if (!isUsefulAnchorToken(token)) {
        return false;
      }

      if (/^[\p{Script=Han}]+$/u.test(token) && token.length > 4) {
        return false;
      }

      return true;
    })
    .sort((left, right) => {
      const scoreGap = anchorScore(right) - anchorScore(left);
      if (scoreGap !== 0) {
        return scoreGap;
      }
      return right.length - left.length;
    })
    .slice(0, 5);
}

export function isRoleQuestion(query: string): boolean {
  return /(作用|用途|干什么|做什么|有什么用|用来做什么)/.test(query);
}

export function isWhyQuestion(query: string): boolean {
  return /(为什么|为何|原因|为啥|why)/i.test(query);
}

export function isFlowQuestion(query: string): boolean {
  return /(流程|步骤|过程|顺序|链路|怎么做|如何做|怎样做)/.test(query);
}

export function isGoalQuestion(query: string): boolean {
  return /(目标|目的|想达到什么|要达到什么)/.test(query);
}

interface QueryExpansionRule {
  matches: RegExp[];
  expansions: string[];
}

const DCS_TERM_EXPANSION_RULES: QueryExpansionRule[] = [
  {
    matches: [/\b(?:add|sub|mul|div|sqrt)\b/i, /基本运算|算术运算|四则运算/],
    expansions: [
      "基本运算",
      "加法",
      "减法",
      "乘法",
      "除法",
      "开方",
      "加法运算",
      "减法运算",
      "乘法运算",
      "除法运算",
      "算术运算"
    ]
  },
  {
    matches: [/\b(?:pvu|pvl)\b/i],
    expansions: ["PID", "过程量", "过程量上限", "过程量下限", "量程上限", "量程下限", "测量值", "输入量程"]
  },
  {
    matches: [/\b(?:engu|engl)\b/i],
    expansions: ["PID", "工程量", "工程量上限", "工程量下限", "工程单位", "输出量程", "量程转换"]
  },
  {
    matches: [/\bdeadband\b/i, /死区/],
    expansions: ["死区", "偏差", "波动", "抑制", "控制精度", "PID"]
  },
  {
    matches: [/\bbypass\b/i, /旁路/],
    expansions: ["Bypass", "BYPASS", "旁路", "控制旁路", "输入旁路", "CTRBP", "BYPASS1", "BYPASS2", "调试", "维护"]
  },
  {
    matches: [/\bswitch\b/i, /选择开关/],
    expansions: ["信号选择开关", "选择开关", "开关选择", "条件选择", "切换", "选择功能块"]
  },
  {
    matches: [/\borsel\b/i, /或选择|超驰选择/],
    expansions: ["超驰选择", "或选择", "高选", "低选", "OR选择", "逻辑或", "选择输出", "选择功能块"]
  },
  {
    matches: [/\bmuldiv\b/i, /乘除运算|乘除/],
    expansions: ["乘除", "乘除运算", "乘法", "除法", "比例因子", "偏置", "高级运算"]
  },
  {
    matches: [/\bsummer(?:_ctrl)?\b/i, /累加器|RC求和|求和/],
    expansions: ["RC求和", "累加", "累加器", "求和", "加和", "高级运算"]
  },
  {
    matches: [/\bmot[1-4d]?\b/i, /MOT\s*系列/i],
    expansions: ["符号库", "马达", "电机", "风机", "马达符号", "电机符号", "MOTCTRL"]
  },
  {
    matches: [/\bval[1-3]?\b/i, /VAL\s*系列/i],
    expansions: ["符号库", "阀门", "阀", "阀门符号", "调节阀", "VALCTRL"]
  },
  {
    matches: [/\b(?:motctrl|valctrl)\b/i],
    expansions: ["控制运算", "马达控制", "阀门控制", "反馈信号", "电机反馈", "阀门反馈"]
  }
];

function pushUnique(target: string[], values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

function expandDcsTechnicalTerms(query: string): string[] {
  const expansions: string[] = [];

  for (const rule of DCS_TERM_EXPANSION_RULES) {
    if (rule.matches.some((pattern) => pattern.test(query))) {
      pushUnique(expansions, rule.expansions);
    }
  }

  return expansions;
}

export function expandQueryTokens(query: string, intent: QueryIntent): string[] {
  const expansions: string[] = [];

  if (intent.wantsDefinition && isRoleQuestion(query)) {
    expansions.push("用于", "功能", "负责", "实现", "完成");
  }

  if (intent.wantsSteps && /(如何|怎么|怎样)/.test(query)) {
    expansions.push("步骤", "配置", "连接", "设置");
  }

  if (isFlowQuestion(query)) {
    expansions.push("流程", "步骤", "首先", "然后", "最后", "依次");
  }

  if (isWhyQuestion(query)) {
    expansions.push("因为", "由于", "原因", "因此", "从而", "取决于");
  }

  if (isGoalQuestion(query)) {
    expansions.push("目标", "目的");
  }

  if (/重叠|overlap/i.test(query)) {
    expansions.push("overlap", "重叠", "截断");
  }

  if (/切分|切片|chunk(ing)?/i.test(query)) {
    expansions.push("切分", "切片", "chunk");
  }

  // P0-B: 工程领域术语扩展 — 解决中文技术术语检索断层
  if (/仿真/i.test(query)) {
    expansions.push("模拟运行", "仿真系统", "仿真模式", "单机仿真", "联机仿真", "HiaSimuRTS");
  }
  if (/调试/i.test(query)) {
    expansions.push("在线", "调试模式", "动态调试", "在线调试");
  }
  if (/编译/i.test(query)) {
    expansions.push("全编译", "增量编译", "FULL_COMPILE", "ADD_COMPILE", "编译结果");
  }
  if (/下装/i.test(query)) {
    expansions.push("数据生效", "下装文件", "下装操作", "全下装");
  }
  if (/组态/i.test(query)) {
    expansions.push("工程组态", "算法组态", "硬件配置", "图形编辑");
  }

  pushUnique(expansions, expandDcsTechnicalTerms(query));

  return expansions;
}

export function maxConsecutiveTokenMatch(queryTokens: string[], contextText: string): number {
  let maxMatch = 0;
  const normalizedText = contextText.toLowerCase();

  for (const token of queryTokens) {
    if (normalizedText.includes(token.toLowerCase())) {
      maxMatch = Math.max(maxMatch, token.length);
    }
  }

  return maxMatch;
}

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

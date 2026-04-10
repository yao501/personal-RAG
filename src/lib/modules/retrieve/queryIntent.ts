import { tokenize } from "./tokenize";

export interface QueryIntent {
  primary: "procedural" | "explanatory" | "troubleshooting" | "navigational" | "general";
  wantsRecency: boolean;
  wantsSteps: boolean;
  wantsDefinition: boolean;
  wantsTroubleshooting: boolean;
  wantsLocation: boolean;
  queryTokens: string[];
}

const RECENCY_PATTERN = /\b(latest|recent|new|newest|current|today|yesterday|this year|updated|recently)\b|最新|最近|当前|新版|更新|近期/i;
const DEFINITION_PATTERN = /什么是|是什么|定义|原理|概念|区别|作用|含义|介绍|说明|what is|definition|overview|principle/i;
const PROCEDURAL_PATTERN = /如何|怎么|怎样|步骤|方式|方法|配置|设置|启用|禁用|安装|使用|打开|启动|连接|通讯|通信|导入|重建|setup|configure|install|enable|disable|connect|use/i;
const TROUBLESHOOTING_PATTERN = /无法|不能|失败|报错|错误|异常|故障|排查|修复|恢复|没反应|问题|失效|why.*fail|error|issue|troubleshoot|debug|fix/i;
const LOCATION_PATTERN = /在哪|哪里|哪一章|哪个章节|位置|路径|菜单|入口|在哪个|where|which section|which chapter|path|menu/i;

export function detectQueryIntent(query: string): QueryIntent {
  const normalized = query.trim();
  const wantsRecency = RECENCY_PATTERN.test(normalized);
  const wantsDefinition = DEFINITION_PATTERN.test(normalized);
  const wantsSteps = PROCEDURAL_PATTERN.test(normalized);
  const wantsTroubleshooting = TROUBLESHOOTING_PATTERN.test(normalized);
  const wantsLocation = LOCATION_PATTERN.test(normalized);

  let primary: QueryIntent["primary"] = "general";
  if (wantsTroubleshooting) {
    primary = "troubleshooting";
  } else if (wantsSteps) {
    primary = "procedural";
  } else if (wantsDefinition) {
    primary = "explanatory";
  } else if (wantsLocation) {
    primary = "navigational";
  }

  return {
    primary,
    wantsRecency,
    wantsSteps,
    wantsDefinition,
    wantsTroubleshooting,
    wantsLocation,
    queryTokens: tokenize(normalized)
  };
}

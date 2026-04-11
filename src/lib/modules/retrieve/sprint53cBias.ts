import type { SearchResult } from "../../shared/types";
import { isFullWorkflowInstallQuery } from "./fullWorkflowBias";
import type { QueryRetrievalType } from "./queryRetrievalType";
import { resolveQueryRetrievalType } from "./queryRetrievalType";

const M1_INSTALL = /用户手册1_软件安装/i;
const M2_QUICK = /用户手册2_快速入门/i;
const M3_ENG = /用户手册3_工程总控/i;
const M5_GRAPHICS = /用户手册5_图形编辑/i;
const M7_FB = /用户手册7_功能块/i;

function fileNameOf(r: SearchResult): string {
  return r.fileName ?? "";
}

function rescore(results: SearchResult[], deltaFor: (r: SearchResult) => number): SearchResult[] {
  const scored = results.map((r) => {
    const d = deltaFor(r);
    const adj = r.score + d;
    return { r: { ...r, score: adj }, adj };
  });
  scored.sort((a, b) => b.adj - a.adj);
  return scored.map((x) => x.r);
}

/**
 * Sprint 5.3c：多卷手册 query 路由 + 全流程顺序偏置 + 无关分册噪声惩罚。
 * - Part A：安装/流程/编译域间/功能块 等措辞 → 偏置对应分册（手册1/2、3、7）。
 * - Part B：全流程类问题 → 提升顺序链与手册1/2 中工程主链片段；压低手册5 中海康/视频等噪声块。
 */
export function applySprint53cRetrievalBias(
  question: string,
  results: SearchResult[],
  queryType: QueryRetrievalType = resolveQueryRetrievalType(question)
): SearchResult[] {
  if (results.length === 0) {
    return results;
  }
  const q = question.trim();

  const installOrFlow =
    queryType === "procedural_full_flow" ||
    /(?:安装|快速入门|完整步骤|完整使用|从\s*安装|全流程|投运|整体流程|先做什么|后做什么|主链路|到\s*[^。！？\n]{0,24}运行|依次|环节)/.test(q) ||
    isFullWorkflowInstallQuery(q);
  const engOrCross =
    queryType === "compile_order" || /(?:编译|下装|域间|分组|工程总控|引用表|操作站|历史站)/.test(q);
  const fbOrAlign = /(?:参数对齐|TRUE|FALSE|功能块|功能块参数|属性)/i.test(q);
  const wf =
    queryType === "procedural_full_flow" ||
    isFullWorkflowInstallQuery(q) ||
    /(?:完整步骤|全流程|整体流程|主链路|环节|依次做|依次完成|依次|完整使用步骤)/.test(q);

  return rescore(results, (r) => {
    const f = fileNameOf(r);
    const t = `${r.sectionTitle ?? ""}\n${r.text}`;
    let d = 0;

    if (installOrFlow) {
      if (M1_INSTALL.test(f) || M2_QUICK.test(f)) {
        d += wf ? 3.6 : 0.88;
      }
      if (M3_ENG.test(f) && /(?:安装|入门|步骤|流程)/.test(t)) {
        d += 0.15;
      }
    }
    if (engOrCross && M3_ENG.test(f)) {
      d += 0.82;
    }
    if (fbOrAlign && M7_FB.test(f)) {
      d += 0.9;
    }

    if (wf) {
      if (/(?:首先|然后|接着|之后|再|最后|依次)/.test(t) && /(?:安装|组态|编译|下装|运行|系统|工程)/.test(t)) {
        d += 0.42;
      }
      if ((M1_INSTALL.test(f) || M2_QUICK.test(f)) && /(?:安装|工程|组态|数据库|编译|下装|运行|软件使用步骤)/.test(t)) {
        d += 0.38;
      }
      const chainSignal =
        /(?:完整使用步骤依次为|先安装系统软件|软件使用步骤|创建工程|工程组态|编译工程|编译|下装|运行系统)/.test(t);
      const graphicsNoise =
        M5_GRAPHICS.test(f) &&
        /(?:海康|HKVideo|HKVideoCtrl|视频控件|矢量图控件|喘振|嵌入\s*DCS|监控画面)/.test(t) &&
        !chainSignal;
      if (graphicsNoise) {
        d -= 22;
      } else if (M5_GRAPHICS.test(f) && !chainSignal) {
        d -= 18;
      } else if (M5_GRAPHICS.test(f) && chainSignal && /(?:海康|视频控件|矢量图|喘振)/.test(t)) {
        d -= 8;
      }
      if (
        M3_ENG.test(f) &&
        /先编译后下装/.test(t) &&
        !/(?:软件使用步骤|安装系统|创建工程|完整使用步骤依次为)/.test(t)
      ) {
        d -= 6;
      }
    }

    if (fbOrAlign && M7_FB.test(f) && /参数对齐/.test(t) && /TRUE/i.test(t) && /FALSE/i.test(t)) {
      d += 2.4;
    }

    if (fbOrAlign && M5_GRAPHICS.test(f) && !/(?:参数|功能块|对齐|TRUE|FALSE)/i.test(t)) {
      d -= 0.35;
    }

    return d;
  });
}

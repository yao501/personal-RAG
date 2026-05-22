import type { ChunkContentKind, ChunkContextMetadata, ChunkRecord, DocumentRecord } from "../../shared/types";
import { extractSectionRootLabel, splitSectionPath } from "../citation/sectionRoot";
import { getManualFamilyLabel, matchManualFamily } from "./sourcePrior";

function detectContentKind(text: string): ChunkContentKind {
  if (/(故障|异常|失败|报错|无法|处理|解决|排查|原因分析)/.test(text)) {
    return "troubleshooting";
  }
  if (/(步骤|单击|点击|选择|进入|设置|配置|执行|下装|编译|启动|停止|勾选|依次)/.test(text)) {
    return "procedure";
  }
  if (/(参数|取值|范围|TRUE|FALSE|PVU|PVL|ENGU|ENGL|Deadband|旁路|Bypass)/i.test(text)) {
    return "parameter_reference";
  }
  if (/(是指|表示|用于|用来|作用|功能|说明|定义|简介|概述)/.test(text)) {
    return "definition";
  }
  if (/(^|\n)\s*(?:\S+\s+){3,}\S+\s*(?:\n|$)/.test(text) && /(?:参数|名称|类型|说明|范围|默认值)/.test(text)) {
    return "table_like";
  }
  return "general";
}

function extractTechnicalTerms(text: string): string[] {
  const matches = text.match(/\b[A-Z][A-Z0-9_/-]{2,}\b/g) ?? [];
  const terms = matches
    .map((term) => term.replace(/^[-_/]+|[-_/]+$/g, ""))
    .filter((term) => term.length >= 3 && !/^\d+$/.test(term));
  return [...new Set(terms)].slice(0, 12);
}

export function buildChunkContextMetadata(document: DocumentRecord, chunk: ChunkRecord): ChunkContextMetadata {
  const manualFamilyId = matchManualFamily(document.fileName);
  const sectionParts = splitSectionPath(chunk.sectionPath);
  const contextText = [document.title, document.fileName, chunk.sectionPath, chunk.sectionTitle, chunk.text].filter(Boolean).join("\n");

  return {
    manualFamilyId,
    manualFamilyLabel: getManualFamilyLabel(manualFamilyId),
    sectionDepth: sectionParts.length,
    sectionRoot: extractSectionRootLabel(chunk.sectionPath),
    contentKind: detectContentKind(contextText),
    technicalTerms: extractTechnicalTerms(contextText)
  };
}

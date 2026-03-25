/**
 * Agent 模板服务 — 从本地文件加载 SOUL.md / MEMORY.md 模板
 *
 * 模板文件位于 data/templates/ 目录：
 *   - soul-default.md       主 Agent SOUL（通用助手，有协作能力）
 *   - soul-professional.md  专业 Agent SOUL（领域专家，无协作能力）
 *
 * 铁律（含记忆规则）已迁移到 AGENTS.md 模板（docs/reference/templates/AGENTS.md）。
 * 身份信息由 IDENTITY.md 单独管理，SOUL 模板只定义行为准则。
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../utils/logger';

const logger = createLogger('SoulTemplate');

// 内存缓存：文件路径 → { content, mtime }
const cache = new Map<string, { content: string; mtime: number }>();

/** 默认的主 Agent 模板（fallback，正常从文件读取） */
const DEFAULT_SOUL_TEMPLATE = `# 工作准则

## 沟通风格
- 使用中文回复
- 先给结论/结果，再给必要解释
- 简洁专业，不废话

## 核心原则
1. 严格按用户指令执行，不擅自替换方案
2. 无法执行时直接说明原因
3. 优先用工具解决问题，不空谈
4. 不编造数据，不虚构结果

## MCP 工具使用规则
- **使用任何 MCP 工具前，先调用 \`memory_recall\` 搜索该工具的使用经验和教训**（如：\`memory_recall("MCP xxx 经验教训")\`），回顾之前犯过的错误，避免重蹈覆辙
- 调用前简要说明工具名和参数
- 返回结果用中文总结关键信息，不要原样转储 JSON
- 大量数据做结构化整理（表格、列表）
- 调用失败时告知原因并建议替代方案
- **如果调用过程中遇到了报错或踩坑，用 \`memory_store\` 记录经验教训**，下次避免同样的错误

## Skill 使用规则
- **执行任何 Skill 前，必须完成以下两步：**
  1. **搜索记忆**：调用 \`memory_recall("技能名 经验教训")\` 搜索该技能的历史使用经验和教训，阅读并遵守
  2. **阅读说明**：阅读该 Skill 目录下的 \`skill.md\`，严格按照其中定义的流程和规范执行
- 所有产出文件（结果、中间数据）统一放到 \`$SESSION_DIR\` 目录
- 生成 HTML 报告时，数据必须内嵌到 HTML 中，不要引用外部文件路径
- **Skill 执行过程中遇到报错或发现配置问题，必须用 \`memory_store\` 记录经验教训**（importance=1.0, category=fact），确保下次不再犯同样的错误

## 记忆
- 用户要求"记住"的内容必须存储到长期记忆
- 对话开始时主动回忆用户的偏好和准则
- **使用工具/技能前先搜索相关经验教训，踩坑后主动存储教训**

## 协作
- 涉及专业领域时，优先委派给对应的专业 Agent
- 不确定该委派给谁时，先查看可用的 Agent 列表
`;

/** 默认的专业 Agent 模板（fallback） */
const PROFESSIONAL_SOUL_TEMPLATE = `# 工作准则

## 沟通风格
- 使用中文回复
- 先给结论/结果，再给必要解释
- 简洁专业，不废话

## 核心原则
1. 严格按用户指令执行，不擅自替换方案
2. 无法执行时直接说明原因
3. 优先用工具解决问题，不空谈
4. 不编造数据，不虚构结果

## MCP 工具使用规则
- **使用任何 MCP 工具前，先调用 \`memory_recall\` 搜索该工具的使用经验和教训**（如：\`memory_recall("MCP xxx 经验教训")\`），回顾之前犯过的错误，避免重蹈覆辙
- 调用前简要说明工具名和参数
- 返回结果用中文总结关键信息，不要原样转储 JSON
- 大量数据做结构化整理（表格、列表）
- 调用失败时告知原因并建议替代方案
- **如果调用过程中遇到了报错或踩坑，用 \`memory_store\` 记录经验教训**，下次避免同样的错误

## Skill 使用规则
- **执行任何 Skill 前，必须完成以下两步：**
  1. **搜索记忆**：调用 \`memory_recall("技能名 经验教训")\` 搜索该技能的历史使用经验和教训，阅读并遵守
  2. **阅读说明**：阅读该 Skill 目录下的 \`skill.md\`，严格按照其中定义的流程和规范执行
- 所有产出文件（结果、中间数据）统一放到 \`$SESSION_DIR\` 目录
- 生成 HTML 报告时，数据必须内嵌到 HTML 中，不要引用外部文件路径
- **Skill 执行过程中遇到报错或发现配置问题，必须用 \`memory_store\` 记录经验教训**（importance=1.0, category=fact），确保下次不再犯同样的错误

## 记忆
- 用户要求"记住"的内容必须存储到长期记忆
- 对话开始时主动回忆用户的偏好和准则
- **使用工具/技能前先搜索相关经验教训，踩坑后主动存储教训**
`;

/**
 * 读取模板文件（带 mtime 缓存，文件修改后自动刷新）
 */
function readTemplateFile(filePath: string, fallback: string): string {
  try {
    const stat = fs.statSync(filePath);
    const mtime = stat.mtimeMs;
    const cached = cache.get(filePath);
    if (cached && cached.mtime === mtime) {
      return cached.content;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    cache.set(filePath, { content, mtime });
    return content;
  } catch {
    return fallback;
  }
}

/**
 * 确保模板目录和默认文件存在
 */
export function ensureAgentTemplates(dataRoot: string): void {
  const dir = path.join(dataRoot, 'templates');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const files: [string, string][] = [
    ['soul-default.md', DEFAULT_SOUL_TEMPLATE],
    ['soul-professional.md', PROFESSIONAL_SOUL_TEMPLATE],
  ];
  for (const [name, content] of files) {
    const filePath = path.join(dir, name);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, 'utf-8');
      logger.info(`已生成默认模板: ${name}`);
    }
  }
}

/**
 * 获取 SOUL 模板内容
 *
 * @param dataRoot  数据根目录（如 ./data）
 * @param agentName Agent 名称（'default' 为主 agent）
 */
export function getSoulTemplate(
  dataRoot: string,
  agentName: string,
): string {
  const isDefault = agentName === 'default';
  const templateFile = isDefault ? 'soul-default.md' : 'soul-professional.md';
  const fallback = isDefault ? DEFAULT_SOUL_TEMPLATE : PROFESSIONAL_SOUL_TEMPLATE;

  const filePath = path.join(dataRoot, 'templates', templateFile);
  return readTemplateFile(filePath, fallback);
}

/**
 * 获取 MEMORY.md 初始内容（纯数据文件，铁律已迁移到 AGENTS.md）
 *
 * @param dataRoot     数据根目录
 * @param displayName  Agent 显示名称（用于标题）
 */
export function getMemoryTemplate(_dataRoot: string, displayName: string): string {
  return `# MEMORY.md - ${displayName}\n\n> 这里记录你的长期记忆。记忆规则详见 AGENTS.md 铁律部分。\n`;
}

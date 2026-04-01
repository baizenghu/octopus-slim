/**
 * load-agents-dir.ts — Markdown 文件定义的 Agent 加载器
 *
 * 允许企业用户通过在 data/agents/ 目录中放置 Markdown 文件来定义自定义 Agent，
 * 无需编写任何代码（零代码方式）。
 *
 * 文件格式：
 * ---
 * name: code-reviewer
 * description: 审查代码质量和安全
 * model: deepseek-chat
 * allowedTools:
 *   - FileRead
 *   - Grep
 *   - Glob
 * ---
 * （正文 = 系统提示词）
 *
 * ─── 三层来源优先级（高→低）──────────────────────────────────────────────────
 * 1. DB 中已有的 Agent（手动创建，优先级最高）
 *    ownerId 不为 '_markdown'，或已存在且 source != 'markdown'
 * 2. data/agents/ 目录的 Markdown 定义（自动加载，可被 DB 覆盖）
 *    通过此文件加载，写入 DB 时标记 identity._source = 'markdown'
 * 3. 引擎内建 Agent（不在此文件处理）
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 注意：若 DB 中已有同名 Agent 且 identity._source != 'markdown'，则跳过不覆盖。
 */

import * as fs from "fs/promises";
import * as path from "path";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import { parse as parseYaml } from "yaml";

const log = createSubsystemLogger("agent-orchestration");

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

/** Agent Markdown 文件解析结果 */
export interface AgentMarkdownDef {
  /** Agent 唯一名称（frontmatter name 字段） */
  name: string;
  /** Agent 描述（可选） */
  description?: string;
  /** 使用的模型名称（可选，覆盖全局默认） */
  model?: string;
  /** 允许使用的原生工具列表（可选） */
  allowedTools?: string[];
  /** 系统提示词（frontmatter 以下的正文） */
  systemPrompt: string;
  /** 来源文件绝对路径 */
  sourcePath: string;
}

/** frontmatter 中允许的字段类型 */
interface FrontmatterFields {
  name?: unknown;
  description?: unknown;
  model?: unknown;
  allowedTools?: unknown;
}

// ─── 内部工具函数 ──────────────────────────────────────────────────────────────

/**
 * 将未知值安全转为字符串，若无法转则返回 undefined
 */
function toStringOrUndef(val: unknown): string | undefined {
  if (typeof val === "string" && val.trim().length > 0) return val.trim();
  return undefined;
}

/**
 * 将未知值安全转为字符串数组，只保留字符串元素
 */
function toStringArrayOrUndef(val: unknown): string[] | undefined {
  if (!Array.isArray(val)) return undefined;
  const result = val.filter((v): v is string => typeof v === "string");
  return result.length > 0 ? result : undefined;
}

/**
 * 将 Markdown 文件内容分割为 frontmatter 和正文。
 * 格式：文件以 `---` 开头，第二个 `---` 之后为正文。
 *
 * @returns [frontmatterStr, bodyStr] 或 [null, 全文] 若无 frontmatter
 */
function splitFrontmatter(content: string): [string | null, string] {
  const lines = content.split("\n");

  // 必须以 --- 开头（可有前置空格，但规范格式不应有）
  if (lines[0]?.trim() !== "---") {
    return [null, content];
  }

  // 找第二个 ---
  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    // 未找到结束标记，视为无 frontmatter
    return [null, content];
  }

  const frontmatter = lines.slice(1, endIndex).join("\n");
  const body = lines.slice(endIndex + 1).join("\n").trim();
  return [frontmatter, body];
}

// ─── 导出函数 ──────────────────────────────────────────────────────────────────

/**
 * 解析单个 Agent Markdown 文件。
 *
 * @param filePath 文件绝对路径
 * @returns 解析结果 AgentMarkdownDef
 * @throws 若文件不可读、frontmatter 解析失败或缺少 name 字段
 */
export async function parseAgentMarkdown(filePath: string): Promise<AgentMarkdownDef> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Failed to read agent file: ${filePath}`, { error: msg });
    throw new Error(`Cannot read agent file ${filePath}: ${msg}`);
  }

  const [frontmatterStr, body] = splitFrontmatter(content);

  if (frontmatterStr === null) {
    throw new Error(`Agent file has no frontmatter (---) section: ${filePath}`);
  }

  let parsed: FrontmatterFields;
  try {
    const raw = parseYaml(frontmatterStr) as unknown;
    if (typeof raw !== "object" || raw === null) {
      throw new Error("frontmatter must be a YAML object");
    }
    parsed = raw as FrontmatterFields;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Failed to parse frontmatter in: ${filePath}`, { error: msg });
    throw new Error(`Invalid frontmatter YAML in ${filePath}: ${msg}`);
  }

  const name = toStringOrUndef(parsed.name);
  if (!name) {
    throw new Error(`Agent file missing required 'name' field: ${filePath}`);
  }

  // 校验 name 格式（只允许字母、数字、连字符、下划线）
  if (!/^[\w-]+$/.test(name)) {
    throw new Error(
      `Agent name '${name}' contains invalid characters (only alphanumeric, hyphen, underscore allowed): ${filePath}`,
    );
  }

  const systemPrompt = body;
  if (!systemPrompt) {
    throw new Error(`Agent file has empty system prompt (body after frontmatter): ${filePath}`);
  }

  return {
    name,
    description: toStringOrUndef(parsed.description),
    model: toStringOrUndef(parsed.model),
    allowedTools: toStringArrayOrUndef(parsed.allowedTools),
    systemPrompt,
    sourcePath: filePath,
  };
}

/**
 * 扫描目录，批量加载所有 `.md` 文件为 AgentMarkdownDef。
 *
 * 解析失败的文件会记录错误日志并跳过，不影响其他文件的加载。
 *
 * @param agentsDir 目录绝对路径
 * @returns 成功解析的 AgentMarkdownDef 数组（不含失败项）
 */
export async function loadAgentsFromDir(agentsDir: string): Promise<AgentMarkdownDef[]> {
  // 检查目录是否存在
  try {
    const stat = await fs.stat(agentsDir);
    if (!stat.isDirectory()) {
      log.warn(`agents dir is not a directory, skipping: ${agentsDir}`);
      return [];
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // ENOENT 是正常情况（目录尚未创建）
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      log.info(`agents dir not found, skipping markdown agent loading: ${agentsDir}`);
    } else {
      log.error(`Failed to stat agents dir: ${agentsDir}`, { error: msg });
    }
    return [];
  }

  let entries: string[];
  try {
    entries = await fs.readdir(agentsDir);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Failed to read agents dir: ${agentsDir}`, { error: msg });
    return [];
  }

  const mdFiles = entries.filter(
    (f) => f.endsWith(".md") && !f.startsWith("."),
  );

  if (mdFiles.length === 0) {
    log.info(`No .md files found in agents dir: ${agentsDir}`);
    return [];
  }

  log.info(`Found ${mdFiles.length} agent file(s) in ${agentsDir}`);

  const results: AgentMarkdownDef[] = [];
  let failed = 0;

  for (const file of mdFiles) {
    const filePath = path.join(agentsDir, file);
    try {
      const def = await parseAgentMarkdown(filePath);
      results.push(def);
      log.info(`Loaded agent definition: ${def.name} (${file})`);
    } catch (err: unknown) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Failed to load agent file, skipping: ${file}`, { error: msg });
    }
  }

  log.info(
    `Agent dir loading complete: ${results.length} succeeded, ${failed} failed`,
    { dir: agentsDir },
  );

  return results;
}

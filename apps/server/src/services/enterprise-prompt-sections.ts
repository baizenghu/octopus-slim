/**
 * enterprise-prompt-sections.ts — 企业级 System Prompt 段落构建（纯函数）
 *
 * 统一 SystemPromptBuilder / enterprise-mcp 插件 / IMRouter 三处的段落构建逻辑。
 * 所有数据查询由调用方完成，本模块只负责格式化。
 */

// ── 辅助函数 ──────────────────────────────────────────────────────

/** 清除字符串中的换行符和 Markdown 控制字符，防止 prompt 注入 */
function sanitize(value: string): string {
  return value.replace(/[\n\r]/g, ' ').replace(/[`*_~\[\]]/g, '').trim();
}

// ── 类型定义 ──────────────────────────────────────────────────────

export interface EnterpriseSectionParams {
  /** 用户 ID */
  userId: string;
  /** 用户名 */
  username: string;
  /** 显示名（可选） */
  displayName?: string;
  /** Agent 名称 */
  agentName: string;
  /** 是否为 default agent */
  isDefault: boolean;
  /** 工作区路径（可选，路径不可用时跳过工作区段落） */
  workspacePaths?: {
    root: string;
    files: string;
    outputs: string;
    temp: string;
  };
  /** 可委派的专业 Agent 列表（仅 default agent 需要） */
  specialists?: Array<{
    name: string;
    displayName: string;
    description?: string;
  }>;
  /** 允许的数据库连接（已过滤，只传白名单内的） */
  dbConnections?: Array<{
    name: string;
    dbType: string;
    dbName: string;
    host: string;
    port: number;
    dbUser: string;
  }>;
  /** Agent 自定义指令（system_prompt 字段） */
  agentInstructions?: string;
  /** 是否包含 IM 安全约束（IM 渠道比 Web 更严格） */
  imSafetyConstraints?: boolean;
}

// ── 构建函数 ──────────────────────────────────────────────────────

/**
 * @deprecated 使用 buildBehaviorSections + buildContextSections（双通道）替代。
 * 保留此函数仅为向后兼容，新代码不应调用。
 */
export function buildEnterpriseSections(params: EnterpriseSectionParams): string {
  const sections: string[] = [];

  // ── 身份 ──
  if (params.isDefault) {
    const name = sanitize(params.displayName || params.username);
    sections.push(
      `## 你的身份\n` +
      `你是 Octopus AI 企业级超级智能助手，是用户 ${name} 的主助手。\n` +
      `自我介绍时只说"我是 Octopus AI"，不要说"Octopus AI AI 助手"或其他重复 AI 的表述。`,
    );
  }

  // ── 用户信息 ──
  const userDisplay =
    params.displayName && params.displayName !== params.username
      ? `${sanitize(params.username)} (${sanitize(params.displayName)})`
      : sanitize(params.username);
  sections.push(`## 用户信息\n当前用户: ${userDisplay}`);

  // ── 工作区 ──
  if (params.workspacePaths) {
    const { root, files, outputs, temp } = params.workspacePaths;
    let workspaceText =
      `## 工作区\n` +
      `工作空间根目录: ${root}\n` +
      `用户上传文件: ${files}\n` +
      `用户可下载文件: ${outputs}\n` +
      `临时工作目录: ${temp}\n\n` +
      `**文件管理规范：**\n` +
      `- files/：用户上传的文件，只读取不修改\n` +
      `- outputs/：交付给用户的成果文件。系统会**自动**将 outputs/ 中的新文件发送给用户（包括 IM 渠道）\n` +
      `- temp/：中间产物（脚本、临时数据、草稿）写入此目录\n` +
      `- 不要在工作空间根目录直接创建文件`;

    if (params.imSafetyConstraints) {
      workspaceText +=
        `\n\n**安全约束（必须遵守）：**\n` +
        `- 所有文件读写操作只能在 ${root} 目录内进行\n` +
        `- 严禁访问、读取或修改该目录之外的任何文件或目录\n` +
        `- 严禁访问其他用户的目录或系统敏感文件（如 /etc/passwd、~/.ssh 等）\n` +
        `- Shell 命令在沙箱容器内执行，可以使用 exec 工具运行命令`;
    }

    sections.push(workspaceText);
  }

  // ── Agent 指令 ──
  if (params.agentInstructions) {
    sections.push(`## Agent 指令\n${params.agentInstructions}`);
  }

  // ── 专业 Agent 列表（仅 default agent） ──
  if (params.isDefault && params.specialists && params.specialists.length > 0) {
    const list = params.specialists
      .map((a) => {
        const desc = a.description ? ` — ${a.description}` : '';
        return `- **${a.displayName}**（agent 名称: ${a.name}）${desc}`;
      })
      .join('\n');
    sections.push(
      `## 任务委派（sessions_spawn）\n` +
      `你可以使用 sessions_spawn 工具将专业任务委派给以下 Agent：\n${list}\n\n` +
      `**委派原则：**\n` +
      `- 日常问答、闲聊、简单查询 → 自己处理\n` +
      `- 涉及专业 Agent 职能范围的任务 → 用 sessions_spawn 委派\n` +
      `- 委派时 task 参数写清楚具体任务，agentId 传 Agent 的完整 ID（格式：ent_用户ID_Agent名称）\n` +
      `- 子 Agent 完成后结果会自动回传给你，你负责整理后回复用户\n` +
      `- 不确定是否需要委派时，自己处理`,
    );
  }

  // ── 数据库连接 ──
  if (params.dbConnections && params.dbConnections.length > 0) {
    const lines = [
      '## 数据库连接',
      '调用 SQL 相关工具时需要传入 connection_name 参数：',
      '',
    ];
    for (const c of params.dbConnections) {
      lines.push(`- \`${c.name}\`：${c.dbType} \`${c.dbName}\`@${c.host}:${c.port} (user: ${c.dbUser})`);
    }
    sections.push(lines.join('\n'));
  }

  // ── 定时提醒 ──
  sections.push(
    `## 定时提醒\n` +
    `设置提醒或定时任务请使用 cron 工具。\n` +
    `**必须使用** sessionTarget="isolated"，payload.kind="agentTurn"，delivery.mode="none"。\n` +
    `提醒送达：在 payload.message 中指示 agent 用 send_im_message 发送通知。\n` +
    `示例：cron add，job={ "schedule": { "kind": "at", "at": "<ISO时间>" }, "sessionTarget": "isolated", "payload": { "kind": "agentTurn", "message": "你是提醒助手。请立即用 send_im_message 向用户发送提醒：xxx" }, "delivery": { "mode": "none" } }\n` +
    `**禁止** sessionTarget="main"、payload.kind="systemEvent"、delivery.mode="announce"，均会报错。`,
  );

  return sections.join('\n\n');
}

// ── 双通道拆分函数（Phase 3）──────────────────────────────────────

/**
 * 行为指令 — 注入到 system prompt（appendSystemContext）
 *
 * 包含 Agent 应该**怎么做**的规则，session 内基本不变：
 * - 身份定义
 * - 文件管理规范（不含具体路径）
 * - Agent 指令
 * - 定时提醒用法
 * - IM 安全约束（如果是 IM 渠道）
 */
export function buildBehaviorSections(params: EnterpriseSectionParams): string {
  const sections: string[] = [];

  // 身份
  if (params.isDefault) {
    const name = sanitize(params.displayName || params.username);
    sections.push(
      `## 你的身份\n` +
      `你是 Octopus AI 企业级超级智能助手，是用户 ${name} 的主助手。\n` +
      `自我介绍时只说"我是 Octopus AI"，不要说"Octopus AI AI 助手"或其他重复 AI 的表述。`,
    );
  }

  // 文件管理规范（行为指令，不含路径）
  if (params.workspacePaths) {
    let text =
      `## 文件管理规范\n` +
      `- files/：用户上传的文件，只读取不修改\n` +
      `- outputs/：交付给用户的成果文件。系统会**自动**将 outputs/ 中的新文件发送给用户（包括 IM 渠道）\n` +
      `- temp/：中间产物（脚本、临时数据、草稿）写入此目录\n` +
      `- 不要在工作空间根目录直接创建文件`;

    if (params.imSafetyConstraints) {
      text +=
        `\n\n**安全约束（必须遵守）：**\n` +
        `- 所有文件读写操作只能在工作空间目录内进行\n` +
        `- 严禁访问、读取或修改该目录之外的任何文件或目录\n` +
        `- 严禁访问其他用户的目录或系统敏感文件（如 /etc/passwd、~/.ssh 等）\n` +
        `- Shell 命令在沙箱容器内执行，可以使用 exec 工具运行命令`;
    }
    sections.push(text);
  }

  // Agent 指令
  if (params.agentInstructions) {
    sections.push(`## Agent 指令\n${params.agentInstructions}`);
  }

  // 定时提醒规范
  sections.push(
    `## 定时提醒\n` +
    `设置提醒或定时任务请使用 cron 工具。\n` +
    `**必须使用** sessionTarget="isolated"，payload.kind="agentTurn"，delivery.mode="none"。\n` +
    `提醒送达：在 payload.message 中指示 agent 用 send_im_message 发送通知。\n` +
    `**禁止** sessionTarget="main"、payload.kind="systemEvent"、delivery.mode="announce"，均会报错。`,
  );

  return sections.join('\n\n');
}

/**
 * 上下文信息 — 注入到 contextNote（<context-note> 标签）
 *
 * 包含**当前环境是什么**的信息，每次请求可能不同：
 * - 用户信息
 * - 工作区路径
 * - 可委派的专业 Agent 列表
 * - 数据库连接名
 */
export function buildContextSections(params: EnterpriseSectionParams): string {
  const sections: string[] = [];

  // 用户信息
  const userDisplay =
    params.displayName && params.displayName !== params.username
      ? `${sanitize(params.username)} (${sanitize(params.displayName)})`
      : sanitize(params.username);
  sections.push(`当前用户: ${userDisplay}`);

  // 工作区路径
  if (params.workspacePaths) {
    const { root, files, outputs, temp } = params.workspacePaths;
    sections.push(
      `工作区路径:\n` +
      `- 工作空间根目录: ${root}\n` +
      `- 用户上传文件: ${files}\n` +
      `- 用户可下载文件: ${outputs}\n` +
      `- 临时工作目录: ${temp}`,
    );
  }

  // 专业 Agent 列表
  if (params.isDefault && params.specialists && params.specialists.length > 0) {
    const list = params.specialists
      .map((a) => {
        const desc = a.description ? ` — ${a.description}` : '';
        return `- **${a.displayName}**（agent 名称: ${a.name}）${desc}`;
      })
      .join('\n');
    sections.push(`可委派的专业 Agent:\n${list}`);
  }

  // 数据库连接名
  if (params.dbConnections && params.dbConnections.length > 0) {
    const lines = ['可用数据库连接（调用 SQL 工具时传 connection_name）：'];
    for (const c of params.dbConnections) {
      lines.push(`- \`${c.name}\`：${c.dbType} \`${c.dbName}\`@${c.host}:${c.port} (user: ${c.dbUser})`);
    }
    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}

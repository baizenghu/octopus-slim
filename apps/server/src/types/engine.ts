/**
 * 引擎 RPC 响应类型定义
 *
 * 用于替换路由文件中的 as any / : any 模式。
 * 这些类型反映引擎 gateway 的实际返回结构，在引擎 API 变更时需同步更新。
 */

/** 会话条目（sessions.list 返回） */
export interface EngineSessionItem {
  key?: string;
  sessionKey?: string;
  label?: string;
  title?: string;
  agentId?: string;
  updatedAt?: string;
  lastActiveAt?: string;
  messageCount?: number;
}

/** 会话列表响应 */
export interface EngineSessionsListResponse {
  sessions?: EngineSessionItem[];
}

/** 消息内容块（多模态消息） */
export interface EngineContentBlock {
  type: string;
  text?: string;
  content?: string;
  name?: string;
  id?: string;
  args?: unknown;
  arguments?: unknown;
  input?: unknown;
}

/** 历史消息条目 */
export interface EngineMessage {
  role: string;
  content: string | EngineContentBlock[];
  timestamp?: string | number;
}

/** chat.history 响应 */
export interface EngineChatHistoryResponse {
  messages?: EngineMessage[];
  history?: EngineMessage[];
}

/** 模型条目 */
export interface EngineModelItem {
  id: string;
  name?: string;
  provider?: string;
}

/** models.list 响应 */
export interface EngineModelsListResponse {
  models?: EngineModelItem[];
}

/** Cron 任务条目（cron.list 返回） */
export interface EngineCronJob {
  id?: string;
  name?: string;
  agentId?: string;
  agent?: string;
  schedule?: { at?: string; kind?: string; expr?: string };
  payload?: { text?: string; message?: string; kind?: string };
}

/** cron.list 响应 */
export interface EngineCronListResponse {
  jobs?: EngineCronJob[];
}

/** agents.files.get 响应 */
export interface EngineAgentFileResponse {
  agentId?: string;
  workspace?: string;
  file?: string | { name?: string; path?: string; content?: string };
  content?: string;
}

/** Agent 配置条目（agents.list 中的单个 agent） */
export interface EngineAgentListEntry {
  id: string;
  model?: string | Record<string, unknown>;
  tools?: {
    profile?: string;
    alsoAllow?: string[];
    allow?: string[];
    deny?: string[];
    /** 企业层存储的工具过滤原始值，引擎忽略未知字段 */
    _toolsFilter?: string[] | null;
  };
  subagents?: {
    allowAgents?: string[];
  };
  heartbeat?: {
    every?: string;
    prompt?: string;
  };
  skills?: string[];
}

/** Provider 配置 */
export interface EngineProviderConfig {
  models?: Array<string | { id?: string; name?: string }>;
}

/** 引擎配置（octopus.json 解析后结构） */
export interface EngineConfig {
  agents?: {
    list?: EngineAgentListEntry[];
    defaults?: {
      model?: string | { primary?: string; fallbacks?: string[] };
    };
  };
  models?: {
    providers?: Record<string, EngineProviderConfig>;
  };
  plugins?: {
    entries?: {
      'memory-lancedb-pro'?: {
        config?: {
          scopes?: {
            agentAccess?: Record<string, string[]>;
          };
        };
      };
    };
  };
}

/** 心跳任务配置（存储在 scheduledTask.taskConfig 中） */
export interface HeartbeatTaskConfig {
  agentId?: string;
  every?: string;
  content?: string;
  cronJobId?: string;
  lastResult?: string;
  lastResultAt?: string;
}

/** 引擎原生事件（内部事件总线传递的原始结构） */
export interface EngineRawEvent {
  runId: string;
  stream: string;
  data: Record<string, unknown>;
}

/** agents.list 响应 */
export interface EngineAgentsListResponse {
  agents?: EngineAgentListEntry[];
}

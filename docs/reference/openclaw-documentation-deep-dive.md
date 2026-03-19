# OpenClaw 官方文档深度学习报告

> 基于 https://docs.openclaw.ai 全站 450+ 页文档的系统性学习（第二轮完整版）
> 日期: 2026-03-18

---

## 一、架构总览

### 1.1 核心架构

```
Browser / Mobile Node / CLI / TUI
         │
         │ WebSocket (JSON text frames)
         ▼
Gateway (单一长驻进程, 默认 127.0.0.1:18789)
  ├── Channel 连接管理 (WhatsApp/Telegram/Discord/Slack/Signal/iMessage/飞书等 23 个)
  ├── Agent 运行时 (pi-mono 嵌入式)
  ├── Session 管理 (JSONL 持久化)
  ├── Cron 调度器
  ├── Tool 系统 (exec/read/write/edit/browser/canvas/nodes)
  ├── Plugin 系统 (native + bundle)
  ├── Skill 系统 (bundled + managed + workspace)
  ├── Memory 系统 (Markdown + 向量搜索)
  ├── Webhook / Hooks 事件系统
  └── Control UI (Vite + Lit SPA)
         │
         │ OpenAI-compatible HTTP / Provider-specific API
         ▼
Model Providers (50+ 集成: Anthropic/OpenAI/Google/DeepSeek/Ollama 等)
```

**核心原则**: 一个 Gateway 进程管理所有 channel 连接和 WebSocket 控制面。"One Gateway per host"。

### 1.2 数据目录结构

| 目录 | 用途 |
|------|------|
| `~/.openclaw/openclaw.json` | 配置文件 (JSON5) |
| `~/.openclaw/workspace` | Agent 工作空间 |
| `~/.openclaw/agents/<agentId>/` | 每个 Agent 的独立状态 |
| `~/.openclaw/agents/<agentId>/sessions/` | Session 元数据 + JSONL 记录 |
| `~/.openclaw/agents/<agentId>/agent/auth-profiles.json` | 认证凭据 |
| `~/.openclaw/credentials/` | Channel 凭据 (WhatsApp/Telegram 等) |
| `~/.openclaw/skills/` | Managed skills |
| `~/.openclaw/cron/jobs.json` | Cron 任务持久化 |
| `~/.openclaw/cron/runs/<jobId>.jsonl` | Cron 运行历史 |
| `~/.openclaw/hooks/` | Managed hooks |
| `~/.openclaw/memory/<agentId>.sqlite` | 向量索引 |
| `/tmp/openclaw/` | 日志文件 |

### 1.3 与 Octopus 企业版的映射

| OpenClaw | Octopus 企业版 |
|----------|---------------|
| `~/.openclaw/` | `.octopus-state/` (通过 `OCTOPUS_STATE_DIR`) |
| `~/.openclaw/openclaw.json` | `.octopus-state/octopus.json` |
| `~/.openclaw/workspace` | `data/users/{userId}/workspace/` |
| Gateway 端口 18789 | Native Gateway 端口 19791 |
| WebSocket 控制面 | OctopusBridge WebSocket RPC |
| `openclaw` CLI | `octopus` CLI |

---

## 二、Agent 系统

### 2.1 Agent 定义

Agent = 完全隔离的"大脑"，拥有独立的:
- **Workspace** (文件系统, AGENTS.md/SOUL.md 等)
- **State directory** (auth profiles, model registry)
- **Sessions** (对话历史)

### 2.2 Bootstrap 文件

首次启动时注入到 system prompt 的文件:

| 文件 | 用途 |
|------|------|
| `AGENTS.md` | 操作指令，每次 session 加载 |
| `SOUL.md` | 人设/语气/行为边界 |
| `USER.md` | 用户信息 |
| `IDENTITY.md` | Agent 名称/creature/vibe/emoji/avatar |
| `TOOLS.md` | 本地工具备注 |
| `HEARTBEAT.md` | 心跳检查任务清单 |
| `BOOT.md` | 启动时执行的指令 |
| `BOOTSTRAP.md` | 首次对话引导 (完成后删除) |
| `MEMORY.md` | 长期记忆 |

**大小限制**: 单文件 20,000 字符, 总计 150,000 字符 (可配置 `bootstrapMaxChars`/`bootstrapTotalMaxChars`)

### 2.3 Agent Loop (执行循环)

```
Phase 1: Agent RPC → 验证参数/解析 session/返回 {runId, acceptedAt}
Phase 2: Agent Command → 解析模型/加载 skills/调用嵌入式运行时
Phase 3: Embedded Loop → 序列化运行/认证解析/超时管理
Phase 4: Event Bridging → pi-agent-core 事件转 OpenClaw 流 (tool/assistant/lifecycle)
Phase 5: Wait Pattern → agent.wait 阻塞直到完成 (默认 30s 超时)
```

**Hook 系统** (按执行顺序):
- `before_model_resolve` → 覆盖 provider/model
- `before_prompt_build` → 注入 context/system prompt
- `before_agent_start` → legacy 兼容
- `before_tool_call` / `after_tool_call` → 拦截工具执行
- `tool_result_persist` → 持久化前转换结果
- `agent_end` → 检查最终状态
- `before_compaction` / `after_compaction` → 压缩周期

### 2.4 System Prompt 构成

动态组装, 包含:
- **Tooling**: 当前可用工具 + 描述
- **Safety**: 安全护栏提醒
- **Skills**: 技能加载指引
- **Self-Update**: 更新操作流程
- **Workspace**: 工作目录引用
- **Bootstrap Files**: AGENTS.md/SOUL.md/TOOLS.md/IDENTITY.md/USER.md/HEARTBEAT.md/MEMORY.md
- **Sandbox**: 运行时环境信息
- **Date & Time**: 用户时区 + 时间
- **Runtime**: Host/OS/Node/Model/Thinking level

三种渲染模式:
- **Full**: 标准 agent run (所有 section)
- **Minimal**: sub-agent (仅 Tooling/Safety/Workspace/Sandbox/DateTime/Runtime)
- **None**: 仅基础身份信息

### 2.5 Multi-Agent 路由

Binding 优先级 (从高到低):
1. Peer 精确匹配 (DM/group/channel id)
2. ParentPeer (线程继承)
3. Guild ID + roles (Discord)
4. Guild ID (Discord)
5. Team ID (Slack)
6. Account ID
7. Channel 匹配
8. 回退到 default agent

---

## 三、Session 管理

### 3.1 Session Key 格式

| 来源 | Key 格式 |
|------|---------|
| DM (main scope) | `agent:<agentId>:main` |
| DM (per-channel-peer) | `agent:<agentId>:<channel>:direct:<peerId>` |
| 群聊 | `agent:<agentId>:<channel>:group:<id>` |
| Telegram 话题 | `...group:<id>:topic:<threadId>` |
| Cron 任务 | `cron:<jobId>` |
| Webhook | `hook:<uuid>` |
| 子 Agent | `agent:<agentId>:subagent:<uuid>` |

### 3.2 DM 隔离模式 (`session.dmScope`)

| 模式 | 行为 | 推荐场景 |
|------|------|---------|
| `main` (默认) | 所有 DM 共享主 session | 个人使用 |
| `per-peer` | 按发送者隔离 | 简单多用户 |
| `per-channel-peer` | 按 channel + 发送者隔离 | **多用户推荐** |
| `per-account-channel-peer` | 按 account + channel + 发送者 | 多账号多用户 |

**安全关键**: 多用户场景必须启用 `per-channel-peer` 以防止跨用户上下文泄露。

### 3.3 Session 生命周期

- **Daily reset**: 默认每天 4:00 AM (gateway host 时区)
- **Idle reset**: 可选 `idleMinutes` 滑动窗口
- **手动 reset**: `/new` 或 `/reset` 命令
- **Per-type overrides**: `resetByType` (direct/group/thread 分别配置)
- **Per-channel overrides**: `resetByChannel`

### 3.4 维护配置

```json5
{
  session: {
    maintenance: {
      mode: "enforce",     // warn | enforce
      pruneAfter: "30d",   // 过期清理
      maxEntries: 500,     // 最大条目数
      rotateBytes: "10mb", // 文件轮转阈值
      maxDiskBytes: "1gb", // 磁盘预算
      highWaterBytes: "800mb", // 高水位线
    },
  },
}
```

### 3.5 Send Policy (发送策略)

按 session 类型/channel/前缀控制消息发送:
```json5
{
  session: {
    sendPolicy: {
      rules: [
        { action: "deny", match: { channel: "discord", chatType: "group" } },
        { action: "deny", match: { keyPrefix: "cron:" } },
      ],
      default: "allow",
    },
  },
}
```

---

## 四、Tool 系统

### 4.1 Tool 配置层级

```
Tool Profiles (base) → Provider Profiles → Global Policies →
Provider Policies → Agent Policies → Agent Provider Policies →
Sandbox Policies → Subagent Policies
```

**每层只能进一步限制，不能恢复已被拒绝的工具。**

### 4.2 内置 Tool 分组

| 组 | 包含工具 |
|----|---------|
| `group:runtime` | exec, bash, process |
| `group:fs` | read, write, edit, apply_patch |
| `group:sessions` | sessions_list/history/send/spawn, session_status, agents_list |
| `group:memory` | memory_search, memory_get |
| `group:web` | web_search, web_fetch |
| `group:ui` | browser, canvas |
| `group:automation` | cron, gateway |
| `group:messaging` | message |
| `group:nodes` | nodes |
| `group:openclaw` | 所有内置工具 (不含 plugin) |

### 4.3 Tool Profiles

| Profile | 包含 |
|---------|------|
| `minimal` | session_status only |
| `coding` | fs, runtime, sessions, memory, image |
| `messaging` | messaging + 部分 sessions |
| `full` | 无限制 |

### 4.4 Exec 工具

关键配置:
- `tools.exec.host`: `sandbox` (默认) / `gateway` / `node`
- `tools.exec.security`: `deny` / `allowlist` / `full`
- `tools.exec.ask`: `off` / `on-miss` / `always`
- `tools.exec.backgroundMs`: 10000 (自动后台化)
- `tools.exec.timeoutSec`: 1800
- **沙箱关闭时 `host=sandbox` 会 fail closed** (不会静默回退到 host)

Safe Bins (stdin-only): `jq`, `cut`, `uniq`, `head`, `tail`, `tr`, `wc`
- 有 denied flags 策略防止文件读取
- 不应添加 interpreter (python3/node/bash)

### 4.5 Loop Detection (循环检测)

```json5
{
  tools: {
    loopDetection: {
      enabled: true,
      historySize: 30,
      warningThreshold: 10,
      criticalThreshold: 20,
      globalCircuitBreakerThreshold: 30,
      detectors: { genericRepeat: true, knownPollNoProgress: true, pingPong: true },
    },
  },
}
```

### 4.6 Browser 工具

- 隔离的 Chrome/Brave/Edge/Chromium profile
- 通过 loopback-only HTTP 控制服务
- 多 profile 支持 (openclaw/user/remote)
- Playwright 依赖 (高级功能)
- SSRF 防护 (默认允许私网, 可限制)
- 远程 CDP: Browserless / Browserbase / 自定义

### 4.7 Web 工具

- `web_search`: 6 个 provider (Brave/Firecrawl/Gemini/Grok/Kimi/Perplexity)
- `web_fetch`: HTTP GET + Readability 提取, 可选 Firecrawl 回退
- 缓存 15 分钟

---

## 五、Sandbox 系统

### 5.1 模式

| 模式 | 行为 |
|------|------|
| `off` | 无沙箱 |
| `non-main` | 非主 session 沙箱化 |
| `all` | 所有 session 沙箱化 |

### 5.2 Backend

| Backend | 位置 | Workspace 模式 |
|---------|------|---------------|
| `docker` | 本地容器 | bind-mount/copy |
| `ssh` | SSH 远程主机 | 远程 canonical |
| `openshell` | 托管服务 | mirror/remote |

### 5.3 Docker 安全默认值

- 网络: `none` (默认无网络)
- 用户: `1000:1000` (非 root)
- 只读根文件系统: `true`
- Capabilities: 全部 drop
- seccomp/AppArmor 支持

### 5.4 Sandbox vs Tool Policy vs Elevated

三层控制机制:
- **Sandbox**: 控制执行位置 (容器 vs 宿主)
- **Tool Policy**: 控制哪些工具可用
- **Elevated**: 从沙箱提升到宿主执行

`/elevated on` = 宿主执行 + 保留 exec 审批
`/elevated full` = 宿主执行 + 跳过审批

---

## 六、Plugin 系统

### 6.1 架构四层

1. Manifest 发现
2. 启用/验证
3. jiti 运行时加载
4. 消费注册

### 6.2 六种能力类型

1. Text inference (`api.registerProvider`)
2. Speech (`api.registerSpeechProvider`)
3. Media understanding (`api.registerMediaUnderstandingProvider`)
4. Image generation (`api.registerImageGenerationProvider`)
5. Web search (`api.registerWebSearchProvider`)
6. Channel/messaging (`api.registerChannel`)

### 6.3 Provider Plugin 的 21 个有序 Hook

| # | Hook | 用途 |
|---|------|------|
| 1 | `catalog` | 发布模型目录 |
| 2 | `resolveDynamicModel` | 同步解析未知 model id |
| 3 | `prepareDynamicModel` | 异步预热 |
| 4 | `normalizeResolvedModel` | 最终重写 (transport/baseUrl) |
| 5 | `capabilities` | transcript/tooling 元数据 |
| 6 | `prepareExtraParams` | 请求参数规范化 |
| 7 | `wrapStreamFn` | 流包装器 (headers/body/compat) |
| 8 | `formatApiKey` | auth profile → apiKey 格式化 |
| 9 | `refreshOAuth` | OAuth 刷新覆盖 |
| 10 | `buildAuthDoctorHint` | 刷新失败修复提示 |
| 11 | `isCacheTtlEligible` | prompt-cache TTL 策略 |
| 12 | `buildMissingAuthMessage` | 缺失认证自定义消息 |
| 13 | `suppressBuiltInModel` | 抑制旧模型行 |
| 14 | `augmentModelCatalog` | 添加合成目录行 |
| 15 | `isBinaryThinking` | 二进制推理切换 |
| 16 | `supportsXHighThinking` | xhigh 推理支持 |
| 17 | `resolveDefaultThinkingLevel` | 默认 /think 级别 |
| 18 | `isModernModelRef` | 现代模型匹配 |
| 19 | `prepareRuntimeAuth` | 短期运行时 token 交换 |
| 20 | `resolveUsageAuth` | 用量凭据解析 |
| 21 | `fetchUsageSnapshot` | 用量端点获取 |

### 6.4 Runtime Helpers

Plugin 通过 `api.runtime` 访问:
- `api.runtime.tts.textToSpeech(...)` — TTS
- `api.runtime.mediaUnderstanding.describeImageFile(...)` — 图片理解
- `api.runtime.subagent.run(...)` — 子 agent
- `api.runtime.webSearch.search(...)` — Web 搜索

### 6.5 Bundle 兼容

支持 Codex / Claude / Cursor bundle 格式。Bundle 作为 metadata pack (不执行 runtime 代码)。

### 6.6 Plugin Manifest

```json
{
  "id": "my-plugin",
  "configSchema": { "type": "object", "additionalProperties": false, "properties": {} }
}
```

**必须字段**: `id` + `configSchema` (即使空)

---

## 七、Skill 系统

### 7.1 三层加载

1. **Workspace**: `<workspace>/skills/` (最高优先级)
2. **Managed**: `~/.openclaw/skills/`
3. **Bundled** (最低)
4. 额外: `skills.load.extraDirs`

### 7.2 SKILL.md 格式

```yaml
---
name: skill-name
description: What this skill does
metadata:
  openclaw:
    requires: { bins: ["ffmpeg"], env: ["API_KEY"], config: ["path"] }
    primaryEnv: "API_KEY"
    emoji: "🎬"
---
Instructions...
```

### 7.3 Token 开销

基础 195 字符 + 每个 skill (97 + name + description + location)，约 24 tokens/skill

---

## 八、Memory 系统

### 8.1 两层架构

- **Daily logs**: `memory/YYYY-MM-DD.md` (追加式, 读今天+昨天)
- **Long-term**: `MEMORY.md` (策划精选)

### 8.2 工具

- `memory_search`: 语义搜索 ~400 token 块 (80 token 重叠)
- `memory_get`: 读取特定文件/行范围

### 8.3 Embedding Provider 优先级

local → openai → gemini → voyage → mistral

### 8.4 混合搜索

```json5
{
  memorySearch: {
    query: {
      hybrid: {
        enabled: true,
        vectorWeight: 0.7,   // 语义
        textWeight: 0.3,     // BM25 关键词
        mmr: { enabled: true, lambda: 0.7 },         // 多样性去重
        temporalDecay: { enabled: true, halfLifeDays: 30 }, // 时间衰减
      },
    },
  },
}
```

Pipeline: `Vector + Keyword → Weighted Merge → Temporal Decay → Sort → MMR → Top-K`

### 8.5 Pre-Compaction Memory Flush

接近 auto-compaction 时静默 agent turn, 提醒写入持久记忆。

### 8.6 Multimodal Memory (Gemini)

支持图片 + 音频 embedding (gemini-embedding-2-preview)

---

## 九、Automation

### 9.1 Heartbeat

```json5
{
  heartbeat: {
    every: "30m",
    target: "last",
    lightContext: true,
    isolatedSession: true,
    activeHours: { start: "08:00", end: "22:00", timezone: "Asia/Shanghai" },
  },
}
```

`HEARTBEAT_OK` = 无需关注; 其他 = 告警投递

### 9.2 Cron

调度类型: `at` (一次性) / `every` (固定间隔) / `cron` (表达式)
投递: `announce` / `webhook` / `none`
重试: 一次性 3 次 (30s→1m→5m); 周期性 exponential backoff
存储: `~/.openclaw/cron/jobs.json`

### 9.3 Hooks (事件驱动)

4 个内置: session-memory / bootstrap-extra-files / command-logger / boot-md

事件类型: command / session / agent / gateway / message

### 9.4 Webhooks

`POST /hooks/wake` (系统事件) + `POST /hooks/agent` (agent turn)

---

## 十、Gateway 配置

### 10.1 配置管理

- 热重载: hybrid (默认) / hot / restart / off
- RPC: `config.apply` (全量) + `config.patch` (JSON merge-patch)
- 限速: 3 次/60s/设备+IP
- `$include` 模块化 (最多 10 层嵌套)

### 10.2 认证

| 模式 | 说明 |
|------|------|
| `token` | 共享 Bearer token (**推荐**) |
| `password` | 密码 |
| `trusted-proxy` | 信任反向代理 |
| `none` | 无认证 (不推荐) |

### 10.3 SecretRef

```json5
{ source: "env" | "file" | "exec", provider: "default", id: "..." }
```

- env: 环境变量
- file: JSON 文件 (RFC6901 指针)
- exec: 外部可执行文件 (vault, 1password, sops)

解析时机: 启动时 eager resolve → in-memory snapshot → 原子交换

### 10.4 OpenAI 兼容端点

`POST /v1/chat/completions` — 默认禁用，需 `gateway.http.endpoints.chatCompletions.enabled: true`

### 10.5 Tools Invoke API

`POST /tools/invoke` — 直接工具调用, 2MB payload 限制

---

## 十一、Channel 集成

### 11.1 支持 23 个 Channel

WhatsApp, Telegram, Discord, Slack, Signal, iMessage (BlueBubbles), 飞书/Lark,
Google Chat, Mattermost, MS Teams, Matrix, IRC, LINE, Nostr, Tlon,
Nextcloud Talk, Synology Chat, Twitch, Zalo, WebChat 等

### 11.2 通用 DM/Group 策略

DM: `pairing` (默认) / `allowlist` / `open` / `disabled`
Group: `allowlist` (默认) / `open` / `disabled`

### 11.3 飞书集成

- WebSocket bot 连接 (无需公网 webhook)
- 支持: 多账号, DM/群聊策略, ACP session, 流式卡片, inline replies
- 17 个 tenant-level scope

### 11.4 Broadcast Groups (实验性)

多个 agent 同时处理同一消息:
- Parallel (默认) / Sequential 策略
- 每个 agent 独立 session/workspace/memory
- WhatsApp only (Telegram/Discord/Slack 计划中)

---

## 十二、安全模型

### 12.1 安全定位

**个人助手模型** — 不是多租户隔离。一个 Gateway = 一个可信操作者边界。

### 12.2 威胁模型 (MITRE ATLAS)

5 个信任边界:
1. Channel Access (配对 + AllowFrom + 认证)
2. Session Isolation (per-agent tool policies)
3. Tool Execution (Docker sandbox + SSRF 防护)
4. External Content (XML 标签包裹)
5. Supply Chain (ClawHub 审核)

P0 风险: 直接 prompt injection / 恶意 skill / 凭据收割

### 12.3 正式验证

使用 TLA+/TLC 验证: Gateway 暴露、Nodes.run 管道、配对存储、入口网关、路由/Session 隔离

### 12.4 安全审计

```bash
openclaw security audit --deep --fix --json
```

关键检查: bind_no_auth / tailscale_funnel / control_ui / exec / sandbox / hooks

### 12.5 加固基线

```json5
{
  gateway: { mode: "local", bind: "loopback", auth: { mode: "token" } },
  session: { dmScope: "per-channel-peer" },
  tools: { profile: "messaging", deny: ["group:automation", "group:runtime", "group:fs"],
           fs: { workspaceOnly: true }, exec: { security: "deny" }, elevated: { enabled: false } },
}
```

---

## 十三、Model Provider 系统

### 13.1 50+ Provider

内置: openai / anthropic / openai-codex / google / openrouter / ollama / moonshot / minimax / zai / mistral / together / venice / 等

### 13.2 Failover

两阶段: Auth profile rotation → Model fallback
Cooldown: 1m → 5m → 25m → 1h
Billing: 5h → 10h → 20h → 24h

### 13.3 API Key Rotation

优先级: `OPENCLAW_LIVE_<PROVIDER>_KEY` → `<PROVIDER>_API_KEYS` → `<PROVIDER>_API_KEY` → `<PROVIDER>_API_KEY_*`

仅 429/rate-limit 时轮换, 其他错误直接失败

### 13.4 Prompt Caching

`cacheRetention`: none / short / long
`contextPruning.mode: "cache-ttl"` — TTL 过期后修剪旧 tool results
Heartbeat keep-warm (如 55min for 1h TTL)

---

## 十四、Sub-Agent 系统

### 14.1 配置

```json5
{
  subagents: {
    maxSpawnDepth: 2,
    maxChildrenPerAgent: 5,
    maxConcurrent: 8,
    runTimeoutSeconds: 900,
  },
}
```

### 14.2 深度

| 深度 | 角色 | Session Key |
|------|------|-------------|
| 0 | 主 Agent | `agent:<id>:main` |
| 1 | 编排者 | `agent:<id>:subagent:<uuid>` |
| 2 | 工作者 | `...:subagent:<uuid>:subagent:<uuid>` |

### 14.3 工具策略

- 深度 1 (编排者): 有 sessions_spawn/subagents/sessions_list/history
- 深度 1 (叶子): 无 session 工具
- 深度 2: 始终无 session 工具

---

## 十五、Streaming 与格式化

### 15.1 Block Streaming

`blockStreamingChunk: { minChars: 800, maxChars: 1200 }`
代码块不拆分 (code fence 保留)
`humanDelay`: 800-2500ms 随机延迟

### 15.2 Preview Streaming

| Platform | off | partial | block | progress |
|----------|-----|---------|-------|----------|
| Telegram | ✓ | ✓ | ✓ | → partial |
| Discord | ✓ | ✓ | ✓ | → partial |
| Slack | ✓ | ✓ | ✓ | ✓ (native) |

### 15.3 Markdown IR

Parse → IR (text + spans) → Chunk → Render (Slack mrkdwn / Telegram HTML / Signal ranges)

---

## 十六、Compaction 与 Pruning

### 16.1 Compaction

触发: `contextTokens > contextWindow - reserveTokens`
保留: `keepRecentTokens: 20000`
`identifierPolicy`: strict / off / custom
Memory flush: compaction 前静默写入持久记忆

### 16.2 Session Pruning

仅修剪 `toolResult` (in-memory, 不改写 JSONL):
- `mode: "cache-ttl"` (Anthropic 专用)
- `softTrimRatio: 0.3` → 保留首尾
- `hardClearRatio: 0.5` → 替换占位符
- `keepLastAssistants: 3`

---

## 十七、CLI 参考

关键命令:
- `openclaw onboard` / `openclaw configure` — 交互式配置
- `openclaw config get/set/unset/validate` — 非交互配置
- `openclaw gateway run/status/probe/health/install/restart` — Gateway 管理
- `openclaw agents list/add/bind/set-identity` — Agent 管理
- `openclaw sessions cleanup --enforce` — Session 维护
- `openclaw cron add/list/run/edit` — Cron 管理
- `openclaw sandbox explain/list/recreate` — Sandbox 管理
- `openclaw secrets audit/configure/apply/reload` — 密钥管理
- `openclaw security audit --deep --fix` — 安全审计
- `openclaw plugins install/inspect/enable/disable` — Plugin 管理
- `openclaw skills list/check/info` — Skill 检查
- `openclaw memory status/index/search` — 记忆管理
- `openclaw models status/list/set/scan` — 模型管理
- `openclaw hooks list/enable/disable/install` — Hook 管理
- `openclaw browser status/start/stop/snapshot` — 浏览器控制

---

## 十八、Transcript Hygiene

Provider 特定修复 (in-memory, 不改写 JSONL):
- Image 降采样 (默认 1200px)
- Tool call ID 清理 (Google: alphanumeric; Mistral: strict9)
- Tool result 配对修复
- Turn 排序验证
- Thinking 签名清理
- Inter-session provenance 标记

---

## 十九、Web Interface

### Control UI
Vite + Lit SPA, 端口 = Gateway (18789), 支持: 聊天/Channel/Session/Cron/Skills/Config/Log

### TUI
终端界面, 快捷键 Ctrl+L/G/P, 远程连接支持

### WebChat
Gateway WebSocket: chat.history/send/inject, 断线只读

---

## 二十、对企业版的启示

1. **Config Patch**: OpenClaw 的 `config.patch` (JSON merge-patch) 比全量替换更安全
2. **Session 维护**: 自动清理/轮转/磁盘预算机制值得借鉴
3. **Loop Detection**: 已在阶段 3 对齐 (8/15/25 阈值)
4. **Exec Approvals**: 精细化审批 (allowlist + safe bins + auto-allow skills)
5. **Memory 混合搜索**: BM25 + Vector + MMR + Temporal Decay 远比 lancedb-pro 更强
6. **Security Audit**: 自动化安全检查应在企业版实现
7. **Plugin SDK**: 21 个 provider hook 的完整扩展点
8. **Transcript Hygiene**: per-provider 的自动修复管道
9. **Context Engine**: 可插拔的上下文引擎 (ownsCompaction)
10. **Broadcast Groups**: 多 agent 并行处理同一消息

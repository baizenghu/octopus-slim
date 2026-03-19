# 系统配置管理页面设计

> 日期：2026-03-16
> 状态：设计完成，待实施

---

## 1. 目标

在企业 Admin Console 中新增"系统配置"页面，让 admin 通过 Web UI 管理当前需要手动编辑 `octopus.json` 的核心配置项。普通用户通过现有 AgentsPage 的模型下拉框选择模型（已有功能，不需改动）。

## 2. 页面结构

在 SettingsPage 管理菜单中新增 **"系统配置"** 菜单项（admin only），包含 3 个 Tab：

```
管理菜单（admin）
├── 仪表盘
├── 用户管理
├── 审计日志
├── 系统配置  ← 新增
│   ├── Tab 1: 模型管理
│   ├── Tab 2: 安全与工具
│   └── Tab 3: 插件与技能
└── 系统信息
```

## 3. Tab 1：模型管理

### 3.1 Provider 列表

表格展示已配置的模型 Provider：

| 列 | 内容 |
|----|------|
| Provider ID | 如 `deepseek`、`openai-codex` |
| API 类型 | `openai-completions` / `anthropic-messages` / ... |
| Base URL | API 地址 |
| 模型数量 | 该 Provider 下的模型数 |
| 操作 | 编辑、删除 |

右上角"添加 Provider"按钮。

### 3.2 添加/编辑 Provider Dialog

表单字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| Provider ID | 文本输入 | 创建后不可改 |
| API 类型 | Select | `openai-completions` \| `anthropic-messages` \| `google-generative-ai` \| `ollama` |
| Base URL | 文本输入 | API 地址 |
| API Key | 密码框 | 编辑时留空不修改，显示 `••••••` |

**模型子表格**（Dialog 内嵌）：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | 文本 | 模型 ID，如 `deepseek-chat` |
| name | 文本 | 显示名称 |
| reasoning | 开关 | 是否支持推理 |
| contextWindow | 数字 | 上下文窗口大小 |
| maxTokens | 数字 | 最大输出 token 数 |

**Compat 配置**（可折叠高级区域）：

| 字段 | 类型 | 默认 |
|------|------|------|
| supportsStore | 开关 | true |
| supportsDeveloperRole | 开关 | true |
| supportsReasoningEffort | 开关 | true |
| maxTokensField | Select | `max_completion_tokens` \| `max_tokens` |

### 3.3 默认模型设置

独立区域，位于 Provider 列表下方：

- **Primary 模型**：Select 下拉，格式 `provider/modelId`，从所有 Provider 的模型中选
- **Fallbacks**：多选列表，可排序

### 3.4 数据结构

对应 `octopus.json` 中的：
```typescript
models.providers[providerId]: {
  baseUrl: string;
  apiKey?: SecretInput;
  api?: ModelApi;
  models: ModelDefinitionConfig[];
}

agents.defaults.model: {
  primary: string;       // "provider/modelId"
  fallbacks: string[];
}
```

## 4. Tab 2：安全与工具

每个功能块一个 Card，页面底部统一"保存"按钮。

### 4.1 文件系统隔离

- **workspaceOnly** 开关（当前值：`true`）
- 说明文字："限制 Agent 只能访问自己的工作空间目录"

### 4.2 死循环检测

- **enabled** 开关
- 三个数字输入框：
  - 警告阈值（warningThreshold，默认 8）
  - 阻断阈值（criticalThreshold，默认 15）
  - 全局熔断阈值（globalCircuitBreakerThreshold，默认 25）

### 4.3 执行隔离

- **exec.host** Select：`sandbox` | `gateway`
- 说明："sandbox = Docker 容器内隔离执行，gateway = 宿主机直接执行"

### 4.4 不暴露的配置

`tools.sandbox.tools.allow` 硬编码为 `["*"]`，不在 UI 中展示。原因：设为其他值会导致 plugin 工具（run_skill 等）全部消失。

### 4.5 数据结构

对应 `octopus.json` 中的：
```typescript
tools: {
  fs: { workspaceOnly: boolean },
  loopDetection: {
    enabled: boolean,
    warningThreshold: number,
    criticalThreshold: number,
    globalCircuitBreakerThreshold: number,
  },
  exec: { host: "sandbox" | "gateway" },
  sandbox: { tools: { allow: ["*"] } },  // 固定，不暴露
}
```

## 5. Tab 3：插件与技能

### 5.1 插件管理

**已加载插件列表**（表格）：

| 列 | 内容 |
|----|------|
| 插件名 | 如 `memory-lancedb-pro` |
| 状态 | 启用/禁用开关 |
| 加载路径 | 只读展示 |

点击插件名展开配置编辑：

- `memory-lancedb-pro`：dbPath（文本）、autoCapture（开关）、autoRecall（开关）
- `enterprise-audit`：只读展示
- `enterprise-mcp`：只读展示
- 通用 fallback：JSON 编辑器（处理未知插件的任意 config）

### 5.2 技能全局配置

- **额外搜索路径**（`skills.load.extraDirs`）：当前值列表 + 添加/删除按钮
- **内置技能白名单**（`skills.allowBundled`）：多选列表，空 = 全部启用

### 5.3 数据结构

对应 `octopus.json` 中的：
```typescript
plugins: {
  allow: string[],
  load: { paths: string[] },
  slots: { memory: string },
  entries: {
    [pluginId]: {
      enabled: boolean,
      config: Record<string, unknown>,
    }
  },
}

skills: {
  allowBundled?: string[],
  load?: { extraDirs?: string[] },
}
```

## 6. 后端 API

新增路由文件 `apps/server/src/routes/system-config.ts`，所有端点 admin only。

### 6.1 端点列表

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/admin/config` | 获取完整配置（redact 敏感字段） |
| PUT | `/api/admin/config/models` | 更新模型 Provider + 默认模型 |
| PUT | `/api/admin/config/tools` | 更新安全与工具策略 |
| PUT | `/api/admin/config/plugins` | 更新插件启用/配置 |
| PUT | `/api/admin/config/skills` | 更新技能全局配置 |

### 6.2 实现约束

1. **读写流程**：所有 PUT 端点都走 `configGetParsed() → 深度合并 → configApplyFull()` 三步流程，带 hash 版本控制和自动重试（参考现有 `syncAllowAgents` 实现）
2. **敏感字段保护**：
   - GET 返回时 `apiKey` 替换为 `"••••••"`
   - PUT 提交时空值/`"••••••"` 表示不修改，从现有配置恢复原始值
3. **固定值保护**：`tools.sandbox.tools.allow` 在写入前强制设为 `["*"]`
4. **审计日志**：每次配置修改记录到审计日志
5. **重启评估**：
   - `models.*`、`agents.defaults.*`、`tools.*` → 热加载，不重启
   - `plugins.entries.*` 的 enabled 变更 → 可能触发重启

### 6.3 请求/响应示例

**GET /api/admin/config 响应**：
```json
{
  "models": {
    "providers": {
      "deepseek": {
        "baseUrl": "https://internal-proxy/v1",
        "apiKey": "••••••",
        "api": "openai-completions",
        "models": [
          { "id": "deepseek-chat", "name": "DeepSeek Chat", "reasoning": false, "contextWindow": 200000, "maxTokens": 8192 }
        ]
      }
    }
  },
  "agentDefaults": {
    "model": { "primary": "deepseek/deepseek-chat", "fallbacks": ["deepseek/deepseek-reasoner"] }
  },
  "tools": {
    "fs": { "workspaceOnly": true },
    "loopDetection": { "enabled": true, "warningThreshold": 8, "criticalThreshold": 15, "globalCircuitBreakerThreshold": 25 },
    "exec": { "host": "sandbox" }
  },
  "plugins": {
    "allow": ["memory-lancedb-pro", "enterprise-audit", "enterprise-mcp"],
    "entries": {
      "memory-lancedb-pro": { "enabled": true, "config": { "dbPath": "...", "autoCapture": true, "autoRecall": true } }
    }
  },
  "skills": {
    "allowBundled": [],
    "load": { "extraDirs": ["/home/baizh/octopus/data/skills"] }
  }
}
```

**PUT /api/admin/config/models 请求**：
```json
{
  "providers": {
    "deepseek": {
      "baseUrl": "https://internal-proxy/v1",
      "apiKey": "",
      "api": "openai-completions",
      "models": [
        { "id": "deepseek-chat", "name": "DeepSeek Chat", "reasoning": false, "contextWindow": 200000, "maxTokens": 8192 }
      ]
    }
  },
  "defaults": {
    "primary": "deepseek/deepseek-chat",
    "fallbacks": ["deepseek/deepseek-reasoner"]
  }
}
```

## 7. 前端文件

| 文件 | 用途 |
|------|------|
| `apps/console/src/pages/SystemConfigPage.tsx` | 新页面主组件，含 3 个 Tab |
| `apps/console/src/pages/SettingsPage.tsx` | 管理菜单新增 menuItem |
| `apps/console/src/api.ts` | 新增 `getSystemConfig()`、`updateModelsConfig()`、`updateToolsConfig()`、`updatePluginsConfig()`、`updateSkillsConfig()` |

## 8. 权限控制

- 后端：所有 `/api/admin/config/*` 端点使用 `adminOnly` middleware
- 前端：`SystemConfigPage` 仅在 `user.roles.includes('ADMIN')` 时显示在菜单中
- 与现有 AgentsPage 的模型选择（`getChatModels()`）互不影响，普通用户继续用现有功能

## 9. 不做的事情

| 项目 | 原因 |
|------|------|
| 记忆与压缩独立 Tab | "配一次不动"，memory 配置放在插件管理中 |
| Gateway 端口/TLS 配置 | 改动需重启服务，通过 `.env` 环境变量管理更安全 |
| Channels 配置 | 企业用自有 IM 系统（飞书/网讯通），不用原生 channels |
| Browser/TTS/Talk | 内网环境不需要 |
| `tools.sandbox.tools.allow` | 必须固定为 `["*"]`，暴露会导致 plugin 工具消失 |
| AgentsPage 改动 | 模型选择下拉框已有，不需要改 |

## 10. 工时估算

| 模块 | 后端 | 前端 | 合计 |
|------|------|------|------|
| 模型管理 Tab | 1 个路由 + GET | Provider CRUD + 默认模型 | 1.5 天 |
| 安全与工具 Tab | 1 个路由 | 3 个 Card + 表单 | 0.5 天 |
| 插件与技能 Tab | 2 个路由 | 表格 + 展开配置 + extraDirs | 1 天 |
| **总计** | **4 个 PUT + 1 个 GET** | **1 个新页面** | **3 天** |

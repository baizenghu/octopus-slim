# Unified Skills Storage 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将企业 skill 和个人 skill 统一存储到 `data/skills/` 目录，通过唯一 ID 区分所有权，并充分利用 OpenClaw 引擎原生 skill 发现、过滤和提示注入机制。

**Architecture:** 所有 skill 统一放在 `data/skills/{scope}_{skillId}/` 目录下。引擎通过已配置的 `skills.load.extraDirs` 原生发现全部 skill，通过 `agents.list[agentId].skills` 白名单实现 per-agent 权限过滤。MCP 插件 `run_skill` 保留作为执行层 + 二次鉴权。

**Tech Stack:** TypeScript, Prisma, OpenClaw Engine Skills API, Node.js fs

---

## 现状摘要

**当前问题：**
- 企业 skill 在 `data/skills/`，个人 skill 在 `data/users/{userId}/workspace/skills/`
- 目录命名混乱：有的用 DB ID（`skill-1773064953337-lqicu5`），有的用 name（`team-research`）
- `ppt-generator` 有 DB 记录但目录缺失
- 引擎 `extraDirs` 已配但只覆盖企业 skill 目录
- 专业 agent 的 workspace 扫描不到个人 skill
- SKILL.md 格式不完整，未利用引擎原生 frontmatter 字段

**DB 中现有 skill：**

| DB ID | name | scope | 目录 |
|-------|------|-------|------|
| `claude-code-dispatch` | claude-code-dispatch | enterprise | `data/skills/claude-code-dispatch/` ✅ |
| `skill-1773064953337-lqicu5` | echarts-visualization | enterprise | `data/skills/skill-1773064953337-lqicu5/` ⚠️ |
| `skill-1774409406237-xfndos` | team-research | enterprise | `data/skills/team-research/` ⚠️ |
| `skill-ppt-generator` | ppt-generator | enterprise | 缺失 ❌ |

**引擎配置现状（octopus.json）：**
- `skills.load.extraDirs: ["/home/baizh/octopus/data/skills"]` — 已配置
- `agents.list[].skills` — 使用 skill **name** 做白名单（如 `"echarts-visualization"`）
- 无 `skills.entries` 配置

---

## 目录命名规范

```
data/skills/
├── ent_{skillId}/          ← 企业 skill（ent_ 前缀）
│   └── SKILL.md            ← name = skill.name（企业内管理员保证唯一）
├── usr_{ownerId}_{skillId}/  ← 个人 skill（usr_ 前缀 + 用户 ID）
│   └── SKILL.md            ← name = "{skill.name}:{ownerIdShort}"（跨用户唯一）
└── .venv/                  ← 共享 Python 虚拟环境（保持不变）
```

**name 唯一性规则：**
- 企业 skill：SKILL.md `name` = DB `name`（如 `echarts-visualization`），管理员保证不重复
- 个人 skill：SKILL.md `name` = `{DB name}:{ownerId 前 6 位}`（如 `数据分析:user-b`），自动去重

**引擎过滤链：**
```
extraDirs 发现全部 → skills.entries[name].enabled 全局开关
  → agents.list[agentId].skills 白名单 → <available_skills> 只注入授权 skill
  → run_skill MCP 插件二次鉴权 → 执行
```

---

## Task 1: 工具函数 — skillDirName 和 skillMdName

**Files:**
- Create: `apps/server/src/utils/skill-naming.ts`
- Test: `apps/server/src/utils/__tests__/skill-naming.test.ts`

### Step 1: 写失败的测试

```typescript
// apps/server/src/utils/__tests__/skill-naming.test.ts
import { describe, it, expect } from 'vitest';
import { skillDirName, skillMdName } from '../skill-naming';

describe('skillDirName', () => {
  it('enterprise skill: ent_{id}', () => {
    expect(skillDirName('enterprise', 'skill-123', null)).toBe('ent_skill-123');
  });
  it('personal skill: usr_{ownerId}_{id}', () => {
    expect(skillDirName('personal', 'skill-456', 'user-baizh')).toBe('usr_user-baizh_skill-456');
  });
});

describe('skillMdName', () => {
  it('enterprise skill: 直接用 name', () => {
    expect(skillMdName('enterprise', '数据分析', null)).toBe('数据分析');
  });
  it('personal skill: name:ownerIdShort', () => {
    expect(skillMdName('personal', '数据分析', 'user-baizh')).toBe('数据分析:user-b');
  });
  it('personal skill: ownerId 短于 6 字符时用全称', () => {
    expect(skillMdName('personal', '工具', 'abc')).toBe('工具:abc');
  });
});
```

### Step 2: 运行测试确认失败

Run: `npx vitest run apps/server/src/utils/__tests__/skill-naming.test.ts`
Expected: FAIL — module not found

### Step 3: 实现

```typescript
// apps/server/src/utils/skill-naming.ts

/** 生成 skill 在 data/skills/ 下的目录名（全局唯一） */
export function skillDirName(scope: string, skillId: string, ownerId: string | null): string {
  if (scope === 'personal' && ownerId) {
    return `usr_${ownerId}_${skillId}`;
  }
  return `ent_${skillId}`;
}

/** 生成 SKILL.md 中的 name 字段（引擎按此过滤，必须全局唯一） */
export function skillMdName(scope: string, name: string, ownerId: string | null): string {
  if (scope === 'personal' && ownerId) {
    const short = ownerId.length > 6 ? ownerId.slice(0, 6) : ownerId;
    return `${name}:${short}`;
  }
  return name;
}

/** 从 SKILL.md name 反解出原始 name（去掉 :ownerIdShort 后缀） */
export function parseSkillMdName(mdName: string): { name: string; ownerHint?: string } {
  const idx = mdName.lastIndexOf(':');
  if (idx > 0 && mdName.length - idx <= 7) {
    return { name: mdName.slice(0, idx), ownerHint: mdName.slice(idx + 1) };
  }
  return { name: mdName };
}
```

### Step 4: 运行测试确认通过

Run: `npx vitest run apps/server/src/utils/__tests__/skill-naming.test.ts`
Expected: PASS

### Step 5: 提交

```bash
git add apps/server/src/utils/skill-naming.ts apps/server/src/utils/__tests__/skill-naming.test.ts
git commit -m "feat: add skill naming utility for unified storage"
```

---

## Task 2: SKILL.md 生成函数

**Files:**
- Create: `apps/server/src/utils/skill-md-generator.ts`
- Test: `apps/server/src/utils/__tests__/skill-md-generator.test.ts`

### Step 1: 写失败的测试

```typescript
// apps/server/src/utils/__tests__/skill-md-generator.test.ts
import { describe, it, expect } from 'vitest';
import { generateSkillMd, mergeSkillMd } from '../skill-md-generator';

describe('generateSkillMd', () => {
  it('generates frontmatter with command-dispatch: tool', () => {
    const result = generateSkillMd({
      name: 'echarts-visualization',
      description: '智能可视化分析',
      scope: 'enterprise',
      ownerId: null,
      command: 'python3',
      scriptPath: 'scripts/main.py',
    });
    expect(result).toContain('name: echarts-visualization');
    expect(result).toContain('description: 智能可视化分析');
    expect(result).toContain('command-dispatch: tool');
    expect(result).toContain('command-tool: run_skill');
  });

  it('personal skill uses scoped name', () => {
    const result = generateSkillMd({
      name: '数据分析',
      description: '分析数据',
      scope: 'personal',
      ownerId: 'user-baizh',
    });
    expect(result).toContain('name: "数据分析:user-b"');
  });
});

describe('mergeSkillMd', () => {
  it('preserves existing SKILL.md body, replaces frontmatter', () => {
    const existing = '---\nname: old\n---\n\n# My Skill\n\nContent here.';
    const result = mergeSkillMd(existing, {
      name: 'new-name',
      description: 'desc',
      scope: 'enterprise',
      ownerId: null,
    });
    expect(result).toContain('name: new-name');
    expect(result).toContain('# My Skill');
    expect(result).toContain('Content here.');
    expect(result).not.toContain('name: old');
  });

  it('prepends frontmatter if no existing frontmatter', () => {
    const existing = '# My Skill\n\nNo frontmatter.';
    const result = mergeSkillMd(existing, {
      name: 'new-name',
      description: 'desc',
      scope: 'enterprise',
      ownerId: null,
    });
    expect(result).toContain('---\n');
    expect(result).toContain('name: new-name');
    expect(result).toContain('# My Skill');
  });
});
```

### Step 2: 运行测试确认失败

Run: `npx vitest run apps/server/src/utils/__tests__/skill-md-generator.test.ts`
Expected: FAIL

### Step 3: 实现

```typescript
// apps/server/src/utils/skill-md-generator.ts
import { skillMdName } from './skill-naming';

interface SkillMdParams {
  name: string;
  description: string;
  scope: string;
  ownerId: string | null;
  command?: string | null;
  scriptPath?: string | null;
  version?: string | null;
}

/** 生成标准 SKILL.md frontmatter（引擎可识别格式） */
export function generateSkillMd(params: SkillMdParams): string {
  const mdName = skillMdName(params.scope, params.name, params.ownerId);
  // 包含特殊字符时用引号包裹
  const quotedName = /[:"']/.test(mdName) ? `"${mdName}"` : mdName;

  const lines = [
    '---',
    `name: ${quotedName}`,
    `description: ${params.description}`,
  ];
  if (params.version) lines.push(`version: ${params.version}`);

  // command-dispatch: tool 让引擎知道 /skill_name 命令应调用 run_skill 工具
  lines.push('command-dispatch: tool');
  lines.push('command-tool: run_skill');

  lines.push('---');
  return lines.join('\n') + '\n';
}

/**
 * 合并：用新 frontmatter 替换已有 SKILL.md 的 frontmatter，保留 body。
 * 如果原文件无 frontmatter，则在头部插入。
 */
export function mergeSkillMd(existing: string, params: SkillMdParams): string {
  const newFrontmatter = generateSkillMd(params);
  const fmRegex = /^---\s*\n[\s\S]*?\n---\s*\n?/;
  if (fmRegex.test(existing)) {
    return existing.replace(fmRegex, newFrontmatter + '\n');
  }
  return newFrontmatter + '\n' + existing;
}
```

### Step 4: 运行测试确认通过

Run: `npx vitest run apps/server/src/utils/__tests__/skill-md-generator.test.ts`
Expected: PASS

### Step 5: 提交

```bash
git add apps/server/src/utils/skill-md-generator.ts apps/server/src/utils/__tests__/skill-md-generator.test.ts
git commit -m "feat: add SKILL.md generator with engine-compatible frontmatter"
```

---

## Task 3: 修改企业 skill 上传 — 统一目录

**Files:**
- Modify: `apps/server/src/routes/skills.ts` (upload handler, ~lines 217-335)

### Step 1: 在 skills.ts 头部导入新工具函数

```typescript
// 在 import 区域添加
import { skillDirName } from '../utils/skill-naming';
import { mergeSkillMd } from '../utils/skill-md-generator';
```

### Step 2: 修改企业 skill 上传路径

**位置**: `skills.ts` 约 line 231-232

**当前代码：**
```typescript
const skillId = `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const skillDir = path.resolve(enterpriseSkillsBase, skillId);
```

**替换为：**
```typescript
const skillId = `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const dirName = skillDirName('enterprise', skillId, null);
const skillDir = path.resolve(enterpriseSkillsBase, dirName);
```

### Step 3: 上传完成后合并 SKILL.md frontmatter

**位置**: 在 SKILL.md 解析和安全扫描之间（约 line 252 之后，287 之前）

**插入代码：**
```typescript
// 确保 SKILL.md 包含引擎兼容 frontmatter
const skillMdPath = path.join(skillDir, 'SKILL.md');
if (fs.existsSync(skillMdPath)) {
  const existing = fs.readFileSync(skillMdPath, 'utf-8');
  const merged = mergeSkillMd(existing, {
    name: parsedMeta.name || skillId,
    description: parsedMeta.description || '',
    scope: 'enterprise',
    ownerId: null,
    command: parsedMeta.command,
    scriptPath: parsedMeta.scriptPath,
    version: parsedMeta.version,
  });
  fs.writeFileSync(skillMdPath, merged, 'utf-8');
} else {
  // 没有 SKILL.md 则生成一个
  const { generateSkillMd } = await import('../utils/skill-md-generator');
  const content = generateSkillMd({
    name: parsedMeta.name || skillId,
    description: parsedMeta.description || '',
    scope: 'enterprise',
    ownerId: null,
    command: parsedMeta.command,
    scriptPath: parsedMeta.scriptPath,
    version: parsedMeta.version,
  });
  fs.writeFileSync(skillMdPath, content, 'utf-8');
}
```

### Step 4: 同步 skills.entries 到引擎

**位置**: 在 DB create 之后（约 line 317 后），替换或补充 `syncSkillEnabledToEngine`

**当前只同步 enabled：**
```typescript
await syncSkillEnabledToEngine(skillId, false); // pending 时 disabled
```

**改为通过 skills.entries 同步更完整配置：**
```typescript
// pending 状态不启用，但先在 entries 中注册
const entryName = parsedMeta.name || skillId;
await syncSkillEnabledToEngine(entryName, false);
```

### Step 5: 修改 syncSkillEnabledToEngine 用 skill name 而非 ID

**位置**: `skills.ts` 约 line 64

**当前：**
```typescript
async function syncSkillEnabledToEngine(skillId: string, enabled: boolean) {
```

**不变，但调用时传 name 而非 ID：**
- 上传时: `syncSkillEnabledToEngine(skill.name, enabled)`
- 审批时: `syncSkillEnabledToEngine(skill.name, true)`
- 禁用时: `syncSkillEnabledToEngine(skill.name, false)`

> 注意：当前函数参数名叫 skillId 但实际是 config key，改名为 `skillKey` 更准确。

### Step 6: 运行类型检查

Run: `npx tsc --noEmit -p apps/server/tsconfig.json`
Expected: 无新增错误

### Step 7: 提交

```bash
git add apps/server/src/routes/skills.ts
git commit -m "feat: enterprise skill upload uses unified data/skills/ directory"
```

---

## Task 4: 修改个人 skill 上传 — 统一到 data/skills/

**Files:**
- Modify: `apps/server/src/routes/skills.ts` (personal upload handler, ~lines 565-694)

### Step 1: 修改个人 skill 上传路径

**位置**: `skills.ts` 约 line 579-581

**当前代码：**
```typescript
const skillId = `skill-personal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const skillDir = path.join(usersBase, user.id, 'workspace', 'skills', skillId);
```

**替换为：**
```typescript
const skillId = `skill-personal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const dirName = skillDirName('personal', skillId, user.id);
const skillDir = path.resolve(enterpriseSkillsBase, dirName);
```

### Step 2: 上传完成后合并 SKILL.md（同 Task 3 Step 3）

```typescript
const skillMdPath = path.join(skillDir, 'SKILL.md');
if (fs.existsSync(skillMdPath)) {
  const existing = fs.readFileSync(skillMdPath, 'utf-8');
  const merged = mergeSkillMd(existing, {
    name: parsedMeta.name || skillId,
    description: parsedMeta.description || '',
    scope: 'personal',
    ownerId: user.id,
    command: parsedMeta.command,
    scriptPath: parsedMeta.scriptPath,
    version: parsedMeta.version,
  });
  fs.writeFileSync(skillMdPath, merged, 'utf-8');
} else {
  const content = generateSkillMd({
    name: parsedMeta.name || skillId,
    description: parsedMeta.description || '',
    scope: 'personal',
    ownerId: user.id,
    command: parsedMeta.command,
    scriptPath: parsedMeta.scriptPath,
    version: parsedMeta.version,
  });
  fs.writeFileSync(skillMdPath, content, 'utf-8');
}
```

### Step 3: 同步 skills.entries（用 scoped name）

```typescript
const mdName = skillMdName('personal', parsedMeta.name || skillId, user.id);
await syncSkillEnabledToEngine(mdName, status === 'active');
```

### Step 4: 运行类型检查

Run: `npx tsc --noEmit -p apps/server/tsconfig.json`
Expected: 无新增错误

### Step 5: 提交

```bash
git add apps/server/src/routes/skills.ts
git commit -m "feat: personal skill upload uses unified data/skills/ directory"
```

---

## Task 5: 修改 skill 删除路径

**Files:**
- Modify: `apps/server/src/routes/skills.ts` (delete handlers, ~lines 369-412, 699-735)

### Step 1: 修改企业 skill 删除路径

**位置**: `skills.ts` 约 line 399-402

**当前代码：**
```typescript
const skillDir = existing.scope === 'enterprise'
  ? path.join(enterpriseSkillsBase, id)
  : path.join(usersBase, existing.ownerId || '', 'workspace', 'skills', id);
```

**替换为：**
```typescript
const dirName = skillDirName(existing.scope, id, existing.ownerId);
const skillDir = path.resolve(enterpriseSkillsBase, dirName);
// 兼容旧目录名：如果新路径不存在，尝试旧路径
const legacyDir = existing.scope === 'enterprise'
  ? path.join(enterpriseSkillsBase, id)
  : path.join(usersBase, existing.ownerId || '', 'workspace', 'skills', id);
const targetDir = fs.existsSync(skillDir) ? skillDir : legacyDir;
```

然后用 `targetDir` 做 `rmDir()`。

### Step 2: 修改个人 skill 删除路径

**位置**: `skills.ts` 约 line 728-729

**当前代码：**
```typescript
const skillDir = path.join(usersBase, user.id, 'workspace', 'skills', id);
```

**替换为：**
```typescript
const dirName = skillDirName('personal', id, user.id);
const skillDir = path.resolve(enterpriseSkillsBase, dirName);
const legacyDir = path.join(usersBase, user.id, 'workspace', 'skills', id);
const targetDir = fs.existsSync(skillDir) ? skillDir : legacyDir;
```

### Step 3: 删除时同步 skills.entries 禁用

在 DB 删除后添加：
```typescript
const mdName = skillMdName(existing.scope, existing.name, existing.ownerId);
await syncSkillEnabledToEngine(mdName, false);
```

### Step 4: 运行类型检查

Run: `npx tsc --noEmit -p apps/server/tsconfig.json`

### Step 5: 提交

```bash
git add apps/server/src/routes/skills.ts
git commit -m "fix: skill delete uses unified directory with legacy fallback"
```

---

## Task 6: 修改 MCP 插件 run_skill 路径查找

**Files:**
- Modify: `plugins/mcp/src/index.ts` (~lines 704-720)

### Step 1: 修改路径解析逻辑

**位置**: `plugins/mcp/src/index.ts` 约 line 704-712

**当前代码：**
```typescript
const resolveSkillPath = (base: string) => {
  const byName = path.resolve(base, skill.name);
  if (fs.existsSync(byName)) return byName;
  return path.resolve(base, skill.id);
};
const skillPath = skill.scope === 'enterprise'
  ? resolveSkillPath(path.resolve(_dataRoot, 'skills'))
  : resolveSkillPath(path.resolve(_dataRoot, 'users', skill.ownerId || userId, 'workspace', 'skills'));
```

**替换为：**
```typescript
// 统一目录：data/skills/{scope}_{skillId}/
const skillsBase = path.resolve(_dataRoot, 'skills');
const scopePrefix = skill.scope === 'personal' && skill.ownerId
  ? `usr_${skill.ownerId}_${skill.id}`
  : `ent_${skill.id}`;
let skillPath = path.resolve(skillsBase, scopePrefix);

// 兼容旧目录：按 name、按 id、按旧个人路径
if (!fs.existsSync(skillPath)) {
  const candidates = [
    path.resolve(skillsBase, skill.name),
    path.resolve(skillsBase, skill.id),
  ];
  if (skill.scope === 'personal') {
    candidates.push(
      path.resolve(_dataRoot, 'users', skill.ownerId || userId, 'workspace', 'skills', skill.id),
      path.resolve(_dataRoot, 'users', skill.ownerId || userId, 'workspace', 'skills', skill.name),
    );
  }
  const found = candidates.find(p => fs.existsSync(p));
  if (found) skillPath = found;
}
```

### Step 2: 运行类型检查

Run: `npx tsc --noEmit -p plugins/mcp/tsconfig.json`

### Step 3: 提交

```bash
git add plugins/mcp/src/index.ts
git commit -m "feat: run_skill unified path lookup with legacy fallback"
```

---

## Task 7: 修改 AgentConfigSync — skillsFilter 用引擎可识别的 name

**Files:**
- Modify: `apps/server/src/services/AgentConfigSync.ts` (~lines 205-234)
- Modify: `apps/server/src/routes/agents.ts` (~lines 33-41, 361)

### Step 1: 修改 filterEnabledSkills 返回引擎 name

**位置**: `agents.ts` 约 line 33-41

**当前代码：**
```typescript
async function filterEnabledSkills(prisma: AppPrismaClient, skillsFilter: string[]): Promise<string[]> {
  // 查 DB 返回 enabled 的 skill name 列表
}
```

**改为返回引擎识别的 skillMdName：**
```typescript
import { skillMdName } from '../utils/skill-naming';

async function filterEnabledSkills(prisma: AppPrismaClient, skillsFilter: string[]): Promise<string[]> {
  if (!skillsFilter.length) return [];
  const skills = await prisma.skill.findMany({
    where: { enabled: true, name: { in: skillsFilter } },
    select: { name: true, scope: true, ownerId: true },
  });
  return skills.map(s => skillMdName(s.scope, s.name, s.ownerId));
}
```

### Step 2: 验证 AgentConfigSync 无需改动

`AgentConfigSync.ts:212` 已经直接用 `opts.skillsFilter` 的值写入 `entry.skills`：

```typescript
const newSkills = hasSkills ? [...opts.skillsFilter] : [];
entry.skills = newSkills;
```

由于 `filterEnabledSkills` 现在返回的是 `skillMdName`（引擎可识别格式），这里无需改动。

### Step 3: 运行类型检查

Run: `npx tsc --noEmit -p apps/server/tsconfig.json`

### Step 4: 提交

```bash
git add apps/server/src/routes/agents.ts
git commit -m "feat: skillsFilter sync uses engine-compatible skill names"
```

---

## Task 8: 迁移现有 skill 目录

**Files:**
- Create: `scripts/migrate-skills.ts`

### Step 1: 编写迁移脚本

```typescript
// scripts/migrate-skills.ts
/**
 * 一次性迁移脚本：将现有 skill 目录重命名为统一格式
 *
 * 迁移规则：
 * 1. 企业 skill: data/skills/{旧名}/ → data/skills/ent_{skillId}/
 * 2. 个人 skill: data/users/{userId}/workspace/skills/{id}/ → data/skills/usr_{userId}_{id}/
 * 3. 更新每个 SKILL.md 的 frontmatter
 * 4. 不删除旧目录（rename/move）
 *
 * 用法: npx tsx scripts/migrate-skills.ts [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const DATA_ROOT = process.env.DATA_ROOT || './data';
const SKILLS_BASE = path.resolve(DATA_ROOT, 'skills');
const USERS_BASE = path.resolve(DATA_ROOT, 'users');
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const prisma = new PrismaClient();
  const skills = await prisma.skill.findMany();

  console.log(`Found ${skills.length} skills in DB. Dry run: ${DRY_RUN}`);

  for (const skill of skills) {
    const scopePrefix = skill.scope === 'personal' && skill.ownerId
      ? `usr_${skill.ownerId}_${skill.id}`
      : `ent_${skill.id}`;
    const newDir = path.resolve(SKILLS_BASE, scopePrefix);

    // 查找旧目录
    const candidates = [
      path.resolve(SKILLS_BASE, skill.name),                        // by name
      path.resolve(SKILLS_BASE, skill.id),                          // by id
      ...(skill.scope === 'personal' && skill.ownerId ? [
        path.resolve(USERS_BASE, skill.ownerId, 'workspace', 'skills', skill.id),
        path.resolve(USERS_BASE, skill.ownerId, 'workspace', 'skills', skill.name),
      ] : []),
    ];
    const oldDir = candidates.find(d => fs.existsSync(d));

    if (!oldDir) {
      console.warn(`⚠️  SKIP ${skill.id} (${skill.name}): 目录不存在`);
      continue;
    }
    if (oldDir === newDir) {
      console.log(`✅ OK ${skill.id}: 已在正确位置`);
      continue;
    }
    if (fs.existsSync(newDir)) {
      console.warn(`⚠️  SKIP ${skill.id}: 目标已存在 ${newDir}`);
      continue;
    }

    console.log(`🔄 MOVE ${skill.id} (${skill.name})`);
    console.log(`   FROM: ${oldDir}`);
    console.log(`   TO:   ${newDir}`);

    if (!DRY_RUN) {
      fs.renameSync(oldDir, newDir);

      // 更新 SKILL.md frontmatter
      const mdPath = path.join(newDir, 'SKILL.md');
      if (fs.existsSync(mdPath)) {
        const { mergeSkillMd } = await import('../apps/server/src/utils/skill-md-generator');
        const existing = fs.readFileSync(mdPath, 'utf-8');
        const merged = mergeSkillMd(existing, {
          name: skill.name,
          description: skill.description || '',
          scope: skill.scope,
          ownerId: skill.ownerId,
          command: skill.command,
          scriptPath: skill.scriptPath,
          version: skill.version,
        });
        fs.writeFileSync(mdPath, merged, 'utf-8');
      }
    }
  }

  await prisma.$disconnect();
  console.log('\nDone.');
}

main().catch(console.error);
```

### Step 2: 先 dry-run 验证

Run: `npx tsx scripts/migrate-skills.ts --dry-run`
Expected: 打印每个 skill 的迁移计划，不实际移动

### Step 3: 执行迁移

Run: `npx tsx scripts/migrate-skills.ts`
Expected: 目录重命名完成

### Step 4: 验证迁移结果

Run: `ls -la data/skills/`
Expected: 看到 `ent_claude-code-dispatch/`, `ent_skill-1773064953337-lqicu5/` 等

Run: `head -10 data/skills/ent_*/SKILL.md`
Expected: 每个 SKILL.md 都有 `command-dispatch: tool` + `command-tool: run_skill`

### Step 5: 提交

```bash
git add scripts/migrate-skills.ts
git commit -m "feat: add one-time skill directory migration script"
```

---

## Task 9: 更新 octopus.json skills 配置

**Files:**
- Modify: `.octopus-state/octopus.json` (通过 API 或手动)

### Step 1: 添加 skills.entries 和 watch 配置

**当前：**
```json5
"skills": {
  "load": {
    "extraDirs": ["/home/baizh/octopus/data/skills"]
  }
}
```

**改为：**
```json5
"skills": {
  "load": {
    "extraDirs": ["/home/baizh/octopus/data/skills"],
    "watch": true,
    "watchDebounceMs": 500
  },
  "entries": {
    "claude-code-dispatch": { "enabled": true },
    "echarts-visualization": { "enabled": true },
    "team-research": { "enabled": true },
    "ppt-generator": { "enabled": true }
  }
}
```

> Note: entries 的 key 是 SKILL.md 的 name 字段（引擎按此查找）。
> watch 启用后，新上传的 skill 引擎自动发现，无需重启。

### Step 2: 更新 Docker sandbox binds 兼容统一目录

**当前：**
```json5
"binds": ["/home/baizh/octopus/data/skills:/home/baizh/octopus/data/skills:ro"]
```

无需改动（个人 skill 也在 `data/skills/` 下了）。✅

### Step 3: 验证引擎发现 skill

Run: `curl -s localhost:18790/health` (验证服务正常)

然后通过 gateway RPC 检查 skill 状态（如有 CLI）：
```bash
# 引擎层检查
openclaw skills list  # 或通过 RPC: skills.status
```

### Step 4: 提交配置（如果是手动修改 octopus.json）

> 注意: octopus.json 是引擎运行时配置，通常通过 API 修改。如果手动编辑需重启引擎。

---

## Task 10: 精简 SoulTemplate 中的 skill 规则

**Files:**
- Modify: `data/templates/soul-default.md`
- Modify: `data/templates/soul-professional.md`

### Step 1: 精简 skill 使用规则

引擎现在原生注入 `<available_skills>` 段到系统提示，包含 skill 名称、描述和 SKILL.md 路径。SoulTemplate 中的硬编码规则可以精简。

**当前 soul-default.md 的 Skill 部分（约 8 行）：**
```markdown
## Skill 使用规则
- **执行任何 Skill 前，必须完成以下两步：**
  1. **搜索记忆**：调用 `memory_recall("技能名 经验教训")` 搜索该技能的历史使用经验和教训，阅读并遵守
  2. **阅读说明**：阅读该 Skill 目录下的 `skill.md`，严格按照其中定义的流程和规范执行
- 所有产出文件（结果、中间数据）统一放到 `$SESSION_DIR` 目录
- 生成 HTML 报告时，数据必须内嵌到 HTML 中，不要引用外部文件路径
- **Skill 执行过程中遇到报错或发现配置问题，必须用 `memory_store` 记录经验教训**（importance=1.0, category=fact），确保下次不再犯同样的错误
```

**精简为（引擎已注入 skill 列表和路径，无需重复）：**
```markdown
## Skill 使用规则
- 执行 Skill 前先调用 `memory_recall("技能名 经验教训")` 查历史教训
- 阅读 Skill 目录下 SKILL.md，严格按规范执行
- 产出文件放到 `$SESSION_DIR`；HTML 报告数据必须内嵌
- 遇到报错用 `memory_store` 记录教训（importance=1.0, category=fact）
```

> 保留业务规则（记忆搜索、文件存放约定），删除引擎已覆盖的部分（skill 列表、路径描述）。

### Step 2: 同步修改 soul-professional.md

相同改动。

### Step 3: 提交

```bash
git add data/templates/soul-default.md data/templates/soul-professional.md
git commit -m "refactor: simplify SoulTemplate skill rules (engine handles discovery)"
```

---

## Task 11: syncSkillEnabledToEngine 改用 skill name 为 key

**Files:**
- Modify: `apps/server/src/routes/skills.ts`

### Step 1: 审计所有 syncSkillEnabledToEngine 调用点

当前调用点：
- **审批** (~line 470): `syncSkillEnabledToEngine(id, true)` ← 用的 DB id，应改为 name
- **拒绝** (~line 498): `syncSkillEnabledToEngine(id, false)` ← 同上
- **启用/禁用** (~line 530): `syncSkillEnabledToEngine(id, enabled)` ← 同上
- **删除** (~line 405): 隐式（通过 skills.entries disabled）

### Step 2: 统一改为传 skillMdName

每个调用点改为先查 skill.name 和 scope，再生成 mdName：

```typescript
// 审批时（约 line 470）
const mdName = skillMdName(skill.scope, skill.name, skill.ownerId);
await syncSkillEnabledToEngine(mdName, true);

// 拒绝时（约 line 498）
const mdName = skillMdName(skill.scope, skill.name, skill.ownerId);
await syncSkillEnabledToEngine(mdName, false);

// 启用/禁用时（约 line 530）
const mdName = skillMdName(skill.scope, skill.name, skill.ownerId);
await syncSkillEnabledToEngine(mdName, enabled);
```

### Step 3: 重命名函数参数（可选但推荐）

```typescript
async function syncSkillEnabledToEngine(skillKey: string, enabled: boolean) {
  if (!bridge) return;
  try {
    await bridge.configApply({ skills: { entries: { [skillKey]: { enabled } } } });
    logger.info('Synced skill to engine', { skillKey, enabled });
  } catch (e: unknown) {
    logger.warn('Failed to sync skill to engine', { skillKey, error: (e as Error).message });
  }
}
```

### Step 4: 运行类型检查

Run: `npx tsc --noEmit -p apps/server/tsconfig.json`

### Step 5: 提交

```bash
git add apps/server/src/routes/skills.ts
git commit -m "fix: syncSkillEnabled uses engine-compatible skill name as key"
```

---

## Task 12: 端到端验证

### Step 1: 重启服务

```bash
cd /home/baizh/octopus && bash start.sh
```

### Step 2: 验证引擎发现 skill

检查引擎日志中 skill 发现相关信息：
```bash
tail -100 /tmp/openclaw/openclaw-*.log | grep -i skill
```

Expected: 看到从 `data/skills/` 加载 skill 的日志

### Step 3: 验证 agent 权限过滤

登录 Web 控制台：
1. user-baizh 的 default agent 应看到 4 个 skill（echarts、team-research、ppt、claude-code-dispatch）
2. user-admin 的 default agent 应看到 0 个 skill（skills 为空）
3. user-baizh 的 think agent 应看到 1 个 skill（team-research）

### Step 4: 验证 run_skill 执行

在 user-baizh 的 default agent 中发消息测试：
```
请用 echarts-visualization 技能生成一个简单的柱状图
```

Expected: agent 调用 `run_skill("echarts-visualization")`，MCP 插件找到 `data/skills/ent_skill-1773064953337-lqicu5/`，正常执行

### Step 5: 验证个人 skill 上传（如有测试用户）

通过 API 上传一个测试个人 skill：
```bash
curl -X POST http://localhost:18790/api/skills/personal/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@test-skill.zip"
```

Expected: 解压到 `data/skills/usr_{userId}_skill-personal-xxx/`

### Step 6: 验证类型检查 + 测试

```bash
npx tsc --noEmit -p apps/server/tsconfig.json
npx vitest run
```

Expected: 全部通过

---

## 风险与回退

| 风险 | 缓解措施 |
|------|---------|
| 迁移后旧路径查找失败 | Task 5-6 都有 legacy fallback，优先新路径、回退旧路径 |
| ppt-generator 目录缺失 | 迁移脚本会 WARN，需手动从 zip 重新解压 |
| 引擎 watch 延迟 | 500ms debounce，上传后最多等 1 秒引擎刷新 |
| 两个用户同名个人 skill | skillMdName 加 `:ownerIdShort` 后缀，引擎去重不冲突 |
| 回退方案 | 保留 legacy fallback 代码至少 1 个月，所有路径查找都有降级 |

---

## 后续优化（不在本次范围）

- [ ] `skills.entries` 同步 `apiKey`/`env`/`config`（需要前端配置 UI）
- [ ] 利用引擎 `skills.status` RPC 替代自建 SkillScanner
- [ ] 利用引擎 `skills.install` RPC 支持更多依赖安装方式（brew/node/go）
- [ ] 接入 ClawHub 公共 skill 注册表
- [ ] 个人 skill ID 去掉 `skill-personal-` 前缀简化命名

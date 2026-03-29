/**
 * 消息列表区域（欢迎页 TIPS + 消息气泡 + 提醒浮层）
 *
 * 从 ChatPage.tsx 提取，不含任何新业务逻辑。
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { cn } from '@/lib/utils';

// shadcn/ui components
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

// lucide-react icons
import {
  X,
  ChevronRight,
  Brain,
  BellRing,
  User,
  Wrench,
  Users,
  Clock,
  Zap,
  FileText,
  ChevronDown,
} from 'lucide-react';
import { OctopusIcon } from '@/components/OctopusIcon';

// 过滤消息内容中不应显示给用户的内部标签
// Legacy: 保留用于清理旧 session 中残留的 reminder 标签，新提醒走 cron 工具
const REMINDER_TAG_RE = /<enterprise-reminder[^>]*\/?>(<\/enterprise-reminder>)?/g;
const MEMORY_TAG_RE = /<relevant-memories>[\s\S]*?<\/relevant-memories>/g;
const UNTRUSTED_DATA_RE = /\[UNTRUSTED DATA[\s\S]*?\[END UNTRUSTED DATA\]/g;
const SKILL_INJECT_RE = /^\[请(?:使用|严格按照|优先使用)\s+[^\]]*\]\s*/m;
const MCP_INJECT_RE = /^\[请使用\s+\S+\s+MCP\s+工具完成以下任务\]\s*/m;
const TIMESTAMP_PREFIX_RE = /^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s\d{4}-\d{2}-\d{2}[^\]]*\]\s*/m;
function filterInternalTags(text: string): string {
  return text
    .replace(MEMORY_TAG_RE, '')
    .replace(UNTRUSTED_DATA_RE, '')
    .replace(REMINDER_TAG_RE, '')
    .replace(SKILL_INJECT_RE, '')
    .replace(MCP_INJECT_RE, '')
    .replace(TIMESTAMP_PREFIX_RE, '')
    .trim();
}

// 共享类型
import type { ToolCallInfo, ChatMessage } from '../types/chat';

const TIPS = [
  '帮我分析今日的电力负荷数据趋势',
  '写一个 Python 脚本处理 CSV 文件',
  '解释一下 Transformer 架构的工作原理',
  '帮我起草一份技术评审报告',
];

// Markdown 渲染插件（组件外声明避免每次渲染重建数组）
const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

/** 代码块组件：显示语言标签 + 语法高亮 */
function CodeBlock({ className, children, node, ...props }: React.ComponentPropsWithoutRef<'code'> & { node?: unknown }) {
  // rehype-highlight 会在 className 中注入 "hljs language-xxx"
  const match = /language-(\w+)/.exec(className || '');
  const isInline = !match && typeof children === 'string' && !children.includes('\n');

  if (isInline) {
    return <code className="md-inline-code" {...props}>{children}</code>;
  }

  const lang = match?.[1] || '';
  return (
    <div className="md-code-block">
      {lang && <div className="md-code-lang">{lang}</div>}
      <pre><code className={className} {...props}>{children}</code></pre>
    </div>
  );
}

/** 将 outputs/xxx 路径转换为下载链接 */
function linkifyOutputPaths(text: string): string {
  // 匹配 outputs/开头的文件路径（可能被反引号包裹）
  return text.replace(
    /`?(outputs\/[\w./-]+\.\w+)`?/g,
    (match, filePath) => `[📥 ${filePath}](/api/files/download/${filePath})`
  );
}

/** Markdown 渲染组件（assistant 消息专用） */
function MarkdownContent({ content }: { content: string }) {
  const components = useMemo(() => ({
    // 链接：outputs 下载链接直接触发下载，其他链接在新标签页打开
    a: ({ children, href, node, ...props }: React.ComponentPropsWithoutRef<'a'> & { node?: unknown }) => {
      if (href?.startsWith('/api/files/download/')) {
        return (
          <a
            href="#"
            onClick={async (e) => {
              e.preventDefault();
              try {
                const filePath = href.replace('/api/files/download/', '');
                const token = localStorage.getItem('admin_token');
                const resp = await fetch(`/api/files/download-token?path=${encodeURIComponent(filePath)}`, {
                  headers: { Authorization: `Bearer ${token}` },
                });
                if (!resp.ok) throw new Error('获取下载令牌失败');
                const { token: dlToken } = await resp.json();
                window.open(`/api/files/download/${filePath}?token=${dlToken}`, '_blank');
              } catch (err) {
                console.error('下载失败:', err);
              }
            }}
            className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 underline cursor-pointer"
            {...props}
          >
            {children}
          </a>
        );
      }
      return <a target="_blank" rel="noopener noreferrer" href={href} {...props}>{children}</a>;
    },
    code: CodeBlock,
  }), []);

  return (
    <div className="md-prose">
      <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {linkifyOutputPaths(content)}
      </Markdown>
    </div>
  );
}

/** 截断过长的工具名，保留前 40 字符 */
function truncateToolName(name: string, maxLen = 40): string {
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen) + '...';
}

/** 格式化 JSON 字符串，用于展示工具参数和结果 */
function formatJsonDisplay(raw?: string): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

/** 检测是否为 team-research 的 run_skill 调用 */
function isClawTeamCall(tc: ToolCallInfo): { isClawTeam: boolean; template?: string; topic?: string; depth?: string } {
  if (tc.name !== 'run_skill') return { isClawTeam: false };
  try {
    const args = JSON.parse(tc.args || '{}');
    if (args.skill_name === 'team-research') {
      const argsStr = args.args || '';
      const tmplMatch = argsStr.match(/--template\s+(\S+)/);
      const topicMatch = argsStr.match(/--topic\s+'([^']+)'|--topic\s+"([^"]+)"|--topic\s+(\S+)/);
      const depthMatch = argsStr.match(/--depth\s+(\S+)/);
      return {
        isClawTeam: true,
        template: tmplMatch?.[1] || 'research-survey',
        topic: topicMatch?.[1] || topicMatch?.[2] || topicMatch?.[3] || '研究课题',
        depth: depthMatch?.[1] || 'standard',
      };
    }
  } catch { /* ignore */ }
  return { isClawTeam: false };
}

/** 尝试从 run_skill 工具调用中提取 clawteam team_process 数据 */
function extractClawTeamProcess(tc: ToolCallInfo): Record<string, unknown> | null {
  if (tc.name !== 'run_skill' || !tc.result) return null;
  try {
    const resultObj = JSON.parse(tc.result);
    // 优先从顶层取（后端已提取，避免 stdout 截断问题）
    if (resultObj?.team_process) return resultObj.team_process;
    // 兜底：从 stdout JSON 中解析
    const stdout = resultObj.stdout;
    if (stdout && typeof stdout === 'string') {
      const parsed = JSON.parse(stdout);
      if (parsed?.team_process) return parsed.team_process;
    }
  } catch { /* not clawteam */ }
  return null;
}

/** 各模板对应的角色列表 */
const TEMPLATE_ROLES: Record<string, { leader: string; workers: string[]; editor: string }> = {
  'research-survey': {
    leader: '调研组长',
    workers: ['政策环境分析员', '行业现状分析员', '核心技术分析员', '实施风险分析员', '建议方案撰写员'],
    editor: '报告整合编辑',
  },
  'brainstorm': {
    leader: '主持人',
    workers: ['发散思维者', '用户视角代言人', '魔鬼代言人', '落地实践者', '跨界借鉴者'],
    editor: '方案整理人',
  },
  'speech-draft': {
    leader: '撰稿统筹',
    workers: ['背景素材员', '核心观点提炼师', '金句文采师', '听众预判师'],
    editor: '终稿撰写人',
  },
};

const DEPTH_WORKER_COUNT: Record<string, number> = { quick: 3, standard: 5, deep: 7 };

/** ClawTeam 执行中动画卡片 */
function ClawTeamProgress({ template, topic, depth = 'standard' }: { template: string; topic: string; depth?: string }) {
  const baseRoles = TEMPLATE_ROLES[template] || TEMPLATE_ROLES['research-survey'];
  const targetCount = DEPTH_WORKER_COUNT[depth] || 5;
  // 根据 depth 动态扩展/裁剪 worker 列表
  const workers = targetCount <= baseRoles.workers.length
    ? baseRoles.workers.slice(0, targetCount)
    : [...baseRoles.workers, ...Array.from({ length: targetCount - baseRoles.workers.length }, (_, i) => `研究员${i + 1}`)];
  const roles = { ...baseRoles, workers };
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // 根据时间推进阶段
  // Phase 1: 0-15s (Leader), Phase 2: 15-120s (Workers), Phase 3: 120s+ (Editor)
  const phase = elapsed < 15 ? 1 : elapsed < 120 ? 2 : 3;
  // Worker 阶段中，每隔几秒高亮下一个 worker
  const activeWorkerIdx = phase === 2 ? Math.floor((elapsed - 15) / 8) % roles.workers.length : -1;

  const templateLabels: Record<string, string> = {
    'research-survey': '调研报告', 'brainstorm': '头脑风暴', 'speech-draft': '发言稿',
  };

  return (
    <div className="mb-3 rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 overflow-hidden text-sm">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-indigo-600/15 to-purple-600/10 border-b border-indigo-500/20">
        <div className="flex items-center gap-2 mb-1">
          <Users className="h-4 w-4 text-indigo-400 animate-pulse" />
          <span className="font-semibold text-foreground">OctopusTeam 多智能体协作中...</span>
          <span className="ml-auto text-[11px] text-muted-foreground font-mono">{fmtDuration(elapsed)}</span>
        </div>
        <div className="text-xs text-muted-foreground mt-1 line-clamp-1">{topic}</div>
        <div className="flex gap-3 mt-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300">
            {templateLabels[template] || template}
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" /> {roles.workers.length} 位专家
          </span>
        </div>
      </div>

      {/* Phase 1: Leader */}
      <div className={cn('px-4 py-2.5 border-b border-border/50 transition-opacity', phase >= 1 ? 'opacity-100' : 'opacity-30')}>
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-indigo-500/20 flex items-center justify-center text-[11px]">📋</div>
          <span className="font-medium text-foreground text-xs">Phase 1 · 任务拆分</span>
          {phase === 1 && <span className="ml-auto text-[11px] text-indigo-400 animate-pulse">进行中...</span>}
          {phase > 1 && <span className="ml-auto text-[11px] text-emerald-400">✓ 完成</span>}
        </div>
        {phase === 1 && (
          <div className="mt-1 text-[11px] text-muted-foreground pl-7 animate-pulse">
            <span className="text-indigo-400">{roles.leader}</span> 正在分析课题并拆分调研维度...
          </div>
        )}
      </div>

      {/* Phase 2: Workers */}
      <div className={cn('px-4 py-2.5 border-b border-border/50 transition-opacity', phase >= 2 ? 'opacity-100' : 'opacity-30')}>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center text-[11px]">⚡</div>
          <span className="font-medium text-foreground text-xs">Phase 2 · 并行调研</span>
          {phase === 2 && <span className="ml-auto text-[11px] text-emerald-400 animate-pulse">进行中...</span>}
          {phase > 2 && <span className="ml-auto text-[11px] text-emerald-400">✓ 完成</span>}
        </div>
        {phase >= 2 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pl-1">
            {roles.workers.map((role, i) => (
              <div
                key={i}
                className={cn(
                  'rounded-lg border px-2.5 py-2 bg-gradient-to-br transition-all duration-500',
                  WORKER_COLORS[i % WORKER_COLORS.length],
                  phase === 2 && i === activeWorkerIdx && 'ring-1 ring-indigo-400/50 scale-[1.02]',
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{WORKER_ICONS[i % WORKER_ICONS.length]}</span>
                  <span className="font-medium text-[11px] text-foreground truncate">{role}</span>
                </div>
                {phase === 2 && i === activeWorkerIdx && (
                  <div className="text-[10px] text-indigo-300 mt-1 animate-pulse">发言中...</div>
                )}
                {phase === 2 && i !== activeWorkerIdx && (
                  <div className="text-[10px] text-muted-foreground mt-1">调研中</div>
                )}
                {phase > 2 && (
                  <div className="text-[10px] text-emerald-400 mt-1">✓ 完成</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Phase 3: Editor */}
      <div className={cn('px-4 py-2.5 transition-opacity', phase >= 3 ? 'opacity-100' : 'opacity-30')}>
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center text-[11px]">✍️</div>
          <span className="font-medium text-foreground text-xs">Phase 3 · 报告整合</span>
          {phase === 3 && <span className="ml-auto text-[11px] text-amber-400 animate-pulse">进行中...</span>}
        </div>
        {phase === 3 && (
          <div className="mt-1 text-[11px] text-muted-foreground pl-7 animate-pulse">
            <span className="text-amber-400">{roles.editor}</span> 正在整合各维度成果，生成最终报告...
          </div>
        )}
      </div>
    </div>
  );
}

/** Worker 角色对应的装饰色 */
const WORKER_COLORS = [
  'from-blue-500/20 to-blue-600/10 border-blue-500/30',
  'from-emerald-500/20 to-emerald-600/10 border-emerald-500/30',
  'from-amber-500/20 to-amber-600/10 border-amber-500/30',
  'from-purple-500/20 to-purple-600/10 border-purple-500/30',
  'from-rose-500/20 to-rose-600/10 border-rose-500/30',
  'from-cyan-500/20 to-cyan-600/10 border-cyan-500/30',
  'from-orange-500/20 to-orange-600/10 border-orange-500/30',
];

const WORKER_ICONS = ['🏛', '📊', '🔧', '⚠️', '💡', '🎯', '🔍'];

/** 格式化秒数为可读时间 */
function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s > 0 ? `${m}m${s}s` : `${m}m`;
}

/** 格式化字符数 */
function fmtChars(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万字`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}千字`;
  return `${n}字`;
}

/** ClawTeam 团队协作可视化卡片 */
function ClawTeamCard({ process }: { process: Record<string, unknown> }) {
  const title = process.title as string || '研究课题';
  const templateLabel = process.template_label as string || '研究';
  const depth = process.depth as string || 'standard';
  const numWorkers = process.num_workers as number || 0;
  const totalDuration = process.total_duration_sec as number || 0;
  const totalCalls = process.total_llm_calls as number || 0;
  const phases = (process.phases || []) as Record<string, unknown>[];

  const leaderPhase = phases[0] || {};
  const workersPhase = phases[1] || {};
  const editorPhase = phases[2] || {};
  const workers = (workersPhase.workers || []) as Record<string, unknown>[];

  const [showReport, setShowReport] = useState(false);

  return (
    <div className="mb-3 rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 overflow-hidden text-sm">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-indigo-600/15 to-purple-600/10 border-b border-indigo-500/20">
        <div className="flex items-center gap-2 mb-1">
          <Users className="h-4 w-4 text-indigo-400" />
          <span className="font-semibold text-foreground">OctopusTeam 多智能体协作</span>
        </div>
        <div className="text-xs text-muted-foreground mt-1 line-clamp-1" title={title}>{title}</div>
        <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300">
            {templateLabel}
          </span>
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" /> {numWorkers} 位专家
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" /> {fmtDuration(totalDuration)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Zap className="h-3 w-3" /> {totalCalls} 次 LLM
          </span>
        </div>
      </div>

      {/* Phase 1: Leader */}
      <div className="px-4 py-2.5 border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-indigo-500/20 flex items-center justify-center text-[11px]">📋</div>
          <span className="font-medium text-foreground text-xs">Phase 1 · {leaderPhase.name as string || '任务拆分'}</span>
          <span className="ml-auto text-[11px] text-muted-foreground">{fmtDuration(leaderPhase.duration_sec as number || 0)}</span>
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground pl-7">
          <span className="text-indigo-400">{leaderPhase.role as string}</span> — {leaderPhase.output_summary as string || ''}
        </div>
      </div>

      {/* Phase 2: Workers */}
      <div className="px-4 py-2.5 border-b border-border/50">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center text-[11px]">⚡</div>
          <span className="font-medium text-foreground text-xs">Phase 2 · {workersPhase.name as string || '并行调研'}</span>
          <span className="ml-auto text-[11px] text-muted-foreground">{fmtDuration(workersPhase.total_duration_sec as number || 0)}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pl-1">
          {workers.map((w, i) => (
            <div
              key={i}
              className={cn(
                'rounded-lg border px-2.5 py-2 bg-gradient-to-br',
                WORKER_COLORS[i % WORKER_COLORS.length]
              )}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-sm">{WORKER_ICONS[i % WORKER_ICONS.length]}</span>
                <span className="font-medium text-[11px] text-foreground truncate">{w.role as string}</span>
              </div>
              <div className="text-[10px] text-muted-foreground space-y-0.5">
                <div className="flex justify-between">
                  <span>{w.dimension as string}</span>
                  <span>{fmtDuration(w.duration_sec as number || 0)}</span>
                </div>
                <div>{fmtChars(w.output_chars as number || 0)}</div>
              </div>
              {Boolean(w.failed) && (
                <div className="text-[10px] text-red-400 mt-0.5">调研失败</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Phase 3: Editor */}
      <div className="px-4 py-2.5 border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center text-[11px]">✍️</div>
          <span className="font-medium text-foreground text-xs">Phase 3 · {editorPhase.name as string || '报告整合'}</span>
          <span className="ml-auto text-[11px] text-muted-foreground">{fmtDuration(editorPhase.duration_sec as number || 0)}</span>
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground pl-7">
          <span className="text-amber-400">{editorPhase.role as string}</span> — 生成 {fmtChars(editorPhase.output_chars as number || 0)}完整报告
        </div>
      </div>

      {/* Report toggle */}
      <div className="px-4 py-2">
        <button
          onClick={() => setShowReport(!showReport)}
          className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
        >
          <FileText className="h-3.5 w-3.5" />
          <span>{showReport ? '收起报告' : '查看完整报告'}</span>
          <ChevronDown className={cn('h-3 w-3 transition-transform', showReport && 'rotate-180')} />
        </button>
      </div>
    </div>
  );
}

/** 工具调用卡片列表 */
function ToolCallCards({ toolCalls, isStreaming }: { toolCalls: ToolCallInfo[]; isStreaming?: boolean }) {
  if (toolCalls.length === 0) return null;
  return (
    <div className="space-y-1.5 mb-2">
      {toolCalls.map((tc, idx) => {
        const clawInfo = isClawTeamCall(tc);

        // ClawTeam 执行完成 — 展示结果卡片
        const teamProcess = extractClawTeamProcess(tc);
        if (teamProcess) {
          return <ClawTeamCard key={tc.toolCallId || `tool-${idx}`} process={teamProcess} />;
        }

        // ClawTeam 执行中 — 仅在流式输出时展示动画进度卡片（历史加载不显示）
        if (clawInfo.isClawTeam && !tc.result && isStreaming) {
          return <ClawTeamProgress key={tc.toolCallId || `tool-${idx}`} template={clawInfo.template!} topic={clawInfo.topic!} depth={clawInfo.depth} />;
        }

        return (
          <Collapsible key={tc.toolCallId || `tool-${idx}`}>
            <CollapsibleTrigger className="flex items-center gap-1.5 text-xs opacity-70 hover:opacity-100 cursor-pointer group w-full">
              <Wrench className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
              <span className="font-mono truncate" title={tc.name}>
                {truncateToolName(tc.name)}
              </span>
              <ChevronRight className="h-3 w-3 ml-auto shrink-0 transition-transform [[data-state=open]_&]:rotate-90" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="text-xs pl-5 mt-1 space-y-1.5">
                {tc.args && (
                  <div>
                    <span className="text-muted-foreground font-medium">参数</span>
                    <pre className="mt-0.5 p-2 rounded-lg bg-background/60 border text-[11px] leading-relaxed overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
                      {formatJsonDisplay(tc.args)}
                    </pre>
                  </div>
                )}
                {tc.result && (
                  <div>
                    <span className="text-muted-foreground font-medium">结果</span>
                    <pre className="mt-0.5 p-2 rounded-lg bg-background/60 border text-[11px] leading-relaxed overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
                      {formatJsonDisplay(tc.result)}
                    </pre>
                  </div>
                )}
                {!tc.args && !tc.result && (
                  <span className="text-muted-foreground italic">执行中...</span>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}

export interface ChatMessagesProps {
  messages: ChatMessage[];
  currentAgent: { id?: string; identity?: { name?: string; emoji?: string; avatar?: string; vibe?: string }; name?: string } | undefined;
  user: { id?: string; username?: string } | null;
  isStreaming: boolean;
  onSendTip: (text: string) => void;
  activeReminder: { id: string; title: string; text?: string } | null;
  onDismissReminder: () => void;
}

export default function ChatMessages({
  messages,
  currentAgent,
  user,
  isStreaming,
  onSendTip,
  activeReminder,
  onDismissReminder,
}: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const agentName = currentAgent?.identity?.name || currentAgent?.name || 'Octopus AI';

  // 自动滚动
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  return (
    <>
      {/* 消息列表 */}
      <ScrollArea className="flex-1">
        <div className="max-w-6xl mx-auto px-5 py-6">
          {messages.length === 0 ? (
            /* ── 欢迎页 ── */
            <div className="flex flex-col items-center justify-center min-h-[60vh]">
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-6">
                <OctopusIcon className="h-10 w-10 text-indigo-600" animated />
              </div>
              <h2 className="text-2xl font-semibold text-foreground mb-2">
                你好，{user?.username || '用户'}
              </h2>
              <p className="text-muted-foreground mb-8">
                我是 {agentName}，可以帮助你完成各种任务
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
                {TIPS.map((tip, i) => (
                  <button
                    key={i}
                    className="p-4 text-left text-sm rounded-xl border bg-card hover:bg-accent hover:border-accent-foreground/20 transition-colors cursor-pointer"
                    onClick={() => onSendTip(tip)}
                  >
                    <span className="text-foreground">{tip}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* ── 消息列表 ── */
            <div className="space-y-6">
              {messages.map((msg, i) => (
                <div key={`${msg.role}-${msg.ts || i}`} className={cn('flex gap-3', msg.role === 'user' ? 'flex-row-reverse' : '')}>
                  {/* Avatar */}
                  <Avatar className={cn('h-8 w-8 shrink-0', msg.role === 'user' ? 'bg-primary' : 'bg-muted')}>
                    {msg.role === 'user' && user?.id && (
                      <AvatarImage
                        src={`/api/auth/avatar/${user.id}`}
                        alt={user.username}
                      />
                    )}
                    {msg.role === 'assistant' && currentAgent?.id && (
                      <AvatarImage
                        src={currentAgent.identity?.avatar || `/api/agents/${currentAgent.id}/avatar`}
                        alt={agentName}
                      />
                    )}
                    <AvatarFallback className={cn(
                      'text-xs',
                      msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                    )}>
                      {msg.role === 'user' ? (
                        user?.username ? (
                          <span className="text-xs font-medium">{user.username.charAt(0).toUpperCase()}</span>
                        ) : (
                          <User className="h-4 w-4" />
                        )
                      ) : (
                        currentAgent?.identity?.emoji ? (
                          <span className="text-sm">{currentAgent.identity.emoji}</span>
                        ) : (
                          <OctopusIcon className="h-5 w-5 text-indigo-600" />
                        )
                      )}
                    </AvatarFallback>
                  </Avatar>

                  {/* Message bubble */}
                  <div className={cn('flex flex-col w-full max-w-[90%] lg:max-w-[88%] min-w-0', msg.role === 'user' ? 'items-end ml-auto' : 'items-start')}>
                    <span className="text-[17px] md:text-lg text-muted-foreground mb-1 font-medium">
                      {msg.role === 'user' ? (user?.username || '你') : agentName}
                    </span>
                    <div
                      className={cn(
                        'rounded-2xl px-5 py-3 text-[17px] md:text-lg leading-8 break-words w-full',
                        msg.role === 'user'
                          ? 'bg-primary text-primary-foreground rounded-tr-md'
                          : 'bg-muted text-foreground rounded-tl-md'
                      )}
                    >
                      {/* Thinking block */}
                      {msg.thinking && (
                        <Collapsible defaultOpen={!msg.content}>
                          <CollapsibleTrigger className="flex items-center gap-1.5 text-xs opacity-70 hover:opacity-100 mb-2 cursor-pointer">
                            <Brain className="h-3.5 w-3.5" />
                            <span>{msg.content ? '思考过程' : '正在思考...'}</span>
                            <ChevronRight className="h-3 w-3 transition-transform [[data-state=open]_&]:rotate-90" />
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className={cn(
                              'text-xs opacity-60 mb-2 pl-2 border-l-2',
                              msg.role === 'user' ? 'border-primary-foreground/30' : 'border-muted-foreground/30'
                            )}>
                              <MarkdownContent content={msg.thinking} />
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      )}

                      {/* Tool calls */}
                      {msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0 && (
                        <ToolCallCards toolCalls={msg.toolCalls} isStreaming={isStreaming && i === messages.length - 1} />
                      )}

                      {/* Message content */}
                      {msg.content ? (
                        msg.role === 'assistant' ? (
                          <MarkdownContent content={filterInternalTags(msg.content)} />
                        ) : (
                          filterInternalTags(msg.content).split('\n').map((line, j) => (
                            <p key={j} className="min-h-[1.2em]">{line || '\u00A0'}</p>
                          ))
                        )
                      ) : !msg.thinking ? (
                        <div className="flex items-center gap-1 py-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
                          <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
                          <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </ScrollArea>

      {/* ── 提醒浮层 ── */}
      {activeReminder && (
        <div className="fixed bottom-20 right-6 z-50 max-w-80 rounded-xl border bg-card shadow-lg p-4 space-y-2">
          <div className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm font-semibold text-foreground flex-1">{activeReminder.title}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={onDismissReminder}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          {activeReminder.text && (
            <p className="text-xs text-muted-foreground pl-6">{activeReminder.text}</p>
          )}
        </div>
      )}
    </>
  );
}

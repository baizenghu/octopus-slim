/**
 * 消息列表区域（欢迎页 TIPS + 消息气泡 + 提醒浮层）
 *
 * 从 ChatPage.tsx 提取，不含任何新业务逻辑。
 */
import { useRef, useEffect, useCallback, useMemo } from 'react';
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
} from 'lucide-react';
import { OctopusIcon } from '@/components/OctopusIcon';

// 过滤消息内容中不应显示给用户的内部标签
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

/** Markdown 渲染组件（assistant 消息专用） */
function MarkdownContent({ content }: { content: string }) {
  const components = useMemo(() => ({
    // 链接在新标签页打开
    a: ({ children, node, ...props }: React.ComponentPropsWithoutRef<'a'> & { node?: unknown }) => (
      <a target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
    ),
    code: CodeBlock,
  }), []);

  return (
    <div className="md-prose">
      <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {content}
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

/** 工具调用卡片列表 */
function ToolCallCards({ toolCalls }: { toolCalls: ToolCallInfo[] }) {
  if (toolCalls.length === 0) return null;
  return (
    <div className="space-y-1.5 mb-2">
      {toolCalls.map((tc, idx) => (
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
      ))}
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
                              {msg.thinking.split('\n').map((line, j) => (
                                <p key={j} className="min-h-[1.2em]">{line || '\u00A0'}</p>
                              ))}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      )}

                      {/* Tool calls */}
                      {msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0 && (
                        <ToolCallCards toolCalls={msg.toolCalls} />
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

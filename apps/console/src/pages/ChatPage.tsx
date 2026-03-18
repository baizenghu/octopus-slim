/**
 * AI 对话页面（shadcn/ui 重写版）
 *
 * 功能：
 * - 左侧会话列表侧边栏（创建/切换/删除/重命名）
 * - 流式对话
 * - 会话搜索
 * - 会话导出（Markdown/JSON）
 * - AI 自动生成标题
 * - 斜杠命令（/mcp, /skill）
 * - 附件上传
 * - 提醒轮询
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useAuthStore } from '../store';
import { adminApi, type SessionInfo, type AgentInfo, type McpServerInfo, type SkillInfo } from '../api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// shadcn/ui components
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
// Popover not used currently (slash menu uses plain div for simplicity)
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';

// lucide-react icons
import {
  Plus,
  Search,
  Send,
  Trash2,
  Pencil,
  Download,
  PanelLeftClose,
  PanelLeft,
  User,
  Paperclip,
  X,
  MoreHorizontal,
  MessageSquare,
  Sparkles,
  ChevronRight,
  Brain,
  FileText,
  Clock,
  BellRing,
  Square,
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

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  ts?: string;
}

interface Attachment {
  name: string;
  content: string;  // 文本内容或 base64
  type: string;     // MIME type
  size: number;
}

/** 将后端附件格式还原为前端显示格式 */
function restoreAttachmentDisplay(content: string): string {
  // 匹配: [用户上传了 N 个文件，已保存到工作空间]\n- files/xxx.pdf\n- files/yyy.docx\n\n实际消息
  const match = content.match(/^\[用户上传了 \d+ 个文件，已保存到工作空间\]\n((?:- .+\n?)+)\n?([\s\S]*)$/);
  if (!match) return content;
  const fileLines = match[1].trim().split('\n');
  const userMsg = (match[2] || '').trim();
  const attachmentTags = fileLines
    .map(line => {
      const filePath = line.replace(/^- /, '').trim();
      const fileName = filePath.split('/').pop() || filePath;
      return `[附件] ${fileName}`;
    })
    .join('\n');
  return userMsg ? `${attachmentTags}\n${userMsg}` : attachmentTags;
}

/** 清理会话标题中的附件前缀 */
function cleanSessionTitle(title: string): string {
  return title
    .replace(/^\[用户上传了 \d+ 个文件，已保存到工作空间\]\s*(?:- .+\s*)*/, '')
    .replace(/^\[附件\]\s*.+\n?/gm, '')
    .trim() || title;
}

/** 斜杠命令菜单项 */
interface SlashMenuItem {
  /** 点击后填入输入框的完整文本 */
  value: string;
  label: string;
  desc: string;
  /** 选中后是否还需要用户继续输入（如 /mcp 本身需要选子项） */
  isGroup?: boolean;
}

const TIPS = [
  '帮我分析今日的电力负荷数据趋势',
  '写一个 Python 脚本处理 CSV 文件',
  '解释一下 Transformer 架构的工作原理',
  '帮我起草一份技术评审报告',
];

export default function ChatPage() {
  const { user } = useAuthStore();
  // Agent
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [currentAgentId, setCurrentAgentId] = useState<string | undefined>(undefined);
  // Session 管理
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentSession, setCurrentSession] = useState<string>('');
  const [editingSession, setEditingSession] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  // 对话
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isDelegating, setIsDelegating] = useState(false);
  // 搜索
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  // 附件
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // UI
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const [slashItems, setSlashItems] = useState<SlashMenuItem[]>([]);
  // MCP / Skills 缓存（用于斜杠命令子项展示）
  const [mcpServers, setMcpServers] = useState<McpServerInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const delegationPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentSessionRef = useRef<string>('');
  const streamAbortRef = useRef<AbortController | null>(null);
  // 提醒
  const [activeReminder, setActiveReminder] = useState<{ id: string; title: string; text?: string } | null>(null);

  // 同步 currentSession 到 ref（供 setInterval 闭包读取最新值）
  useEffect(() => { currentSessionRef.current = currentSession; }, [currentSession]);
  // 组件卸载时清理委派轮询 timer
  useEffect(() => () => { if (delegationPollRef.current) clearInterval(delegationPollRef.current); }, []);

  // 当前 Agent 对象
  const currentAgent = agents.find(a => a.id === currentAgentId);
  const agentName = currentAgent?.identity?.name || currentAgent?.name || 'Octopus AI';

  // 启动时加载 MCP 和 Skills 列表（用于斜杠命令）
  useEffect(() => {
    adminApi.getMcpServers().then(res => setMcpServers(res.data || [])).catch(() => {});
    adminApi.getSkills().then(res => setSkills(res.data || [])).catch(() => {});
  }, []);

  // 加载 Agent 列表
  const loadAgents = useCallback(async () => {
    try {
      const res = await adminApi.getAgents();
      setAgents(res.agents);
      // 自动选择默认 agent
      if (!currentAgentId) {
        const defaultAgent = res.agents.find(a => a.isDefault);
        if (defaultAgent) setCurrentAgentId(defaultAgent.id);
      }
    } catch { /* ignore */ }
  }, [currentAgentId]);

  useEffect(() => { loadAgents(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 30 秒轮询提醒 ──
  useEffect(() => {
    const poll = async () => {
      try {
        const { reminders } = await adminApi.getDueReminders();
        if (reminders.length > 0) {
          const first = reminders[0];
          setActiveReminder({ id: first.id, title: first.title, text: first.text });
          // 同时尝试浏览器原生通知
          if ('Notification' in window) {
            if (Notification.permission === 'granted') {
              new Notification(first.title, { body: first.text, icon: '/favicon.ico' });
            } else if (Notification.permission !== 'denied') {
              Notification.requestPermission().then(perm => {
                if (perm === 'granted') {
                  new Notification(first.title, { body: first.text, icon: '/favicon.ico' });
                }
              });
            }
          }
          adminApi.dismissReminder(first.id).catch(() => {});
        }
      } catch { /* ignore */ }
    };
    poll(); // 立即执行一次
    const timer = setInterval(poll, 30_000);
    return () => clearInterval(timer);
  }, []);

  // 加载会话列表（防抖：500ms 内不重复请求）
  const lastLoadRef = useRef(0);
  const loadSessions = useCallback(async () => {
    // currentAgentId 尚未初始化时跳过无效请求
    if (!currentAgentId) return;
    const now = Date.now();
    if (now - lastLoadRef.current < 500) return;
    lastLoadRef.current = now;
    try {
      const res = await adminApi.getSessions(currentAgentId);
      setSessions(res.sessions.map(s => ({
        ...s,
        title: cleanSessionTitle(s.title),
      })));
    } catch { /* ignore */ }
  }, [currentAgentId]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // 加载会话历史
  const loadHistory = useCallback(async (sessionId: string) => {
    if (!sessionId) return;
    try {
      const res = await adminApi.getChatHistory(sessionId, currentAgentId);
      setMessages(res.messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.role === 'user' ? restoreAttachmentDisplay(m.content) : m.content,
        thinking: m.thinking,
        ts: m.ts,
      })));
    } catch { setMessages([]); }
  }, [currentAgentId]);

  // 切换 Agent（输出中禁止切换）
  const switchAgent = useCallback((agentId: string) => {
    if (isStreaming) return;
    setCurrentAgentId(agentId);
    setCurrentSession('');
    setMessages([]);
  }, [isStreaming]);

  // 切换会话（输出中禁止切换）
  const switchSession = useCallback((sessionId: string) => {
    if (isStreaming) return;
    setCurrentSession(sessionId);
    loadHistory(sessionId);
    setShowSearch(false);
  }, [loadHistory, isStreaming]);

  // 创建新会话
  const createSession = () => {
    const id = `chat-${Date.now()}`;
    setCurrentSession(id);
    setMessages([]);
    setShowSearch(false);
  };

  // 删除会话
  const handleDeleteSession = async (sid: string) => {
    if (!confirm('确定删除此会话？')) return;
    try {
      await adminApi.deleteSession(sid, currentAgentId);
      if (currentSession === sid) {
        setCurrentSession('');
        setMessages([]);
      }
      loadSessions();
      toast.success('会话已删除');
    } catch { toast.error('删除失败'); }
  };

  // 重命名
  const startRename = (sid: string, title: string) => {
    setEditingSession(sid);
    setEditTitle(title);
  };

  const submitRename = async (sid: string) => {
    if (editTitle.trim()) {
      try {
        await adminApi.renameSession(sid, editTitle.trim(), currentAgentId);
        loadSessions();
      } catch { /* ignore */ }
    }
    setEditingSession(null);
  };

  // AI 生成标题
  const handleGenerateTitle = async (sid: string) => {
    try {
      await adminApi.generateTitle(sid, currentAgentId);
      loadSessions();
      toast.success('标题已生成');
    } catch { toast.error('生成失败'); }
  };

  // 导出
  const handleExport = async (sid: string, format: 'md' | 'json') => {
    try {
      const blob = await adminApi.exportSession(sid, format, currentAgentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sid}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('导出成功');
    } catch { toast.error('导出失败'); }
  };

  // 搜索
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    try {
      const res = await adminApi.searchMessages(searchQuery, 50, currentAgentId);
      setSearchResults(res.results);
    } catch { /* ignore */ }
  };

  // 自动滚动
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // 自动调整输入框高度
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = '52px';
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    }
  }, [input]);

  // 按当前 agent 的 filter 过滤可用的 MCP/Skills
  const filteredMcpServers = useMemo(() => {
    const filter = currentAgent?.mcpFilter as string[] | null | undefined;
    if (filter == null) return mcpServers;
    return mcpServers.filter(s => filter.includes(s.id) || filter.includes(s.name));
  }, [mcpServers, currentAgent]);

  const filteredSkills = useMemo(() => {
    const active = skills.filter(s => s.status === 'active' || s.status === 'approved');
    const filter = currentAgent?.skillsFilter as string[] | null | undefined;
    if (filter == null) return active;
    return active.filter(s => filter.includes(s.id) || filter.includes(s.name));
  }, [skills, currentAgent]);

  // 斜杠命令菜单：根据输入动态生成菜单项（按 agent filter 过滤）
  useEffect(() => {
    const trimmed = input.trimStart();

    // 输入 "/mcp " 后展示当前 agent 可用的 MCP server 子项
    if (/^\/mcp\s/i.test(trimmed)) {
      const arg = trimmed.slice(5).toLowerCase();
      const items: SlashMenuItem[] = filteredMcpServers
        .filter(s => !arg || s.id.toLowerCase().includes(arg) || s.name.toLowerCase().includes(arg))
        .map(s => ({
          value: `/mcp ${s.name}`,
          label: s.name,
          desc: `${s.scope} · ${s.description || s.id}`,
        }));
      setSlashItems(items);
      setSlashOpen(items.length > 0);
      setSlashIdx(0);
      return;
    }

    // 输入 "/skill " 后展示当前 agent 可用的 Skill 子项
    if (/^\/skill\s/i.test(trimmed)) {
      const arg = trimmed.slice(7).toLowerCase();
      const items: SlashMenuItem[] = filteredSkills
        .filter(s => !arg || s.id.toLowerCase().includes(arg) || s.name.toLowerCase().includes(arg))
        .map(s => ({
          value: `/skill ${s.name}`,
          label: s.name,
          desc: `${s.scope} · ${s.description || s.id}`,
        }));
      setSlashItems(items);
      setSlashOpen(items.length > 0);
      setSlashIdx(0);
      return;
    }

    // 输入 "/" 开头（不含空格）展示顶层命令
    if (trimmed.startsWith('/') && !trimmed.includes(' ')) {
      const query = trimmed.toLowerCase();
      const topItems: SlashMenuItem[] = [
        { value: '/mcp',   label: '/mcp',   desc: `选择 MCP 工具（${filteredMcpServers.length} 个可用）`, isGroup: true },
        { value: '/skill', label: '/skill', desc: `选择 Skill（${filteredSkills.length} 个可用）`, isGroup: true },
        { value: '/lesson', label: '/lesson', desc: '将经验教训存入记忆系统' },
      ].filter(c => c.value.startsWith(query));
      setSlashItems(topItems);
      setSlashOpen(topItems.length > 0);
      setSlashIdx(0);
      return;
    }

    setSlashOpen(false);
  }, [input, filteredMcpServers, filteredSkills]);

  // 处理附件选择
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      const isText = file.type.startsWith('text/') ||
        /\.(txt|md|csv|json|xml|yaml|yml|js|ts|tsx|jsx|py|java|c|cpp|h|hpp|go|rs|sh|bash|sql|html|css|log|ini|cfg|conf|toml)$/i.test(file.name);

      if (isText) {
        reader.onload = () => {
          setAttachments((prev) => [...prev, {
            name: file.name,
            content: reader.result as string,
            type: file.type || 'text/plain',
            size: file.size,
          }]);
        };
        reader.readAsText(file);
      } else {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1] || '';
          setAttachments((prev) => [...prev, {
            name: file.name,
            content: base64,
            type: file.type || 'application/octet-stream',
            size: file.size,
          }]);
        };
        reader.readAsDataURL(file);
      }
    });

    // 清空 input 以便再次选择同一文件
    e.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // 发送消息
  const sendMessage = async (text?: string) => {
    const msg = text || input.trim();
    const currentAttachments = [...attachments];
    if ((!msg && currentAttachments.length === 0) || isStreaming) return;

    // 自动创建会话
    let sid = currentSession;
    const isNewSession = !sid; // 标记是否为新建会话（用于自动生成标题）
    if (!sid) {
      sid = `chat-${Date.now()}`;
      setCurrentSession(sid);
    }

    // 构建显示消息（含附件标记）
    const displayMsg = currentAttachments.length > 0
      ? `${currentAttachments.map(a => `[附件] ${a.name}`).join('\n')}\n${msg}`
      : msg;

    setInput('');
    setAttachments([]);
    setMessages((prev) => [...prev, { role: 'user', content: displayMsg }]);
    setIsStreaming(true);
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    const token = localStorage.getItem('admin_token');

    // 构建请求体（含附件）
    const requestBody: any = { message: msg || '', sessionId: sid, agentId: currentAgentId };
    if (currentAttachments.length > 0) {
      requestBody.attachments = currentAttachments.map(a => ({
        name: a.name,
        content: a.content,
        type: a.type,
      }));
    }

    const abortController = new AbortController();
    streamAbortRef.current = abortController;

    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let delegated = false;
      let sseBuffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const parts = sseBuffer.split('\n');
        sseBuffer = parts.pop() || ''; // 最后一个不完整的片段留到下次
        for (const line of parts) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.delegated) delegated = true;
              // 后端返回完整 sessionKey，更新本地 sid 和 currentSession
              if (parsed.sessionId && parsed.done) {
                sid = parsed.sessionId;
                setCurrentSession(parsed.sessionId);
              }
              const content = parsed.choices?.[0]?.delta?.content || parsed.content || '';
              const thinking = parsed.thinking || '';
              if (content || thinking) {
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === 'assistant') {
                    updated[updated.length - 1] = {
                      ...last,
                      content: last.content + content,
                      ...(thinking ? { thinking: (last.thinking || '') + thinking } : {}),
                    };
                  }
                  return updated;
                });
              }
            } catch { /* ignore */ }
          }
        }
      }

      // 如果有委派操作，轮询等待 subagent 结果
      // 策略：持续轮询，每次有新内容就更新 UI，连续 2 次无变化后停止
      if (delegated && sid) {
        // 清理上一次未完成的轮询
        if (delegationPollRef.current) clearInterval(delegationPollRef.current);

        // 添加等待提示
        setMessages(prev => [...prev, {
          role: 'assistant' as const,
          content: '\u23f3 正在等待专业 Agent 执行，请稍候...',
        }]);

        const pollInterval = 5000;
        const maxPolls = 36; // 最多轮询 3 分钟
        let polls = 0;
        let lastCount = -1;     // 上一次 status 返回的 messageCount
        let baselineCount = -1; // 委派开始时的 messageCount（用于判断是否有新内容）
        let stableCount = 0;    // 连续无变化次数
        let hasGrown = false;   // messageCount 是否比 baseline 增长过
        const delegationSid = sid;

        setIsDelegating(true);
        console.log('[chat] delegation poll: started, sid:', delegationSid);
        const pollTimer = setInterval(async () => {
          polls++;
          if (currentSessionRef.current !== delegationSid) {
            console.log('[chat] session changed, stopping delegation poll');
            clearInterval(pollTimer);
            delegationPollRef.current = null;
            setIsDelegating(false);
            return;
          }
          try {
            const status = await adminApi.getSessionStatus(delegationSid, currentAgentId);

            // 首次轮询记录 baseline
            if (baselineCount === -1) baselineCount = status.messageCount;

            if (status.messageCount === lastCount) {
              stableCount++;
              // 只有 messageCount 真正增长过（subagent 返回了内容），才判定稳定停止
              if (stableCount >= 2 && hasGrown) {
                console.log('[chat] delegation result stabilized after growth, done.');
                clearInterval(pollTimer);
                delegationPollRef.current = null;
                setIsDelegating(false);
                return;
              }
            } else {
              // messageCount 有变化 → 拉全量历史
              if (status.messageCount > baselineCount) hasGrown = true;
              lastCount = status.messageCount;
              stableCount = 0;
              const histRes = await adminApi.getChatHistory(delegationSid, currentAgentId);
              const allMsgs: ChatMessage[] = (histRes.messages || []).map((m: any) => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
                thinking: m.thinking,
                ts: m.ts,
              }));
              setMessages(allMsgs);
              console.log(`[chat] delegation poll: messageCount=${status.messageCount}, baseline=${baselineCount}, hasGrown=${hasGrown}`);
            }

            // 已完成 + 已增长 + 稳定 → 停止
            if (status.completed && hasGrown && stableCount >= 1) {
              console.log('[chat] delegation completed by status check.');
              clearInterval(pollTimer);
              delegationPollRef.current = null;
              setIsDelegating(false);
              return;
            }
          } catch (e) { console.log(`[chat] poll #${polls} error:`, e); }
          if (polls >= maxPolls) {
            // 超时：如果已有内容则保留，否则移除等待提示
            if (lastCount <= 0) {
              setMessages(prev => prev.filter(m => !m.content?.includes('\u23f3')));
            }
            console.log('[chat] delegation poll timeout');
            clearInterval(pollTimer);
            delegationPollRef.current = null;
            setIsDelegating(false);
          }
        }, pollInterval);
        delegationPollRef.current = pollTimer;
      }

      // 发送完成后稍作延迟（等待 native gateway 持久化会话），再刷新列表
      // 标题由后端 autoGenerateTitle 自动生成，前端不再重复调用
      setTimeout(() => loadSessions(), 800);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // 用户主动终止，不显示错误
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === 'assistant' && !last.content) {
            updated.pop(); // 移除空的 assistant 消息
          }
          return updated;
        });
      } else {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: `错误：${err.message}` };
          }
          return updated;
        });
      }
    } finally {
      streamAbortRef.current = null;
      setIsStreaming(false);
    }
  };

  /** 终止正在进行的对话（包括 SSE 流和子 agent 委派） */
  const abortChat = () => {
    // 1. 中断前端 SSE 流（触发后端 res.on('close') → chatAbort）
    streamAbortRef.current?.abort();

    // 2. 显式调用后端 abort API（双保险，对 SSE 流和子 agent 都有效）
    if (currentSession) {
      const token = localStorage.getItem('admin_token');
      fetch(`/api/chat/sessions/${encodeURIComponent(currentSession)}/abort${currentAgentId ? `?agentId=${encodeURIComponent(currentAgentId)}` : ''}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).catch(() => {});
    }

    // 3. 清理委派轮询
    if (delegationPollRef.current) {
      clearInterval(delegationPollRef.current);
      delegationPollRef.current = null;
    }
    setIsDelegating(false);

    // 4. 移除等待提示
    setMessages(prev => prev.filter(m => !m.content?.includes('\u23f3')));
  };

  /** 选中斜杠菜单项 */
  const selectSlashItem = useCallback((item: SlashMenuItem) => {
    if (item.isGroup) {
      // 展开子项：填入命令 + 空格，触发子项列表
      setInput(item.value + ' ');
      setSlashOpen(false);
      textareaRef.current?.focus();
    } else {
      // 具体命令：填入输入框，用户可以追加内容后一起发送
      setSlashOpen(false);
      setInput(item.value + ' ');
      textareaRef.current?.focus();
    }
  }, [sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 斜杠菜单打开时拦截方向键和 Tab/Enter
    if (slashOpen && slashItems.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIdx(prev => (prev - 1 + slashItems.length) % slashItems.length);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIdx(prev => (prev + 1) % slashItems.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        selectSlashItem(slashItems[slashIdx]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full bg-background">
        {/* ─── 侧边栏 ─── */}
        <div
          className={cn(
            'flex flex-col border-r bg-slate-50 transition-all duration-300',
            sidebarCollapsed ? 'w-0 overflow-hidden' : 'w-72'
          )}
        >
          {/* Agent 选择器 */}
          <div className="p-3 pb-0">
            {agents.length > 0 && (
              <Select
                value={currentAgentId || ''}
                onValueChange={(val) => switchAgent(val)}
                disabled={isStreaming}
              >
                <SelectTrigger className="w-full bg-white" disabled={isStreaming}>
                  <SelectValue placeholder="选择 Agent" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map(a => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="flex items-center gap-2">
                        <span>{a.identity?.emoji || '🤖'}</span>
                        <span>{a.identity?.name || a.name}</span>
                        {a.isDefault && (
                          <Badge variant="secondary" className="ml-1 text-[10px] px-1 py-0">默认</Badge>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* 新建对话 + 搜索 */}
          <div className="flex items-center gap-2 p-3">
            <Button
              variant="outline"
              className="flex-1 justify-start gap-2"
              onClick={createSession}
            >
              <Plus className="h-4 w-4" />
              新对话
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled
                  title="功能开发中"
                >
                  <Search className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>功能开发中</TooltipContent>
            </Tooltip>
          </div>

          {/* 搜索面板 */}
          {showSearch && (
            <div className="px-3 pb-2 space-y-2">
              <div className="flex gap-1">
                <Input
                  placeholder="功能开发中"
                  disabled
                  className="h-8 text-sm"
                />
                <Button size="sm" variant="secondary" onClick={handleSearch} className="h-8 px-2">
                  <Search className="h-3.5 w-3.5" />
                </Button>
              </div>
              {searchResults.length > 0 && (
                <ScrollArea className="max-h-48">
                  <div className="space-y-1">
                    {searchResults.map((r, i) => (
                      <div
                        key={i}
                        className="p-2 text-xs rounded-md hover:bg-accent cursor-pointer"
                        onClick={() => switchSession(r.sessionId)}
                      >
                        <div className="font-medium text-muted-foreground truncate">{r.sessionId}</div>
                        <div className="text-foreground truncate">{r.snippet}</div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
              <Separator />
            </div>
          )}

          {/* 会话列表 */}
          <ScrollArea className="flex-1 [&_[data-radix-scroll-area-viewport]>div]:!block">
            <div className="p-2 space-y-0.5">
              {sessions.map((s) => (
                <div
                  key={s.sessionId}
                  className={cn(
                    'group flex items-center gap-2 rounded-lg px-3 py-2.5 cursor-pointer transition-colors overflow-hidden w-full',
                    currentSession === s.sessionId
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/50'
                  )}
                  onClick={() => switchSession(s.sessionId)}
                >
                  {editingSession === s.sessionId ? (
                    <Input
                      className="h-7 text-sm"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={() => submitRename(s.sessionId)}
                      onKeyDown={(e) => e.key === 'Enter' && submitRename(s.sessionId)}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate pr-1">{s.title}</div>
                        <div className="text-xs text-muted-foreground truncate pr-1">
                          {s.messageCount}条 · {formatTime(s.lastActiveAt)}
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                              "h-6 w-6 shrink-0 gap-0 p-0",
                              currentSession === s.sessionId
                                ? "opacity-70 hover:opacity-100"
                                : "opacity-0 group-hover:opacity-100"
                            )}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem onClick={() => startRename(s.sessionId, s.title)}>
                            <Pencil className="mr-2 h-3.5 w-3.5" />
                            重命名
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleGenerateTitle(s.sessionId)}>
                            <Sparkles className="mr-2 h-3.5 w-3.5" />
                            AI 生成标题
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem disabled title="功能开发中">
                            <FileText className="mr-2 h-3.5 w-3.5" />
                            导出 Markdown
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled title="功能开发中">
                            <Download className="mr-2 h-3.5 w-3.5" />
                            导出 JSON
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => handleDeleteSession(s.sessionId)}
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </div>
              ))}
              {sessions.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <MessageSquare className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">暂无会话</p>
                  <p className="text-xs">点击上方按钮创建</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* 侧边栏折叠按钮 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 h-8 w-6 rounded-l-none rounded-r-md border border-l-0 bg-background hover:bg-accent"
              style={{ left: sidebarCollapsed ? 0 : 'calc(18rem - 1px)' }}
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            >
              {sidebarCollapsed ? <PanelLeft className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}</TooltipContent>
        </Tooltip>

        {/* ─── 主聊天区 ─── */}
        <div className="flex-1 flex flex-col min-w-0 relative">
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
                        onClick={() => sendMessage(tip)}
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
                    <div key={i} className={cn('flex gap-3', msg.role === 'user' ? 'flex-row-reverse' : '')}>
                      {/* Avatar */}
                      <Avatar className={cn('h-8 w-8 shrink-0', msg.role === 'user' ? 'bg-primary' : 'bg-muted')}>
                        <AvatarFallback className={cn(
                          'text-xs',
                          msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                        )}>
                          {msg.role === 'user' ? (
                            <User className="h-4 w-4" />
                          ) : (
                            <OctopusIcon className="h-5 w-5 text-indigo-600" />
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

                          {/* Message content */}
                          {msg.content ? (
                            filterInternalTags(msg.content).split('\n').map((line, j) => (
                              <p key={j} className="min-h-[1.2em]">{line || '\u00A0'}</p>
                            ))
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
                  onClick={() => setActiveReminder(null)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
              {activeReminder.text && (
                <p className="text-xs text-muted-foreground pl-6">{activeReminder.text}</p>
              )}
            </div>
          )}

          {/* ── 输入区域 ── */}
          <div className="border-t bg-background p-4">
            <div className="max-w-6xl mx-auto space-y-2 px-1">
              {/* 附件预览 */}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachments.map((att, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted text-sm">
                      <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="truncate max-w-[150px]">{att.name}</span>
                      <span className="text-xs text-muted-foreground">{formatFileSize(att.size)}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 hover:bg-destructive/10"
                        onClick={() => removeAttachment(i)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {/* 输入框 + 按钮 */}
              <div className="relative">
                {/* 斜杠命令弹出菜单 */}
                {slashOpen && slashItems.length > 0 && (
                  <div className="absolute bottom-full left-0 w-full mb-2 rounded-lg border bg-popover p-1 shadow-md z-50">
                    {slashItems.map((item, i) => (
                      <div
                        key={item.value}
                        className={cn(
                          'flex items-center justify-between px-3 py-2 rounded-md cursor-pointer text-sm',
                          i === slashIdx ? 'bg-accent' : 'hover:bg-accent/50'
                        )}
                        onMouseEnter={() => setSlashIdx(i)}
                        onMouseDown={(e) => { e.preventDefault(); selectSlashItem(item); }}
                      >
                        <span className="font-medium">
                          {item.label}
                          {item.isGroup && <ChevronRight className="inline h-3 w-3 ml-1" />}
                        </span>
                        <span className="text-xs text-muted-foreground ml-2 truncate">{item.desc}</span>
                      </div>
                    ))}
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <div className="flex items-end gap-2 rounded-xl border bg-card px-3 py-2 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isStreaming || isDelegating}
                      >
                        <Paperclip className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>添加附件</TooltipContent>
                  </Tooltip>

                  <Textarea
                    ref={textareaRef}
                    placeholder="输入消息，或输入 / 使用命令... (Enter 发送, Shift+Enter 换行)"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    disabled={isStreaming || isDelegating}
                    className="min-h-[36px] max-h-[200px] resize-none border-0 shadow-none focus-visible:ring-0 p-0 text-sm"
                  />

                  {(isStreaming || isDelegating) ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="destructive"
                          className="h-8 w-8 shrink-0 rounded-lg"
                          onClick={() => abortChat()}
                        >
                          <Square className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>终止对话</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Button
                      size="icon"
                      className="h-8 w-8 shrink-0 rounded-lg"
                      onClick={() => sendMessage()}
                      disabled={!input.trim() && attachments.length === 0}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5 text-center">
                  AI 可能会犯错，请核实重要信息
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

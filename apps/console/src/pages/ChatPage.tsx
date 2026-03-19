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
import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store';
import { adminApi, type SessionInfo, type AgentInfo, type McpServerInfo, type SkillInfo } from '../api';
import { toast } from 'sonner';

// shadcn/ui components
import {
  TooltipProvider,
} from '@/components/ui/tooltip';

// 子组件
import SessionSidebar from './SessionSidebar';
import ChatMessages from './ChatMessages';
import ChatInput from './ChatInput';

// 共享类型
import type { ToolCallInfo, ChatMessage, Attachment } from '../types/chat';

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

export default function ChatPage() {
  const { user } = useAuthStore();
  // Agent
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [currentAgentId, setCurrentAgentId] = useState<string | undefined>(undefined);
  // Session 管理
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentSession, setCurrentSession] = useState<string>('');
  // 对话
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isDelegating, setIsDelegating] = useState(false);
  // 搜索
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  // 附件
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // UI
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // MCP / Skills 缓存（用于斜杠命令子项展示）
  const [mcpServers, setMcpServers] = useState<McpServerInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
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
  const handleRenameSession = async (sid: string, title: string) => {
    try {
      await adminApi.renameSession(sid, title, currentAgentId);
      loadSessions();
    } catch { /* ignore */ }
  };

  // 搜索
  const handleSearch = async (query: string) => {
    if (!query.trim()) return;
    try {
      const res = await adminApi.searchMessages(query, 50, currentAgentId);
      setSearchResults(res.results);
    } catch { /* ignore */ }
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
    setMessages((prev) => [...prev, { role: 'user', content: displayMsg, ts: new Date().toISOString() }]);
    setIsStreaming(true);
    setMessages((prev) => [...prev, { role: 'assistant', content: '', ts: new Date().toISOString() }]);

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
              // 处理工具调用事件（后端已合并 start/update/result，每个 toolCallId 只发一次）
              if (parsed.toolCall && Array.isArray(parsed.tools)) {
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last.role === 'assistant') {
                    const toolName = parsed.tools[0] || 'unknown';
                    const newCall: ToolCallInfo = {
                      name: toolName,
                      toolCallId: parsed.toolCallId,
                      args: parsed.toolArgs,
                      result: parsed.toolResult,
                    };
                    // 如果有 toolCallId，检查是否已存在（防止重复）
                    const existingCalls = last.toolCalls || [];
                    if (parsed.toolCallId) {
                      const existingIdx = existingCalls.findIndex(tc => tc.toolCallId === parsed.toolCallId);
                      if (existingIdx >= 0) {
                        // 更新已有条目
                        const updatedCalls = [...existingCalls];
                        updatedCalls[existingIdx] = newCall;
                        updated[updated.length - 1] = { ...last, toolCalls: updatedCalls };
                        return updated;
                      }
                    }
                    updated[updated.length - 1] = {
                      ...last,
                      toolCalls: [...existingCalls, newCall],
                    };
                  }
                  return updated;
                });
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

      // 发送完成后刷新列表（标题由后端 autoGenerateTitle 异步生成）
      // 首次刷新：800ms 后获取 session 列表（可能还没有标题）
      // 二次刷新：3s 后再次获取（确保 autoGenerateTitle 完成，特别是 skill 执行耗时场景）
      setTimeout(() => loadSessions(), 800);
      setTimeout(() => loadSessions(), 3000);
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

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full bg-background">
        {/* ─── 侧边栏 ─── */}
        <SessionSidebar
          agents={agents}
          currentAgentId={currentAgentId}
          onAgentChange={switchAgent}
          sessions={sessions}
          currentSession={currentSession}
          onSessionSwitch={switchSession}
          onNewSession={createSession}
          onDeleteSession={handleDeleteSession}
          onRenameSession={handleRenameSession}
          isStreaming={isStreaming}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          searchResults={searchResults}
          showSearch={showSearch}
          onSearch={handleSearch}
          onSearchResultClick={switchSession}
        />

        {/* ─── 主聊天区 ─── */}
        <div className="flex-1 flex flex-col min-w-0 relative">
          {/* 消息列表 + 提醒浮层 */}
          <ChatMessages
            messages={messages}
            currentAgent={currentAgent}
            user={user}
            isStreaming={isStreaming}
            onSendTip={sendMessage}
            activeReminder={activeReminder}
            onDismissReminder={() => setActiveReminder(null)}
          />

          {/* ── 输入区域 ── */}
          <ChatInput
            input={input}
            onInputChange={setInput}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            onSend={sendMessage}
            onAbort={abortChat}
            isStreaming={isStreaming}
            isDelegating={isDelegating}
            currentAgent={currentAgent}
            mcpServers={mcpServers}
            skills={skills}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

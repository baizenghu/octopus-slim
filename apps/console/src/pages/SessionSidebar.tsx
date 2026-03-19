/**
 * 左侧会话列表侧边栏（Agent 选择器 + 会话列表 + 搜索 + 重命名）
 *
 * 从 ChatPage.tsx 提取，不含任何新业务逻辑。
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { SessionInfo, AgentInfo } from '../api';

// shadcn/ui components
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';

// lucide-react icons
import {
  Plus,
  Search,
  Trash2,
  Pencil,
  PanelLeftClose,
  PanelLeft,
  MoreHorizontal,
  MessageSquare,
} from 'lucide-react';

export interface SessionSidebarProps {
  agents: AgentInfo[];
  currentAgentId: string | undefined;
  onAgentChange: (agentId: string) => void;
  sessions: SessionInfo[];
  currentSession: string;
  onSessionSwitch: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => Promise<void>;
  onRenameSession: (sessionId: string, title: string) => Promise<void>;
  isStreaming: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  // 搜索相关
  searchResults: any[];
  showSearch: boolean;
  onSearch: (query: string) => void;
  onSearchResultClick: (sessionId: string) => void;
}

export default function SessionSidebar({
  agents,
  currentAgentId,
  onAgentChange,
  sessions,
  currentSession,
  onSessionSwitch,
  onNewSession,
  onDeleteSession,
  onRenameSession,
  isStreaming,
  collapsed,
  onToggleCollapse,
  searchResults,
  showSearch,
  onSearch,
  onSearchResultClick,
}: SessionSidebarProps) {
  // 内部状态：编辑中的会话标题
  const [editingSession, setEditingSession] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  // 内部状态：搜索
  const [searchQuery, setSearchQuery] = useState('');

  const startRename = (sid: string, title: string) => {
    setEditingSession(sid);
    setEditTitle(title);
  };

  const submitRename = async (sid: string) => {
    if (editTitle.trim()) {
      await onRenameSession(sid, editTitle.trim());
    }
    setEditingSession(null);
  };

  const handleSearch = () => {
    if (!searchQuery.trim()) return;
    onSearch(searchQuery);
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
    <>
      {/* ─── 侧边栏 ─── */}
      <div
        className={cn(
          'flex flex-col border-r bg-slate-50 transition-all duration-300',
          collapsed ? 'w-0 overflow-hidden' : 'w-72'
        )}
      >
        {/* Agent 选择器 */}
        <div className="p-3 pb-0">
          {agents.length > 0 && (
            <Select
              value={currentAgentId || ''}
              onValueChange={(val) => onAgentChange(val)}
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
            onClick={onNewSession}
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
                      onClick={() => onSearchResultClick(r.sessionId)}
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
                onClick={() => onSessionSwitch(s.sessionId)}
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
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => onDeleteSession(s.sessionId)}
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
            style={{ left: collapsed ? 0 : 'calc(18rem - 1px)' }}
            onClick={onToggleCollapse}
          >
            {collapsed ? <PanelLeft className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{collapsed ? '展开侧边栏' : '折叠侧边栏'}</TooltipContent>
      </Tooltip>
    </>
  );
}

/**
 * 底部输入区域（输入框 + 附件 + 斜杠命令菜单）
 *
 * 从 ChatPage.tsx 提取，不含任何新业务逻辑。
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { AgentInfo, McpServerInfo, SkillInfo } from '../api';

// shadcn/ui components
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// lucide-react icons
import {
  Send,
  Paperclip,
  X,
  ChevronRight,
  Square,
} from 'lucide-react';

interface Attachment {
  name: string;
  content: string;  // 文本内容或 base64
  type: string;     // MIME type
  size: number;
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

export interface ChatInputProps {
  input: string;
  onInputChange: (value: string) => void;
  attachments: Attachment[];
  onAttachmentsChange: (attachments: Attachment[]) => void;
  onSend: (text?: string) => void;
  onAbort: () => void;
  isStreaming: boolean;
  isDelegating: boolean;
  currentAgent: AgentInfo | undefined;
  mcpServers: McpServerInfo[];
  skills: SkillInfo[];
}

export default function ChatInput({
  input,
  onInputChange,
  attachments,
  onAttachmentsChange,
  onSend,
  onAbort,
  isStreaming,
  isDelegating,
  currentAgent,
  mcpServers,
  skills,
}: ChatInputProps) {
  // 斜杠菜单状态
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const [slashItems, setSlashItems] = useState<SlashMenuItem[]>([]);

  // refs
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // 自动调整输入框高度
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = '52px';
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    }
  }, [input]);

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
          onAttachmentsChange([...attachments, {
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
          onAttachmentsChange([...attachments, {
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
    onAttachmentsChange(attachments.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  /** 选中斜杠菜单项 */
  const selectSlashItem = useCallback((item: SlashMenuItem) => {
    if (item.isGroup) {
      // 展开子项：填入命令 + 空格，触发子项列表
      onInputChange(item.value + ' ');
      setSlashOpen(false);
      textareaRef.current?.focus();
    } else {
      // 具体命令：填入输入框，用户可以追加内容后一起发送
      setSlashOpen(false);
      onInputChange(item.value + ' ');
      textareaRef.current?.focus();
    }
  }, [onInputChange]);

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
      onSend();
    }
  };

  return (
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
              onChange={(e) => onInputChange(e.target.value)}
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
                    onClick={() => onAbort()}
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
                onClick={() => onSend()}
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
  );
}

/**
 * Agent 管理页面（个人级）
 *
 * 功能：
 * - 查看/创建/编辑/删除个人 Agent
 * - 设置默认 Agent
 * - 配置系统提示、模型、工具过滤、Skills 过滤、MCP 过滤
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Star,
  Bot,
  Settings,
  Zap,
  Database,
  Loader2,
  ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { adminApi, type AgentInfo, type SkillInfo, type McpServerInfo } from '../api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';

/** 内置 Emoji 快捷选择 */
const EMOJI_OPTIONS = [
  '\u{1F916}', '\u{1F9E0}', '\u{1F4CA}', '\u{1F4BC}', '\u{1F4DD}', '\u{1F50D}', '\u{1F4A1}', '\u{1F3AF}',
  '\u{1F6E0}\u{FE0F}', '\u{1F4C8}', '\u{1F3D7}\u{FE0F}', '\u{1F3A8}', '\u{1F4DA}', '\u{1F52C}', '\u{1F4BB}', '\u{26A1}',
  '\u{1F310}', '\u{1F4EE}', '\u{1F5C2}\u{FE0F}', '\u{1F9EE}', '\u{1F510}', '\u{1F4CB}', '\u{1F91D}', '\u{1F393}',
  '\u{1F3E5}', '\u{2696}\u{FE0F}', '\u{1F680}', '\u{1F9EA}', '\u{1F4F1}', '\u{1F5C3}\u{FE0F}', '\u{270D}\u{FE0F}', '\u{1F527}',
];

const WORKSPACE_TOOLS = [
  { value: 'list_files', label: 'list_files (列出文件)' },
  { value: 'read_file', label: 'read_file (读取文件)' },
  { value: 'write_file', label: 'write_file (写入文件)' },
  { value: 'execute_command', label: 'execute_command (执行命令)' },
  { value: 'search_files', label: 'search_files (搜索文件)' },
];

interface AgentsPageProps {
  onConfigAgent?: (agent: AgentInfo) => void;
}

/** 多选复选框列表组件 */
function MultiCheckboxSelect({
  options,
  selected,
  onChange,
  emptyText,
}: {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (vals: string[]) => void;
  emptyText?: string;
}) {
  if (options.length === 0) {
    return <p className="text-sm text-muted-foreground py-2">{emptyText || '暂无可用选项'}</p>;
  }
  return (
    <div className="border rounded-md p-2 space-y-1 max-h-[200px] overflow-y-auto overflow-x-hidden">
      {options.map((opt) => (
        <label key={opt.value} className="flex items-start gap-2 py-1 px-1 rounded hover:bg-accent cursor-pointer text-sm min-w-0">
          <Checkbox
            className="mt-0.5 shrink-0"
            checked={selected.includes(opt.value)}
            onCheckedChange={(checked) => {
              if (checked) {
                onChange([...selected, opt.value]);
              } else {
                onChange(selected.filter((v) => v !== opt.value));
              }
            }}
          />
          <span className="break-words min-w-0">{opt.label}</span>
        </label>
      ))}
    </div>
  );
}

export default function AgentsPage({ onConfigAgent }: AgentsPageProps) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 表单字段
  const [formName, setFormName] = useState('');
  const [formIdentityName, setFormIdentityName] = useState('');
  const [formIdentityEmoji, setFormIdentityEmoji] = useState('');
  const [formModel, setFormModel] = useState('');
  const [availableModels, setAvailableModels] = useState<{ id: string; provider?: string }[]>([]);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [formEnabled, setFormEnabled] = useState(true);
  const [formToolsFilterEnabled, setFormToolsFilterEnabled] = useState(true);
  const [formToolsFilter, setFormToolsFilter] = useState<string[]>([]);
  const [formSkillsFilterEnabled, setFormSkillsFilterEnabled] = useState(true);
  const [formSkillsFilter, setFormSkillsFilter] = useState<string[]>([]);
  const [formMcpFilterEnabled, setFormMcpFilterEnabled] = useState(true);
  const [formMcpFilter, setFormMcpFilter] = useState<string[]>([]);
  const [formConnFilterEnabled, setFormConnFilterEnabled] = useState(false);
  const [formAllowedConnections, setFormAllowedConnections] = useState<string[]>([]);

  // 可用的 Skills 和 MCP 选项
  const [availableSkills, setAvailableSkills] = useState<SkillInfo[]>([]);
  const [availableMcp, setAvailableMcp] = useState<McpServerInfo[]>([]);
  const [availableConnections, setAvailableConnections] = useState<{ name: string }[]>([]);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.getAgents();
      setAgents(res.agents);
    } catch {
      toast.error('加载 Agent 列表失败');
    }
    setLoading(false);
  }, []);

  // 加载可用 Skills 和 MCP 列表
  const loadOptions = useCallback(async () => {
    try {
      const [skillsRes, mcpRes, connRes] = await Promise.all([
        adminApi.getSkills(),
        adminApi.getMcpServers(),
        adminApi.getDbConnections(),
      ]);
      // 过滤系统内置技能（lesson 属于记忆系统，不可禁用）
      const SYSTEM_SKILLS = ['lesson'];
      setAvailableSkills((skillsRes.data || []).filter(s => s.enabled && !SYSTEM_SKILLS.includes(s.name)));
      setAvailableMcp((mcpRes.data || []).filter(s => s.enabled));
      setAvailableConnections((connRes.data || []).filter(c => c.enabled));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const refreshModels = useCallback(() => {
    adminApi.getChatModels()
      .then(data => setAvailableModels(data.models || []))
      .catch(() => setAvailableModels([]));
  }, []);

  useEffect(() => {
    if (!modelDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-model-dropdown]')) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelDropdownOpen]);

  const resetForm = () => {
    setFormName('');
    setFormIdentityName('');
    setFormIdentityEmoji('');
    setFormModel('');
    setFormEnabled(true);
    setFormToolsFilterEnabled(false);
    setFormToolsFilter([]);
    setFormSkillsFilterEnabled(false);
    setFormSkillsFilter([]);
    setFormMcpFilterEnabled(false);
    setFormMcpFilter([]);
    setFormConnFilterEnabled(false);
    setFormAllowedConnections([]);
  };

  const openCreateModal = async () => {
    setEditingAgent(null);
    resetForm();
    refreshModels();
    // 新建 agent 权限默认全部禁用，仅加载可用选项列表
    try {
      const [skillsRes, mcpRes, connRes] = await Promise.all([
        adminApi.getSkills(),
        adminApi.getMcpServers(),
        adminApi.getDbConnections(),
      ]);
      const SYSTEM_SKILLS = ['lesson'];
      setAvailableSkills((skillsRes.data || []).filter(s => s.enabled && !SYSTEM_SKILLS.includes(s.name)));
      setAvailableMcp((mcpRes.data || []).filter(s => s.enabled));
      setAvailableConnections((connRes.data || []).filter((c: any) => c.enabled));
    } catch {
      // 保持空列表
    }
    setModalOpen(true);
  };

  const openEditModal = (agent: AgentInfo) => {
    refreshModels();
    setEditingAgent(agent);
    setFormName(agent.name);
    setFormIdentityName(agent.identity?.name || '');
    setFormIdentityEmoji(agent.identity?.emoji || '');
    setFormModel(agent.model || '');
    setFormEnabled(agent.enabled);
    setFormToolsFilterEnabled(Array.isArray(agent.toolsFilter) && agent.toolsFilter.length > 0);
    setFormToolsFilter(agent.toolsFilter || []);
    setFormSkillsFilterEnabled(Array.isArray(agent.skillsFilter) && agent.skillsFilter.length > 0);
    setFormSkillsFilter(agent.skillsFilter || []);
    setFormMcpFilterEnabled(Array.isArray(agent.mcpFilter) && agent.mcpFilter.length > 0);
    setFormMcpFilter(agent.mcpFilter || []);
    setFormConnFilterEnabled(Array.isArray(agent.allowedConnections) && agent.allowedConnections.length > 0);
    setFormAllowedConnections(agent.allowedConnections || []);
    loadOptions();
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    // 验证
    if (!formName) {
      toast.error('请输入 Agent ID');
      return;
    }
    if (!/^[a-z][a-z0-9_-]*$/.test(formName)) {
      toast.error('Agent ID 只能使用小写字母、数字、下划线和连字符，以字母开头');
      return;
    }
    if (formToolsFilterEnabled && formToolsFilter.length === 0) {
      toast.error('请至少选择一个工作空间工具');
      return;
    }
    if (formSkillsFilterEnabled && formSkillsFilter.length === 0) {
      toast.error('请至少选择一个技能');
      return;
    }
    if (formMcpFilterEnabled && formMcpFilter.length === 0) {
      toast.error('请至少选择一个 MCP 服务器');
      return;
    }

    setSubmitting(true);
    try {
      const identity = (formIdentityName || formIdentityEmoji)
        ? { name: formIdentityName || undefined, emoji: formIdentityEmoji || undefined }
        : null;

      const data: any = {
        name: formName,
        model: formModel || null,
        identity,
        toolsFilter: formToolsFilterEnabled ? formToolsFilter : [],
        skillsFilter: formSkillsFilterEnabled ? formSkillsFilter : [],
        mcpFilter: formMcpFilterEnabled ? formMcpFilter : [],
        allowedConnections: formConnFilterEnabled ? formAllowedConnections : [],
      };
      // enabled 仅在实际变化时发送
      if (!editingAgent || formEnabled !== editingAgent.enabled) {
        data.enabled = formEnabled;
      }

      if (editingAgent) {
        const res = await adminApi.updateAgent(editingAgent.id, data);
        toast.success('Agent 已更新');
        setAgents(prev => prev.map(a => a.id === editingAgent.id ? { ...a, ...res.agent } : a));
      } else {
        const res = await adminApi.createAgent(data);
        toast.success('Agent 已创建');
        if (res.agent) setAgents(prev => [...prev, res.agent]);
        else loadData(); // fallback
      }

      setModalOpen(false);
    } catch (err: any) {
      toast.error(err.message || '操作失败');
    }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    try {
      await adminApi.deleteAgent(id);
      toast.success('Agent 已删除');
      setAgents(prev => prev.filter(a => a.id !== id));
    } catch (err: any) {
      toast.error(err.message || '删除失败');
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await adminApi.setDefaultAgent(id);
      toast.success('已设为默认 Agent');
      setAgents(prev => prev.map(a => ({ ...a, isDefault: a.id === id })));
    } catch (err: any) {
      toast.error(err.message || '设置失败');
    }
  };

  return (
    <div>
      {/* 顶部 */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Bot className="h-5 w-5" />
          我的 Agent
        </h2>
        <Button onClick={openCreateModal}>
          <Plus className="h-4 w-4 mr-1" />
          创建 Agent
        </Button>
      </div>

      {/* Agent 列表 — Card 网格 */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : agents.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          还没有 Agent，点击右上角创建一个吧
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <Card key={agent.id} className="relative">
              <CardContent className="pt-5 pb-4">
                {/* Agent 基本信息 */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">
                      {agent.identity?.emoji || <Bot className="h-5 w-5 text-muted-foreground" />}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {agent.identity?.name || agent.name}
                        </span>
                        {agent.isDefault && (
                          <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">
                            默认
                          </Badge>
                        )}
                      </div>
                      {agent.model && (
                        <p className="text-xs text-muted-foreground mt-0.5">{agent.model}</p>
                      )}
                    </div>
                  </div>
                  <Badge variant={agent.enabled ? 'default' : 'secondary'}>
                    {agent.enabled ? '启用' : '禁用'}
                  </Badge>
                </div>

                {/* 权限标签 */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {Array.isArray(agent.toolsFilter) && agent.toolsFilter.length > 0 ? (
                    <Badge variant="outline" className="text-xs text-blue-600 border-blue-200 bg-blue-50">
                      工具: {agent.toolsFilter.length}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-red-600 border-red-200 bg-red-50">工具: 禁用</Badge>
                  )}
                  {Array.isArray(agent.skillsFilter) && agent.skillsFilter.length > 0 ? (
                    <Badge variant="outline" className="text-xs text-purple-600 border-purple-200 bg-purple-50">
                      技能: {agent.skillsFilter.length}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-red-600 border-red-200 bg-red-50">技能: 禁用</Badge>
                  )}
                  {Array.isArray(agent.mcpFilter) && agent.mcpFilter.length > 0 ? (
                    <Badge variant="outline" className="text-xs text-cyan-600 border-cyan-200 bg-cyan-50">
                      MCP: {agent.mcpFilter.length}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-red-600 border-red-200 bg-red-50">MCP: 禁用</Badge>
                  )}
                  {Array.isArray(agent.allowedConnections) && agent.allowedConnections.length > 0 ? (
                    <Badge variant="outline" className="text-xs text-orange-600 border-orange-200 bg-orange-50">
                      连接: {agent.allowedConnections.join(', ')}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-red-600 border-red-200 bg-red-50">连接: 禁用</Badge>
                  )}
                </div>

                {/* 操作按钮 */}
                <div className="flex items-center gap-1 pt-1 border-t">
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => !agent.isDefault && handleSetDefault(agent.id)}
                        >
                          <Star
                            className={`h-4 w-4 ${agent.isDefault ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'}`}
                          />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{agent.isDefault ? '当前默认' : '设为默认'}</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEditModal(agent)}
                        >
                          <Pencil className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>编辑</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => onConfigAgent?.(agent)}
                        >
                          <Settings className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Agent 配置</TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm('确定删除此 Agent？')) handleDelete(agent.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>删除</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 创建/编辑 Dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-[640px] max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{editingAgent ? '编辑 Agent' : '创建 Agent'}</DialogTitle>
            <DialogDescription>
              {editingAgent ? '修改 Agent 的基本信息和权限配置' : '创建新的 Agent 并配置权限'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto pr-4">
            <div className="space-y-4 py-2">
              {/* Agent ID */}
              <div className="space-y-2">
                <Label htmlFor="agent-name">Agent ID</Label>
                <Input
                  id="agent-name"
                  placeholder="使用拼音，如: shuju_fenxi、caiwu_agent"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  disabled={!!editingAgent}
                />
              </div>

              {/* 显示名 + Emoji */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="identity-name">显示名</Label>
                  <Input
                    id="identity-name"
                    placeholder="如: 数据分析师、财务助手"
                    value={formIdentityName}
                    onChange={(e) => setFormIdentityName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Emoji</Label>
                  <div className="relative">
                    <Button
                      variant="outline"
                      className="w-full justify-start text-left font-normal"
                      onClick={() => setEmojiPickerOpen(!emojiPickerOpen)}
                    >
                      {formIdentityEmoji || <span className="text-muted-foreground">选择 Emoji</span>}
                    </Button>
                    {emojiPickerOpen && (
                      <div className="absolute z-50 top-full mt-1 p-2 bg-popover border rounded-md shadow-md flex flex-wrap gap-1 w-[260px]">
                        {EMOJI_OPTIONS.map((e) => (
                          <button
                            key={e}
                            type="button"
                            className="w-9 h-9 flex items-center justify-center text-xl rounded hover:bg-accent"
                            onClick={() => {
                              setFormIdentityEmoji(e);
                              setEmojiPickerOpen(false);
                            }}
                          >
                            {e}
                          </button>
                        ))}
                        {formIdentityEmoji && (
                          <button
                            type="button"
                            className="w-full mt-1 text-xs text-muted-foreground hover:text-foreground py-1"
                            onClick={() => {
                              setFormIdentityEmoji('');
                              setEmojiPickerOpen(false);
                            }}
                          >
                            清除选择
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 模型 */}
              <div className="space-y-2">
                <Label htmlFor="agent-model">模型 (留空跟随全局默认)</Label>
                <div className="relative" data-model-dropdown>
                  <Input
                    id="agent-model"
                    placeholder="留空跟随全局默认"
                    value={formModel}
                    onChange={(e) => setFormModel(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  {modelDropdownOpen && (
                    <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                      <div
                        className="cursor-pointer px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
                        onClick={() => { setFormModel(''); setModelDropdownOpen(false); }}
                      >
                        （留空）跟随全局默认
                      </div>
                      {availableModels.map((m) => {
                        const fullId = m.provider ? `${m.provider}/${m.id}` : m.id;
                        return (
                          <div
                            key={fullId}
                            className="cursor-pointer px-3 py-2 text-sm hover:bg-accent"
                            onClick={() => { setFormModel(fullId); setModelDropdownOpen(false); }}
                          >
                            {fullId}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <Separator />
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Zap className="h-4 w-4" />
                权限配置
              </div>

              {/* 工作空间工具 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>工作空间工具</Label>
                  <Switch checked={formToolsFilterEnabled} onCheckedChange={setFormToolsFilterEnabled} />
                </div>
                {formToolsFilterEnabled && (
                  <MultiCheckboxSelect
                    options={WORKSPACE_TOOLS}
                    selected={formToolsFilter}
                    onChange={setFormToolsFilter}
                  />
                )}
              </div>

              {/* Skills 过滤 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Skills 技能</Label>
                  <Switch checked={formSkillsFilterEnabled} onCheckedChange={setFormSkillsFilterEnabled} />
                </div>
                {formSkillsFilterEnabled && (
                  <MultiCheckboxSelect
                    options={availableSkills.map(s => ({
                      value: s.name,
                      label: `${s.name}${s.description ? ` -- ${s.description}` : ''} (${s.scope === 'enterprise' ? '企业' : '个人'})`,
                    }))}
                    selected={formSkillsFilter}
                    onChange={setFormSkillsFilter}
                    emptyText="暂无可用技能"
                  />
                )}
              </div>

              {/* MCP 过滤 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>MCP 服务器</Label>
                  <Switch checked={formMcpFilterEnabled} onCheckedChange={setFormMcpFilterEnabled} />
                </div>
                {formMcpFilterEnabled && (
                  <MultiCheckboxSelect
                    options={availableMcp.map(s => ({
                      value: s.id,
                      label: `${s.name}${s.description ? ` -- ${s.description}` : ''} (${s.scope === 'enterprise' ? '企业' : '个人'})`,
                    }))}
                    selected={formMcpFilter}
                    onChange={setFormMcpFilter}
                    emptyText="暂无可用 MCP 服务器"
                  />
                )}
              </div>

              {/* 数据库连接白名单 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5">
                    <Database className="h-3.5 w-3.5" />
                    数据库连接限制
                  </Label>
                  <Switch checked={formConnFilterEnabled} onCheckedChange={setFormConnFilterEnabled} />
                </div>
                {formConnFilterEnabled && (
                  <MultiCheckboxSelect
                    options={availableConnections.map(c => ({
                      value: c.name,
                      label: c.name,
                    }))}
                    selected={formAllowedConnections}
                    onChange={setFormAllowedConnections}
                    emptyText="暂无可用连接，请先在「数据库配置」中添加"
                  />
                )}
              </div>

              <Separator />

              {/* 启用 */}
              <div className="flex items-center justify-between">
                <Label>启用</Label>
                <Switch checked={formEnabled} onCheckedChange={setFormEnabled} />
              </div>
            </div>
          </div>

          <DialogFooter className="pt-4">
            <Button variant="outline" onClick={() => setModalOpen(false)}>取消</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {editingAgent ? '保存' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

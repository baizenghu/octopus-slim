/**
 * 心跳巡检配置页面（个人级）
 *
 * 功能：
 * - 查看/创建/编辑/删除心跳巡检任务
 * - 启用/禁用巡检
 * - 手动触发执行
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Plus, Pencil, Trash2, Clock, Play, Search, Loader2,
} from 'lucide-react';
import { adminApi, type ScheduledTaskInfo, type AgentInfo } from '../api';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';

const HEARTBEAT_UNITS = [
  { label: '分钟', value: 'm', suffix: 'm' },
  { label: '小时', value: 'h', suffix: 'h' },
  { label: '天', value: 'd', suffix: 'd' },
];

/** 解析 "30m" / "2h" / "1d" 为 { num, unit } */
function parseEvery(every: string): { num: number; unit: string } {
  const match = every.match(/^(\d+)([mhd])$/);
  if (match) return { num: parseInt(match[1], 10), unit: match[2] };
  return { num: 1, unit: 'h' };
}

/** 格式化为可读文本 */
function formatEvery(every: string): string {
  const { num, unit } = parseEvery(every);
  const label = HEARTBEAT_UNITS.find(u => u.value === unit)?.label || unit;
  return `每 ${num} ${label}`;
}


export default function SchedulerPage() {
  // const navigate = useNavigate(); // removed: heartbeat run no longer redirects
  const [tasks, setTasks] = useState<ScheduledTaskInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTaskInfo | null>(null);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [searchText, setSearchText] = useState('');

  // 表单状态
  const [formName, setFormName] = useState('');
  const [formEnabled, setFormEnabled] = useState(true);
  const [formHeartbeatAgentId, setFormHeartbeatAgentId] = useState('');
  const [formEveryNum, setFormEveryNum] = useState(1);
  const [formEveryUnit, setFormEveryUnit] = useState('h');
  const [formHeartbeatContent, setFormHeartbeatContent] = useState('');

  // agent ID -> 名称映射
  const agentNameMap = new Map(agents.map(a => [a.id, a.identity?.emoji ? `${a.identity.emoji} ${a.identity?.name || a.name}` : (a.identity?.name || a.name)]));

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.getScheduledTasks();
      setTasks(res.tasks);
    } catch {
      toast.error('加载巡检列表失败');
    }
    setLoading(false);
    adminApi.getAgents().then(res => setAgents(res.agents)).catch(() => {});
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const resetForm = () => {
    setFormName('');
    setFormEnabled(true);
    setFormHeartbeatAgentId('');
    setFormEveryNum(1);
    setFormEveryUnit('h');
    setFormHeartbeatContent('');
  };

  const openCreateModal = () => {
    setEditingTask(null);
    resetForm();
    setModalOpen(true);
  };

  const openEditModal = (task: ScheduledTaskInfo) => {
    setEditingTask(task);
    setFormName(task.name);
    setFormEnabled(task.enabled);
    setFormHeartbeatAgentId(task.taskConfig?.agentId || '');
    const parsed = parseEvery(task.taskConfig?.every || '1h');
    setFormEveryNum(parsed.num);
    setFormEveryUnit(parsed.unit);
    setFormHeartbeatContent(task.taskConfig?.content || '');
    setModalOpen(true);
  };

  const buildFormData = () => {
    if (!formName.trim()) throw new Error('请输入任务名称');
    if (!formHeartbeatAgentId) throw new Error('请选择目标 Agent');
    if (formEveryNum < 1 || formEveryNum > 60) throw new Error('频率数值需在 1-60 之间');
    if (!editingTask) {
      const existing = tasks.find(t => t.taskType === 'heartbeat' && t.taskConfig?.agentId === formHeartbeatAgentId);
      if (existing) throw new Error('该 Agent 已有心跳巡检任务');
    }
    const every = `${formEveryNum}${formEveryUnit}`;
    return {
      name: formName,
      cron: every,
      taskType: 'heartbeat' as const,
      taskConfig: {
        agentId: formHeartbeatAgentId,
        every,
        content: formHeartbeatContent,
      },
      enabled: formEnabled,
    };
  };

  const handleSubmit = async () => {
    try {
      const data = buildFormData();
      if (editingTask) {
        await adminApi.updateScheduledTask(editingTask.id, data);
        toast.success('巡检配置已更新');
      } else {
        await adminApi.createScheduledTask(data);
        toast.success('巡检配置已创建');
      }
      setModalOpen(false);
      loadData();
    } catch (err: any) {
      toast.error(err.message || '操作失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此巡检配置？')) return;
    try {
      await adminApi.deleteScheduledTask(id);
      toast.success('巡检配置已删除');
      loadData();
    } catch (err: any) {
      toast.error(err.message || '删除失败');
    }
  };

  const handleToggleEnabled = async (task: ScheduledTaskInfo) => {
    try {
      await adminApi.updateScheduledTask(task.id, { enabled: !task.enabled });
      toast.success(task.enabled ? '已禁用' : '已启用');
      loadData();
    } catch (err: any) {
      toast.error(err.message || '操作失败');
    }
  };

  const handleRun = async (id: string) => {
    try {
      const res = await adminApi.runScheduledTask(id);
      toast.success(res.alert ? '⚠️ 巡检发现异常，已推送告警' : '✅ 巡检完成，一切正常');
      loadData(); // 刷新列表（更新 lastRunAt）
    } catch (err: any) {
      toast.error(err.message || '执行失败');
    }
  };

  // 只显示心跳类型任务，并支持搜索
  const heartbeatTasks = tasks.filter(t => t.taskType === 'heartbeat');
  const filteredTasks = searchText
    ? heartbeatTasks.filter(t => {
        const keyword = searchText.toLowerCase();
        const agentName = (t.taskConfig?.agentId ? agentNameMap.get(t.taskConfig.agentId) : '') || '';
        return t.name.toLowerCase().includes(keyword)
          || agentName.toLowerCase().includes(keyword);
      })
    : heartbeatTasks;

  return (
    <TooltipProvider>
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5" />
            心跳配置
          </h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索名称、Agent"
                className="pl-8 w-60"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
            </div>
            <Button onClick={openCreateModal}>
              <Plus className="h-4 w-4 mr-1" />
              创建巡检
            </Button>
          </div>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>巡检名称</TableHead>
                <TableHead className="w-40">目标 Agent</TableHead>
                <TableHead className="w-40">频率</TableHead>
                <TableHead className="w-20">状态</TableHead>
                <TableHead className="w-44">上次执行</TableHead>
                <TableHead className="w-48">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : filteredTasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    还没有心跳巡检，点击右上角创建一个吧
                  </TableCell>
                </TableRow>
              ) : (
                filteredTasks.map((task) => {
                  const agentId = task.taskConfig?.agentId || (task as any).agentId;
                  const agentName = agentId ? agentNameMap.get(agentId) : null;

                  return (
                    <TableRow key={task.id}>
                      <TableCell className="font-medium">{task.name}</TableCell>
                      <TableCell>
                        {agentName
                          ? <span className="text-sm">{agentName}</span>
                          : agentId
                            ? <span className="text-sm text-muted-foreground">{agentId.slice(0, 8)}...</span>
                            : <span className="text-sm text-muted-foreground">-</span>
                        }
                      </TableCell>
                      <TableCell>
                        <Badge variant="default" className="gap-1">
                          <Clock className="h-3 w-3" />
                          {formatEvery(task.taskConfig?.every || task.cron)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={task.enabled ? 'default' : 'secondary'}>
                          {task.enabled ? '启用' : '禁用'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {task.lastRunAt ? new Date(task.lastRunAt).toLocaleString('zh-CN') : '未执行'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleRun(task.id)}>
                                <Play className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>立即执行</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center">
                                <Switch
                                  checked={task.enabled}
                                  onCheckedChange={() => handleToggleEnabled(task)}
                                />
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>{task.enabled ? '禁用' : '启用'}</TooltipContent>
                          </Tooltip>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditModal(task)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(task.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* 创建/编辑 Dialog */}
        <Dialog open={modalOpen} onOpenChange={setModalOpen}>
          <DialogContent className="max-w-[560px]">
            <DialogHeader>
              <DialogTitle>{editingTask ? '编辑心跳巡检' : '创建心跳巡检'}</DialogTitle>
              <DialogDescription>配置 Agent 的定期巡检规则</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>巡检名称 <span className="text-destructive">*</span></Label>
                <Input
                  placeholder="如: 服务器健康检查"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                    <Label>目标 Agent <span className="text-destructive">*</span></Label>
                    <Select value={formHeartbeatAgentId} onValueChange={setFormHeartbeatAgentId}>
                      <SelectTrigger>
                        <SelectValue placeholder="选择要巡检的 Agent" />
                      </SelectTrigger>
                      <SelectContent>
                        {agents.map(a => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.identity?.emoji ? `${a.identity.emoji} ` : ''}{a.identity?.name || a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>巡检频率 <span className="text-destructive">*</span></Label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground shrink-0">每</span>
                      <Input
                        type="number"
                        min={1}
                        max={60}
                        className="w-20"
                        value={formEveryNum}
                        onChange={(e) => setFormEveryNum(Math.max(1, Math.min(60, parseInt(e.target.value) || 1)))}
                      />
                      <Select value={formEveryUnit} onValueChange={setFormEveryUnit}>
                        <SelectTrigger className="w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {HEARTBEAT_UNITS.map(u => (
                            <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>巡检内容</Label>
                    <Textarea
                      rows={10}
                      placeholder="使用 Markdown 格式编写巡检任务..."
                      className="font-mono text-sm"
                      value={formHeartbeatContent}
                      onChange={(e) => setFormHeartbeatContent(e.target.value)}
                    />
                  </div>

              <div className="flex items-center gap-2">
                <Switch checked={formEnabled} onCheckedChange={setFormEnabled} id="task-enabled" />
                <Label htmlFor="task-enabled">启用</Label>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setModalOpen(false)}>取消</Button>
              <Button onClick={handleSubmit}>
                {editingTask ? '保存' : '创建'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

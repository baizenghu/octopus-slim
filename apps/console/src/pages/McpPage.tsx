/**
 * MCP 工具管理页面（管理员）
 *
 * 功能：
 * - 表格展示所有 MCP Server
 * - 新建/编辑/删除 MCP Server
 * - 测试连接 -> 查看工具列表
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Plug,
  Trash2,
  Pencil,
  Zap,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { adminApi, type McpServerInfo, type McpToolInfo } from '../api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

interface FormState {
  name: string;
  description: string;
  transport: 'stdio' | 'http';
  command: string;
  args: string;
  url: string;
  env: string;
  enabled: boolean;
}

const emptyForm: FormState = {
  name: '', description: '', transport: 'stdio', command: '', args: '', url: '', env: '', enabled: true,
};

export default function McpPage() {
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServerInfo | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  // 删除确认
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingServer, setDeletingServer] = useState<McpServerInfo | null>(null);

  // 测试连接
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; tools: McpToolInfo[] } | null>(null);
  const [testServerName, setTestServerName] = useState('');

  const loadServers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.getMcpServers();
      setServers(res.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadServers(); }, [loadServers]);

  const openCreateModal = () => {
    setEditingServer(null);
    setForm({ ...emptyForm });
    setModalOpen(true);
  };

  const openEditModal = (server: McpServerInfo) => {
    setEditingServer(server);
    setForm({
      name: server.name,
      description: server.description || '',
      transport: server.transport,
      command: server.command || '',
      args: server.args ? server.args.join('\n') : '',
      url: server.url || '',
      env: server.env ? Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
      enabled: server.enabled,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name) {
      toast.error('请输入名称');
      return;
    }
    try {
      const data: any = {
        name: form.name,
        description: form.description || undefined,
        scope: 'enterprise',
        transport: form.transport,
        enabled: form.enabled,
      };

      if (form.transport === 'stdio') {
        if (!form.command) { toast.error('请输入启动命令'); return; }
        data.command = form.command;
        data.args = form.args ? form.args.split('\n').map((s: string) => s.trim()).filter(Boolean) : [];
      } else {
        if (!form.url) { toast.error('请输入 URL'); return; }
        data.url = form.url;
      }

      if (form.env) {
        const envObj: Record<string, string> = {};
        form.env.split('\n').forEach((line: string) => {
          const idx = line.indexOf('=');
          if (idx > 0) {
            envObj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
          }
        });
        data.env = envObj;
      }

      if (editingServer) {
        await adminApi.updateMcpServer(editingServer.id, data);
        toast.success('MCP Server 已更新');
      } else {
        await adminApi.createMcpServer(data);
        toast.success('MCP Server 已创建');
      }

      setModalOpen(false);
      loadServers();
    } catch (err: any) {
      if (err.message) toast.error(err.message);
    }
  };

  const confirmDelete = (server: McpServerInfo) => {
    setDeletingServer(server);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingServer) return;
    try {
      await adminApi.deleteMcpServer(deletingServer.id);
      toast.success('已删除');
      setDeleteDialogOpen(false);
      loadServers();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleTest = async (server: McpServerInfo) => {
    setTestServerName(server.name);
    setTestResult(null);
    setTestModalOpen(true);
    setTestLoading(true);
    try {
      const result = await adminApi.testMcpServer(server.id);
      setTestResult(result);
    } catch (err: any) {
      setTestResult({ success: false, message: err.message, tools: [] });
    }
    setTestLoading(false);
  };

  const updateForm = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Plug className="h-5 w-5" />
          MCP 工具管理
        </h2>
        <Button onClick={openCreateModal}>
          <Plus className="h-4 w-4 mr-1" />
          注册 MCP Server
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead className="w-[100px]">范围</TableHead>
                  <TableHead className="w-[80px]">传输</TableHead>
                  <TableHead>命令</TableHead>
                  <TableHead className="w-[80px]">状态</TableHead>
                  <TableHead className="w-[180px] text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {servers.map((server) => (
                  <TableRow key={server.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{server.name}</div>
                        {server.description && (
                          <div className="text-xs text-muted-foreground">{server.description}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={server.scope === 'enterprise' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}>
                        {server.scope === 'enterprise' ? '企业级' : '个人'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{server.transport}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs truncate max-w-[300px]">
                      {server.transport === 'stdio'
                        ? `${server.command} ${server.args?.join(' ') || ''}`
                        : server.url}
                    </TableCell>
                    <TableCell>
                      <Badge className={server.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}>
                        {server.enabled ? '启用' : '禁用'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="outline" size="sm" onClick={() => handleTest(server)}>
                          <Zap className="h-4 w-4 mr-1" />
                          测试
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEditModal(server)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => confirmDelete(server)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {servers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">暂无 MCP Server</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 新建/编辑弹窗 */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingServer ? '编辑 MCP Server' : '注册 MCP Server'}</DialogTitle>
            <DialogDescription>
              {editingServer ? '修改 MCP Server 配置' : '注册新的 MCP Server'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>名称 *</Label>
              <Input placeholder="例如: 数据库连接器" value={form.name} onChange={(e) => updateForm({ name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>描述</Label>
              <Input placeholder="例如: 连接企业内部 MySQL 数据库" value={form.description} onChange={(e) => updateForm({ description: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>传输协议 *</Label>
              <Select value={form.transport} onValueChange={(v: 'stdio' | 'http') => updateForm({ transport: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">stdio（本地进程）</SelectItem>
                  <SelectItem value="http">http（远程服务）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.transport === 'stdio' ? (
              <>
                <div className="space-y-2">
                  <Label>启动命令 *</Label>
                  <Input placeholder="例如: python3" value={form.command} onChange={(e) => updateForm({ command: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>命令参数（每行一个）</Label>
                  <Textarea rows={3} placeholder={`例如:\n/path/to/mcp_server.py`} value={form.args} onChange={(e) => updateForm({ args: e.target.value })} />
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <Label>API 地址 *</Label>
                <Input placeholder="例如: http://localhost:8080/mcp" value={form.url} onChange={(e) => updateForm({ url: e.target.value })} />
              </div>
            )}
            <div className="space-y-2">
              <Label>环境变量（每行 KEY=VALUE）</Label>
              <Textarea rows={3} placeholder={`例如:\nMYSQL_USER=root\nMYSQL_PASSWORD=secret`} value={form.env} onChange={(e) => updateForm({ env: e.target.value })} />
            </div>
            <div className="flex items-center justify-between">
              <Label>启用</Label>
              <Switch checked={form.enabled} onCheckedChange={(checked: boolean) => updateForm({ enabled: checked })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>取消</Button>
            <Button onClick={handleSubmit}>{editingServer ? '更新' : '创建'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认弹窗 */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定删除 MCP Server <span className="font-semibold">{deletingServer?.name}</span>？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={handleDelete}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 测试连接结果弹窗 */}
      <Dialog open={testModalOpen} onOpenChange={setTestModalOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>测试连接: {testServerName}</DialogTitle>
          </DialogHeader>

          {testLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">正在连接...</span>
            </div>
          ) : testResult ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge className={testResult.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>
                  {testResult.success ? '连接成功' : '连接失败'}
                </Badge>
                <span className="text-sm text-muted-foreground">{testResult.message}</span>
              </div>

              {testResult.tools.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium">可用工具 ({testResult.tools.length})</h4>
                  {testResult.tools.map((tool, i) => (
                    <Card key={i}>
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">名称:</span>
                          <code className="text-sm font-mono bg-muted px-1.5 py-0.5 rounded">{tool.name}</code>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="text-sm text-muted-foreground shrink-0">描述:</span>
                          <span className="text-sm">{tool.description}</span>
                        </div>
                        {tool.inputSchema?.properties && (
                          <div className="flex items-start gap-2">
                            <span className="text-sm text-muted-foreground shrink-0">参数:</span>
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(tool.inputSchema.properties).map(([k, v]: [string, any]) => (
                                <Badge key={k} variant="outline" className="text-xs">{k}: {v.type}</Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setTestModalOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

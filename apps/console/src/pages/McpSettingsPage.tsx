/**
 * 个人 MCP 设置页面
 *
 * 功能：
 * - 查看企业级 MCP 工具（只读）
 * - 管理个人 MCP Server（CRUD）
 */
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Pencil, Zap, Loader2, Wrench } from 'lucide-react';
import { adminApi, type McpServerInfo, type McpToolInfo } from '../api';
import { useAuthStore } from '../store';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';

export default function McpSettingsPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.roles?.some((r: string) => r.toLowerCase() === 'admin');
  const [enterpriseServers, setEnterpriseServers] = useState<McpServerInfo[]>([]);
  const [personalServers, setPersonalServers] = useState<McpServerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServerInfo | null>(null);
  const [editingScope, setEditingScope] = useState<'enterprise' | 'personal'>('personal');

  // 表单状态
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formTransport, setFormTransport] = useState('stdio');
  const [formCommand, setFormCommand] = useState('');
  const [formArgs, setFormArgs] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formEnv, setFormEnv] = useState('');
  const [formEnabled, setFormEnabled] = useState(true);

  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; tools: McpToolInfo[] } | null>(null);
  const [testServerName, setTestServerName] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [allRes, personalRes] = await Promise.all([
        adminApi.getMcpServers(),
        adminApi.getPersonalMcpServers(),
      ]);
      setEnterpriseServers(allRes.data.filter(s => s.scope === 'enterprise'));
      setPersonalServers(personalRes.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormTransport('stdio');
    setFormCommand('');
    setFormArgs('');
    setFormUrl('');
    setFormEnv('');
    setFormEnabled(true);
  };

  const openCreateModal = (scope: 'enterprise' | 'personal' = 'personal') => {
    setEditingServer(null);
    setEditingScope(scope);
    resetForm();
    setModalOpen(true);
  };

  const openEditModal = (server: McpServerInfo) => {
    setEditingServer(server);
    setEditingScope(server.scope);
    setFormName(server.name);
    setFormDescription(server.description || '');
    setFormTransport(server.transport);
    setFormCommand(server.command || '');
    setFormArgs(server.args ? server.args.join('\n') : '');
    setFormUrl(server.url || '');
    setFormEnv(server.env ? Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join('\n') : '');
    setFormEnabled(server.enabled);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!formName.trim()) {
      toast.error('请输入名称');
      return;
    }
    if (formTransport === 'stdio' && !formCommand.trim()) {
      toast.error('请输入启动命令');
      return;
    }
    if (formTransport !== 'stdio' && !formUrl.trim()) {
      toast.error('请输入 API 地址');
      return;
    }

    try {
      const data: any = {
        name: formName,
        description: formDescription || undefined,
        transport: formTransport,
        enabled: formEnabled,
      };

      if (formTransport === 'stdio') {
        data.command = formCommand;
        data.args = formArgs ? formArgs.split('\n').map((s: string) => s.trim()).filter(Boolean) : [];
      } else {
        data.url = formUrl;
      }

      if (formEnv) {
        const envObj: Record<string, string> = {};
        formEnv.split('\n').forEach((line: string) => {
          const idx = line.indexOf('=');
          if (idx > 0) {
            envObj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
          }
        });
        data.env = envObj;
      }

      if (editingScope === 'enterprise') {
        data.scope = 'enterprise';
        if (editingServer) {
          await adminApi.updateMcpServer(editingServer.id, data);
          toast.success('企业 MCP 已更新');
        } else {
          await adminApi.createMcpServer(data);
          toast.success('企业 MCP 已创建');
        }
      } else {
        if (editingServer) {
          await adminApi.updatePersonalMcpServer(editingServer.id, data);
          toast.success('已更新');
        } else {
          await adminApi.createPersonalMcpServer(data);
          toast.success('已创建');
        }
      }

      setModalOpen(false);
      loadData();
    } catch (err: any) {
      if (err.message) toast.error(err.message);
    }
  };

  const handleDelete = async (id: string, scope: 'enterprise' | 'personal' = 'personal') => {
    if (!confirm('确定删除？')) return;
    try {
      if (scope === 'enterprise') {
        await adminApi.deleteMcpServer(id);
      } else {
        await adminApi.deletePersonalMcpServer(id);
      }
      toast.success('已删除');
      loadData();
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

  const renderServerTable = (servers: McpServerInfo[], scope: 'enterprise' | 'personal') => (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead className="w-20">传输</TableHead>
            <TableHead>命令</TableHead>
            <TableHead className="w-20">状态</TableHead>
            <TableHead className="w-48">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-8">
                <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
              </TableCell>
            </TableRow>
          ) : servers.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                {scope === 'enterprise' ? '暂无企业级 MCP 工具' : '暂无个人 MCP 工具'}
              </TableCell>
            </TableRow>
          ) : (
            servers.map((server) => (
              <TableRow key={server.id}>
                <TableCell>
                  <div className="font-medium">{server.name}</div>
                  {server.description && <div className="text-xs text-muted-foreground">{server.description}</div>}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{server.transport}</Badge>
                </TableCell>
                <TableCell className="max-w-[300px] truncate">
                  <code className="text-xs">
                    {server.transport === 'stdio'
                      ? `${server.command} ${server.args?.join(' ')}`
                      : server.url}
                  </code>
                </TableCell>
                <TableCell>
                  <Badge variant={server.enabled ? 'default' : 'secondary'}>
                    {server.enabled ? '启用' : '禁用'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" onClick={() => handleTest(server)}>
                      <Zap className="h-3.5 w-3.5 mr-1" />
                      测试
                    </Button>
                    {(scope === 'personal' || isAdmin) && (
                      <>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditModal(server)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(server.id, scope)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
        <Wrench className="h-5 w-5" />
        MCP 工具设置
      </h2>

      <Tabs defaultValue="enterprise">
        <TabsList>
          <TabsTrigger value="enterprise">企业级工具 ({enterpriseServers.length})</TabsTrigger>
          <TabsTrigger value="personal">我的工具 ({personalServers.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="enterprise">
          {isAdmin && (
            <div className="flex justify-end mb-4">
              <Button onClick={() => openCreateModal('enterprise')}>
                <Plus className="h-4 w-4 mr-1" />
                注册企业 MCP
              </Button>
            </div>
          )}
          {renderServerTable(enterpriseServers, 'enterprise')}
        </TabsContent>

        <TabsContent value="personal">
          <div className="flex justify-end mb-4">
            <Button onClick={() => openCreateModal('personal')}>
              <Plus className="h-4 w-4 mr-1" />
              添加个人 MCP
            </Button>
          </div>
          {renderServerTable(personalServers, 'personal')}
        </TabsContent>
      </Tabs>

      {/* 新建/编辑 Dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              {editingScope === 'enterprise'
                ? (editingServer ? '编辑企业 MCP' : '注册企业 MCP')
                : (editingServer ? '编辑个人 MCP' : '添加个人 MCP')}
            </DialogTitle>
            <DialogDescription>配置 MCP Server 的连接信息</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>名称 <span className="text-destructive">*</span></Label>
              <Input
                placeholder={editingScope === 'enterprise' ? '例如: 数据库连接器' : '例如: 我的数据分析工具'}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>描述</Label>
              <Input
                placeholder="简要描述工具用途"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>传输协议 <span className="text-destructive">*</span></Label>
              <Select value={formTransport} onValueChange={setFormTransport}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">stdio（本地进程）</SelectItem>
                  {editingScope === 'enterprise' && (
                    <SelectItem value="http">http（远程服务）</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            {formTransport === 'stdio' ? (
              <>
                <div className="space-y-2">
                  <Label>启动命令 <span className="text-destructive">*</span></Label>
                  <Input
                    placeholder="例如: python3"
                    value={formCommand}
                    onChange={(e) => setFormCommand(e.target.value)}
                  />
                  {editingScope === 'personal' && (
                    <p className="text-xs text-muted-foreground">仅允许: node, python3, npx, tsx, ts-node</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>命令参数（每行一个）</Label>
                  <Textarea
                    rows={3}
                    placeholder={`例如:\n/path/to/mcp_server.py`}
                    value={formArgs}
                    onChange={(e) => setFormArgs(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <Label>API 地址 <span className="text-destructive">*</span></Label>
                <Input
                  placeholder="例如: http://localhost:8080/mcp"
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>环境变量（每行 KEY=VALUE）</Label>
              <Textarea
                rows={3}
                placeholder={`例如:\nMYSQL_USER=root\nMYSQL_PASSWORD=secret`}
                value={formEnv}
                onChange={(e) => setFormEnv(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={formEnabled} onCheckedChange={setFormEnabled} id="mcp-enabled" />
              <Label htmlFor="mcp-enabled">启用</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>取消</Button>
            <Button onClick={handleSubmit}>{editingServer ? '更新' : '创建'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 测试结果 Dialog */}
      <Dialog open={testModalOpen} onOpenChange={setTestModalOpen}>
        <DialogContent className="max-w-[700px]">
          <DialogHeader>
            <DialogTitle>测试连接: {testServerName}</DialogTitle>
            <DialogDescription>检查 MCP Server 连接状态和可用工具</DialogDescription>
          </DialogHeader>

          {testLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              正在连接...
            </div>
          ) : testResult ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant={testResult.success ? 'default' : 'destructive'}>
                  {testResult.success ? '连接成功' : '连接失败'}
                </Badge>
                <span className="text-sm text-muted-foreground">{testResult.message}</span>
              </div>
              {testResult.tools.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">可用工具 ({testResult.tools.length})</h4>
                  {testResult.tools.map((tool, i) => (
                    <Card key={i}>
                      <CardContent className="p-3">
                        <div className="text-sm">
                          <span className="text-muted-foreground mr-2">名称:</span>
                          <code className="text-xs bg-muted px-1 py-0.5 rounded">{tool.name}</code>
                        </div>
                        <div className="text-sm mt-1">
                          <span className="text-muted-foreground mr-2">描述:</span>
                          {tool.description}
                        </div>
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

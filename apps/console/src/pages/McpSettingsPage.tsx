/**
 * MCP 设置页面
 *
 * 功能：
 * - 查看/管理企业级 MCP 工具（管理员可 CRUD）
 * - 管理个人 MCP Server（通过 PersonalMcpManager 共享组件）
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Pencil, Zap, Loader2, Wrench, Upload } from 'lucide-react';
import { adminApi, type McpServerInfo, type McpToolInfo } from '../api';
import { useAuthStore } from '../store';
import PersonalMcpManager from '@/components/PersonalMcpManager';

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
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServerInfo | null>(null);

  // 企业 MCP 表单状态
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formTransport, setFormTransport] = useState('stdio');
  const [formCommand, setFormCommand] = useState('');
  const [formArgs, setFormArgs] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formEnv, setFormEnv] = useState('');
  const [formEnabled, setFormEnabled] = useState(true);

  // 企业 MCP 项目上传
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const mcpUploadRef = useRef<HTMLInputElement>(null);

  // 企业 MCP 测试连接
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; tools: McpToolInfo[] } | null>(null);
  const [testServerName, setTestServerName] = useState('');

  const loadEnterpriseData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.getMcpServers();
      setEnterpriseServers(res.data.filter(s => s.scope === 'enterprise'));
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadEnterpriseData(); }, [loadEnterpriseData]);

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

  const openCreateModal = () => {
    setEditingServer(null);
    resetForm();
    setModalOpen(true);
  };

  const openEditModal = (server: McpServerInfo) => {
    setEditingServer(server);
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
      const data: Record<string, unknown> = {
        name: formName,
        description: formDescription || undefined,
        transport: formTransport,
        enabled: formEnabled,
        scope: 'enterprise',
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

      if (editingServer) {
        await adminApi.updateMcpServer(editingServer.id, data as Partial<McpServerInfo>);
        toast.success('企业 MCP 已更新');
      } else {
        await adminApi.createMcpServer(data as Partial<McpServerInfo>);
        toast.success('企业 MCP 已创建');
      }

      setModalOpen(false);
      loadEnterpriseData();
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message) toast.error(error.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除？')) return;
    try {
      await adminApi.deleteMcpServer(id);
      toast.success('已删除');
      loadEnterpriseData();
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(error.message);
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
    } catch (err: unknown) {
      const error = err as Error;
      setTestResult({ success: false, message: error.message, tools: [] });
    }
    setTestLoading(false);
  };

  const handleMcpUpload = async () => {
    const file = mcpUploadRef.current?.files?.[0];
    if (!file) {
      toast.error('请选择文件');
      return;
    }
    setUploadLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'mcp');
      if (formName.trim()) formData.append('name', formName.trim());

      const token = localStorage.getItem('admin_token');
      const res = await fetch('/api/tool-sources/upload', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || '上传失败');
      }
      const result = await res.json();
      toast.success(result.message || 'MCP 项目上传成功');
      setUploadModalOpen(false);
      if (mcpUploadRef.current) mcpUploadRef.current.value = '';
      setFormName('');
      loadEnterpriseData();
    } catch (err: unknown) {
      toast.error((err as Error).message || '上传失败');
    }
    setUploadLoading(false);
  };

  const renderEnterpriseTable = () => (
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
          ) : enterpriseServers.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                暂无企业级 MCP 工具
              </TableCell>
            </TableRow>
          ) : (
            enterpriseServers.map((server) => (
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
                    {isAdmin && (
                      <>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditModal(server)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(server.id)}>
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
          <TabsTrigger value="personal">我的工具</TabsTrigger>
        </TabsList>

        <TabsContent value="enterprise">
          {isAdmin && (
            <div className="flex justify-end mb-4 gap-2">
              <Button variant="outline" onClick={() => setUploadModalOpen(true)}>
                <Upload className="h-4 w-4 mr-1" />
                上传 MCP 项目
              </Button>
              <Button onClick={openCreateModal}>
                <Plus className="h-4 w-4 mr-1" />
                注册企业 MCP
              </Button>
            </div>
          )}
          {renderEnterpriseTable()}
        </TabsContent>

        <TabsContent value="personal">
          <PersonalMcpManager />
        </TabsContent>
      </Tabs>

      {/* 企业 MCP 新建/编辑 Dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              {editingServer ? '编辑企业 MCP' : '注册企业 MCP'}
            </DialogTitle>
            <DialogDescription>配置 MCP Server 的连接信息</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>名称 <span className="text-destructive">*</span></Label>
              <Input
                placeholder="例如: 数据库连接器"
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
                  <SelectItem value="http">http（远程服务）</SelectItem>
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

      {/* 企业 MCP 测试结果 Dialog */}
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

      {/* 企业 MCP 项目上传 Dialog */}
      <Dialog open={uploadModalOpen} onOpenChange={setUploadModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>上传 MCP 项目</DialogTitle>
            <DialogDescription>上传 zip/tar.gz 格式的 Python MCP 项目，需包含 requirements.txt 和 packages/ 离线依赖目录（.whl 或 .tar.gz 格式）</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>项目名称（可选，默认从文件名提取）</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="my-mcp-server" />
            </div>
            <div className="space-y-2">
              <Label>项目文件 (zip / tar.gz)</Label>
              <Input ref={mcpUploadRef} type="file" accept=".zip,.tar.gz,.tgz" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadModalOpen(false)}>取消</Button>
            <Button onClick={handleMcpUpload} disabled={uploadLoading}>
              {uploadLoading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              上传并安装
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

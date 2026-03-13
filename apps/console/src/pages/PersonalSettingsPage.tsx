/**
 * 个人设置页面
 *
 * 三个 Tab：
 * - Tab 1: 我的连接器（个人 MCP 服务器 CRUD）
 * - Tab 2: 我的技能（只读列表，展示所有可用技能）
 * - Tab 3: 个人信息（用户名/角色/部门 + 修改密码）
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus,
  Trash2,
  Pencil,
  Zap,
  Cable,
  User,
  Lock,
  Key,
  Upload,
  Loader2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { adminApi, type McpServerInfo, type McpToolInfo, type SkillInfo } from '../api';
import { useAuthStore } from '../store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

// ====================================
// Tab 1: 我的连接器（个人 MCP）
// ====================================

function PersonalMcpTab() {
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServerInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 表单字段
  const [fName, setFName] = useState('');
  const [fDescription, setFDescription] = useState('');
  const [fTransport, setFTransport] = useState<'stdio' | 'http'>('stdio');
  const [fCommand, setFCommand] = useState('');
  const [fArgs, setFArgs] = useState('');
  const [fUrl, setFUrl] = useState('');
  const [fEnv, setFEnv] = useState('');
  const [fEnabled, setFEnabled] = useState(true);

  // 上传 MCP 项目
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState('');
  const uploadInputRef = useRef<HTMLInputElement>(null);

  // 测试连接
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; tools: McpToolInfo[] } | null>(null);
  const [testServerName, setTestServerName] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.getPersonalMcpServers();
      setServers(res.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const resetForm = () => {
    setFName('');
    setFDescription('');
    setFTransport('stdio');
    setFCommand('');
    setFArgs('');
    setFUrl('');
    setFEnv('');
    setFEnabled(true);
  };

  const openCreateModal = () => {
    setEditingServer(null);
    resetForm();
    setModalOpen(true);
  };

  const openEditModal = (server: McpServerInfo) => {
    setEditingServer(server);
    setFName(server.name);
    setFDescription(server.description || '');
    setFTransport(server.transport);
    setFCommand(server.command || '');
    setFArgs(server.args ? server.args.join('\n') : '');
    setFUrl(server.url || '');
    setFEnv(server.env ? Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join('\n') : '');
    setFEnabled(server.enabled);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!fName) {
      toast.error('请输入名称');
      return;
    }
    if (fTransport === 'stdio' && !fCommand) {
      toast.error('请输入启动命令');
      return;
    }
    if (fTransport === 'http' && !fUrl) {
      toast.error('请输入 API 地址');
      return;
    }

    setSubmitting(true);
    try {
      const data: Record<string, unknown> = {
        name: fName,
        description: fDescription || undefined,
        transport: fTransport,
        enabled: fEnabled,
      };

      if (fTransport === 'stdio') {
        data.command = fCommand;
        data.args = fArgs ? fArgs.split('\n').map((s: string) => s.trim()).filter(Boolean) : [];
      } else {
        data.url = fUrl;
      }

      if (fEnv) {
        const envObj: Record<string, string> = {};
        fEnv.split('\n').forEach((line: string) => {
          const idx = line.indexOf('=');
          if (idx > 0) {
            envObj[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
          }
        });
        data.env = envObj;
      }

      if (editingServer) {
        await adminApi.updatePersonalMcpServer(editingServer.id, data as Partial<McpServerInfo>);
        toast.success('MCP 连接器已更新');
      } else {
        await adminApi.createPersonalMcpServer(data as Partial<McpServerInfo>);
        toast.success('MCP 连接器已创建');
      }

      setModalOpen(false);
      loadData();
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message) toast.error(error.message);
    }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此连接器？')) return;
    try {
      await adminApi.deletePersonalMcpServer(id);
      toast.success('已删除');
      loadData();
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

  const handleUpload = async () => {
    if (!uploadFile) {
      toast.warning('请先选择文件');
      return;
    }
    setUploading(true);
    try {
      const result = await adminApi.uploadPersonalMcpServer(uploadFile, uploadName || undefined);
      toast.success(`部署成功！入口文件: ${result.entryFile}，检测到 ${result.toolCount} 个工具`);
      setUploadModalOpen(false);
      setUploadFile(null);
      setUploadName('');
      loadData();
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(error.message || '上传部署失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <div className="flex justify-end gap-2 mb-4">
        <Button
          variant="outline"
          onClick={() => { setUploadFile(null); setUploadName(''); setUploadModalOpen(true); }}
        >
          <Upload className="h-4 w-4 mr-1" />
          上传 MCP 项目
        </Button>
        <Button onClick={openCreateModal}>
          <Plus className="h-4 w-4 mr-1" />
          添加连接器
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : servers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              暂无个人 MCP 连接器，点击右上角添加
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead className="w-[80px]">传输</TableHead>
                  <TableHead>命令</TableHead>
                  <TableHead className="w-[80px]">状态</TableHead>
                  <TableHead className="w-[180px]">操作</TableHead>
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
                      <Badge variant="outline">{server.transport}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      <code className="text-xs">
                        {server.transport === 'stdio'
                          ? `${server.command} ${server.args?.join(' ') || ''}`
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
                          <Zap className="h-3 w-3 mr-1" />
                          测试
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditModal(server)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(server.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 新建/编辑 Dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{editingServer ? '编辑连接器' : '添加连接器'}</DialogTitle>
            <DialogDescription>
              {editingServer ? '修改 MCP 连接器配置' : '添加新的 MCP 连接器'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>名称</Label>
              <Input placeholder="例如: 我的数据分析工具" value={fName} onChange={(e) => setFName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>描述</Label>
              <Input placeholder="简要描述工具用途" value={fDescription} onChange={(e) => setFDescription(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>传输协议</Label>
              <Select value={fTransport} onValueChange={(v) => setFTransport(v as 'stdio' | 'http')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stdio">stdio（本地进程）</SelectItem>
                  <SelectItem value="http">HTTP（远程服务）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {fTransport === 'stdio' ? (
              <>
                <div className="space-y-2">
                  <Label>启动命令</Label>
                  <Input placeholder="例如: python3" value={fCommand} onChange={(e) => setFCommand(e.target.value)} />
                  <p className="text-xs text-muted-foreground">仅允许: node, python3, npx, tsx, ts-node</p>
                </div>
                <div className="space-y-2">
                  <Label>命令参数（每行一个）</Label>
                  <Textarea
                    rows={3}
                    placeholder={`例如:\n/path/to/mcp_server.py`}
                    value={fArgs}
                    onChange={(e) => setFArgs(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <Label>API 地址</Label>
                <Input placeholder="例如: http://localhost:8080/mcp" value={fUrl} onChange={(e) => setFUrl(e.target.value)} />
              </div>
            )}
            <div className="space-y-2">
              <Label>环境变量（每行 KEY=VALUE）</Label>
              <Textarea
                rows={3}
                placeholder={`例如:\nMYSQL_USER=root\nMYSQL_PASSWORD=secret`}
                value={fEnv}
                onChange={(e) => setFEnv(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>启用</Label>
              <Switch checked={fEnabled} onCheckedChange={setFEnabled} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>取消</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {editingServer ? '更新' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 测试结果 Dialog */}
      <Dialog open={testModalOpen} onOpenChange={setTestModalOpen}>
        <DialogContent className="max-w-[700px]">
          <DialogHeader>
            <DialogTitle>测试连接: {testServerName}</DialogTitle>
            <DialogDescription>检查 MCP 服务器连接状态和可用工具</DialogDescription>
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
                <span className="text-sm">{testResult.message}</span>
              </div>
              {testResult.tools.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">可用工具 ({testResult.tools.length})</h4>
                  <div className="space-y-2">
                    {testResult.tools.map((tool, i) => (
                      <Card key={i}>
                        <CardContent className="p-3">
                          <div className="text-sm">
                            <span className="text-muted-foreground mr-2">名称:</span>
                            <code>{tool.name}</code>
                          </div>
                          <div className="text-sm mt-1">
                            <span className="text-muted-foreground mr-2">描述:</span>
                            {tool.description}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestModalOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 上传 MCP 项目 Dialog */}
      <Dialog open={uploadModalOpen} onOpenChange={(open) => { if (!uploading) setUploadModalOpen(open); }}>
        <DialogContent className="max-w-[520px]">
          <DialogHeader>
            <DialogTitle>上传 MCP 项目</DialogTitle>
            <DialogDescription>上传 Python MCP 项目压缩包进行部署</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>项目名称（可选）</Label>
              <Input
                placeholder="不填则从文件名自动提取"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                disabled={uploading}
              />
            </div>
            <div className="space-y-2">
              <Label>选择项目文件</Label>
              {uploadFile ? (
                <div className="flex items-center justify-between border rounded-md px-3 py-2">
                  <span className="text-sm truncate">{uploadFile.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setUploadFile(null)}
                    disabled={uploading}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <div
                  className="border-2 border-dashed rounded-md p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => uploadInputRef.current?.click()}
                >
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm">点击或拖拽文件到此区域</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    支持 .tar.gz / .zip 格式的 Python MCP 项目
                  </p>
                </div>
              )}
              <input
                ref={uploadInputRef}
                type="file"
                accept=".tar.gz,.tgz,.zip"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setUploadFile(file);
                  e.target.value = '';
                }}
              />
            </div>
            {uploading && (
              <div className="rounded-md bg-muted p-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <p className="text-sm text-muted-foreground">
                    后端正在解压项目、创建 Python 虚拟环境并安装依赖，此过程可能需要 30-60 秒...
                  </p>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadModalOpen(false)} disabled={uploading}>取消</Button>
            <Button onClick={handleUpload} disabled={!uploadFile || uploading}>
              {uploading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              上传并部署
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ====================================
// Tab 2: 我的技能（只读）
// ====================================

function PersonalSkillsTab() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.getSkills();
      setSkills(res.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const scopeLabel: Record<string, { text: string; variant: 'default' | 'secondary' | 'outline' }> = {
    enterprise: { text: '企业', variant: 'default' },
    personal: { text: '个人', variant: 'secondary' },
  };

  const statusLabel: Record<string, string> = {
    pending: '待审批',
    approved: '已通过',
    rejected: '已拒绝',
    active: '已激活',
    disabled: '已禁用',
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (skills.length === 0) {
    return <div className="text-center py-12 text-muted-foreground">暂无可用技能</div>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {skills.map((skill) => (
        <Card key={skill.id}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start justify-between mb-2">
              <span className="font-medium text-sm">{skill.name}</span>
              <div className="flex gap-1">
                <Badge variant={scopeLabel[skill.scope]?.variant || 'outline'}>
                  {scopeLabel[skill.scope]?.text || skill.scope}
                </Badge>
                <Badge variant={skill.enabled ? 'default' : 'secondary'}>
                  {skill.enabled ? '启用' : '禁用'}
                </Badge>
              </div>
            </div>
            {skill.description && (
              <p className="text-xs text-muted-foreground mb-2">{skill.description}</p>
            )}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {skill.version && <span>v{skill.version}</span>}
              <span>状态: {statusLabel[skill.status] || skill.status}</span>
              {skill.command && <span>命令: <code>{skill.command}</code></span>}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ====================================
// Tab 3: 个人信息
// ====================================

function ProfileTab() {
  const { user } = useAuthStore();
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const resetPasswordForm = () => {
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleChangePassword = async () => {
    if (!oldPassword) {
      toast.error('请输入当前密码');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      toast.error('新密码长度至少 6 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('两次输入的新密码不一致');
      return;
    }
    setPasswordLoading(true);
    try {
      await adminApi.changePassword(oldPassword, newPassword);
      toast.success('密码修改成功');
      setPasswordModalOpen(false);
      resetPasswordForm();
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(error.message || '密码修改失败');
    } finally {
      setPasswordLoading(false);
    }
  };

  const roleLabel: Record<string, string> = {
    ADMIN: '管理员',
    USER: '普通用户',
    admin: '管理员',
    user: '普通用户',
  };

  return (
    <div className="max-w-[600px] space-y-6">
      {/* 个人信息卡片 */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground w-[120px]">用户名</span>
              <span className="text-sm flex-1">{user?.username || '-'}</span>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground w-[120px]">邮箱</span>
              <span className="text-sm flex-1">{user?.email || '-'}</span>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground w-[120px]">部门</span>
              <span className="text-sm flex-1">{user?.department || '-'}</span>
            </div>
            <Separator />
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground w-[120px]">角色</span>
              <div className="flex gap-1 flex-1">
                {user?.roles?.map((r: string) => (
                  <Badge
                    key={r}
                    variant={r.toLowerCase() === 'admin' ? 'default' : 'secondary'}
                  >
                    {roleLabel[r] || r}
                  </Badge>
                )) || '-'}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 安全设置卡片 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="h-4 w-4" />
            安全设置
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">登录密码</p>
              <p className="text-xs text-muted-foreground">定期修改密码可以提高账号安全性</p>
            </div>
            <Button
              variant="outline"
              onClick={() => { resetPasswordForm(); setPasswordModalOpen(true); }}
            >
              <Key className="h-4 w-4 mr-1" />
              修改密码
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 修改密码 Dialog */}
      <Dialog open={passwordModalOpen} onOpenChange={setPasswordModalOpen}>
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle>修改密码</DialogTitle>
            <DialogDescription>请输入当前密码和新密码</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>当前密码</Label>
              <Input
                type="password"
                placeholder="请输入当前密码"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>新密码</Label>
              <Input
                type="password"
                placeholder="请输入新密码（至少 6 位）"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>确认新密码</Label>
              <Input
                type="password"
                placeholder="请再次输入新密码"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordModalOpen(false)}>取消</Button>
            <Button onClick={handleChangePassword} disabled={passwordLoading}>
              {passwordLoading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              确认修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ====================================
// 主组件
// ====================================

export default function PersonalSettingsPage() {
  return (
    <div>
      <h2 className="text-lg font-semibold flex items-center gap-2 mb-6">
        <User className="h-5 w-5" />
        个人设置
      </h2>

      <Tabs defaultValue="mcp">
        <TabsList>
          <TabsTrigger value="mcp" className="gap-1.5">
            <Cable className="h-3.5 w-3.5" />
            我的 MCP
          </TabsTrigger>
          <TabsTrigger value="skills" className="gap-1.5">
            <Zap className="h-3.5 w-3.5" />
            我的技能
          </TabsTrigger>
          <TabsTrigger value="profile" className="gap-1.5">
            <User className="h-3.5 w-3.5" />
            个人信息
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mcp" className="mt-4">
          <PersonalMcpTab />
        </TabsContent>
        <TabsContent value="skills" className="mt-4">
          <PersonalSkillsTab />
        </TabsContent>
        <TabsContent value="profile" className="mt-4">
          <ProfileTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

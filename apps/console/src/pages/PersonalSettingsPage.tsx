/**
 * 个人设置页面
 *
 * 三个 Tab：
 * - Tab 1: 我的连接器（个人 MCP 服务器 CRUD，使用 PersonalMcpManager 共享组件）
 * - Tab 2: 我的技能（只读列表，展示所有可用技能）
 * - Tab 3: 个人信息（用户名/角色/部门 + 修改密码）
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Zap,
  Cable,
  User,
  Lock,
  Key,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { adminApi, type SkillInfo } from '../api';
import { useAuthStore } from '../store';
import PersonalMcpManager from '@/components/PersonalMcpManager';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';

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
          <PersonalMcpManager />
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

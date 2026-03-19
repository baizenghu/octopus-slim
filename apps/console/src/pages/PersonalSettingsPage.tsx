/**
 * 个人设置页面
 *
 * 三个 Tab：
 * - Tab 1: 我的连接器（个人 MCP 服务器 CRUD，使用 PersonalMcpManager 共享组件）
 * - Tab 2: 我的技能（只读列表，展示所有可用技能）
 * - Tab 3: 个人信息（用户名/角色/部门 + 修改密码）
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  User,
  Lock,
  Key,
  Loader2,
  Camera,
} from 'lucide-react';
import { toast } from 'sonner';
import { adminApi } from '../api';
import { useAuthStore } from '../store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';

// ====================================
// 个人信息
// ====================================

function ProfileTab() {
  const { user } = useAuthStore();
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // 加载用户头像 URL
  useEffect(() => {
    if (user?.id) {
      setAvatarUrl(adminApi.getUserAvatarUrl(user.id) + `?t=${Date.now()}`);
    }
  }, [user?.id]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error('头像文件不能超过 2MB');
      return;
    }
    setAvatarUploading(true);
    try {
      await adminApi.uploadUserAvatar(file);
      // 刷新头像显示（加时间戳破缓存）
      setAvatarUrl(adminApi.getUserAvatarUrl(user!.id) + `?t=${Date.now()}`);
      toast.success('头像已更新');
    } catch (err: unknown) {
      const error = err as Error;
      toast.error(error.message || '头像上传失败');
    } finally {
      setAvatarUploading(false);
      // 重置 input 以允许重复上传相同文件
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

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
      {/* 头像卡片 */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-6">
            <div className="relative group">
              <Avatar className="h-20 w-20">
                <AvatarImage
                  src={avatarUrl || undefined}
                  alt={user?.username}
                  onError={() => setAvatarUrl(null)}
                />
                <AvatarFallback className="text-2xl bg-primary/10 text-primary font-medium">
                  {user?.username?.charAt(0)?.toUpperCase() || 'U'}
                </AvatarFallback>
              </Avatar>
              <button
                className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                onClick={() => avatarInputRef.current?.click()}
                disabled={avatarUploading}
              >
                {avatarUploading ? (
                  <Loader2 className="h-5 w-5 text-white animate-spin" />
                ) : (
                  <Camera className="h-5 w-5 text-white" />
                )}
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleAvatarUpload}
              />
            </div>
            <div>
              <p className="font-medium">{user?.username || '-'}</p>
              <p className="text-sm text-muted-foreground">{user?.email || '-'}</p>
              <p className="text-xs text-muted-foreground mt-1">
                点击头像上传新图片（限 2MB，支持 PNG/JPG/WebP）
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

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

      <ProfileTab />
    </div>
  );
}

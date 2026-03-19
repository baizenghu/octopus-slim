/**
 * 用户管理页面 — 列表 + CRUD
 */
import { useEffect, useState } from 'react';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { adminApi, type UserInfo } from '../api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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

const ROLE_OPTIONS = [
  { label: '管理员', value: 'ADMIN' },
  { label: '高级用户', value: 'POWER_USER' },
];

interface FormValues {
  username: string;
  password: string;
  email: string;
  displayName: string;
  department: string;
  roles: string[];
  status: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  // 创建/编辑弹窗
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserInfo | null>(null);
  const [formValues, setFormValues] = useState<FormValues>({
    username: '', password: '', email: '', displayName: '', department: '', roles: ['POWER_USER'], status: 'active',
  });

  // 删除确认弹窗
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingUser, setDeletingUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    loadUsers();
  }, [page, pageSize]);

  const loadUsers = async (searchOverride?: string) => {
    setLoading(true);
    try {
      const result = await adminApi.getUsers({ page, pageSize, search: searchOverride ?? search });
      setUsers(result.data);
      setTotal(result.total);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setPage(1);
    loadUsers();
  };

  const openCreateModal = () => {
    setEditingUser(null);
    setFormValues({ username: '', password: '', email: '', displayName: '', department: '', roles: ['POWER_USER'], status: 'active' });
    setModalOpen(true);
  };

  const openEditModal = (user: UserInfo) => {
    setEditingUser(user);
    setFormValues({
      username: user.username,
      password: '',
      email: user.email,
      displayName: user.displayName || '',
      department: user.department || '',
      roles: user.roles,
      status: user.status,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!formValues.username || !formValues.email) {
      toast.error('请填写用户名和邮箱');
      return;
    }
    if (!editingUser && !formValues.password) {
      toast.error('请设置密码');
      return;
    }
    try {
      if (editingUser) {
        const { password: _p, ...rest } = formValues;
        await adminApi.updateUser(editingUser.userId, rest);
        toast.success('用户已更新');
      } else {
        await adminApi.createUser(formValues);
        toast.success('用户已创建');
      }
      setModalOpen(false);
      loadUsers();
    } catch (err: any) {
      if (err.message) toast.error(err.message);
    }
  };

  const confirmDelete = (user: UserInfo) => {
    setDeletingUser(user);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingUser) return;
    try {
      await adminApi.deleteUser(deletingUser.userId);
      toast.success('用户已删除');
      setDeleteDialogOpen(false);
      loadUsers();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const roleColorMap: Record<string, string> = {
    ADMIN: 'bg-red-100 text-red-700',
    POWER_USER: 'bg-yellow-100 text-yellow-700',
    USER: 'bg-blue-100 text-blue-700',
  };

  const toggleRole = (role: string) => {
    setFormValues((prev) => {
      const roles = prev.roles.includes(role)
        ? prev.roles.filter((r) => r !== role)
        : [...prev.roles, role];
      return { ...prev, roles };
    });
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">用户管理</h2>

      <Card>
        <CardContent className="pt-6">
          {/* 工具栏 */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="搜索用户名/邮箱/部门"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  className="pl-9 w-72"
                />
              </div>
              <Button variant="outline" onClick={handleSearch}>搜索</Button>
            </div>
            <Button onClick={openCreateModal}>
              <Plus className="h-4 w-4 mr-1" />
              创建用户
            </Button>
          </div>

          {/* 表格 */}
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用户名</TableHead>
                  <TableHead>邮箱</TableHead>
                  <TableHead>显示名</TableHead>
                  <TableHead>部门</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>最近登录</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.userId}>
                    <TableCell className="font-medium">{user.username}</TableCell>
                    <TableCell className="text-sm truncate max-w-[200px]">{user.email}</TableCell>
                    <TableCell className="text-sm">{user.displayName || '-'}</TableCell>
                    <TableCell className="text-sm">{user.department || '-'}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {user.roles?.map((r) => (
                          <Badge key={r} className={roleColorMap[r] || 'bg-gray-100 text-gray-700'}>{r}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={user.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}>
                        {user.status === 'active' ? '活跃' : '禁用'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('zh-CN') : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEditModal(user)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => confirmDelete(user)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">暂无用户</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}

          {/* 分页 */}
          {total > 0 && (
            <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
              <span>共 {total} 条</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
                <span>{page} / {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 创建/编辑弹窗 */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingUser ? '编辑用户' : '创建用户'}</DialogTitle>
            <DialogDescription>
              {editingUser ? '修改用户信息' : '填写新用户信息'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>用户名 *</Label>
              <Input
                disabled={!!editingUser}
                placeholder="用户名（创建后不可修改）"
                value={formValues.username}
                onChange={(e) => setFormValues({ ...formValues, username: e.target.value })}
              />
            </div>
            {!editingUser && (
              <div className="space-y-2">
                <Label>密码 *</Label>
                <Input
                  type="password"
                  placeholder="登录密码"
                  value={formValues.password}
                  onChange={(e) => setFormValues({ ...formValues, password: e.target.value })}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>邮箱 *</Label>
              <Input
                placeholder="user@example.com"
                value={formValues.email}
                onChange={(e) => setFormValues({ ...formValues, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>显示名</Label>
              <Input
                placeholder="显示名称"
                value={formValues.displayName}
                onChange={(e) => setFormValues({ ...formValues, displayName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>部门</Label>
              <Input
                placeholder="所属部门"
                value={formValues.department}
                onChange={(e) => setFormValues({ ...formValues, department: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>角色 *</Label>
              <div className="flex flex-wrap gap-2">
                {ROLE_OPTIONS.map((opt) => (
                  <Badge
                    key={opt.value}
                    className={`cursor-pointer ${formValues.roles.includes(opt.value) ? roleColorMap[opt.value] : 'bg-gray-100 text-gray-400'}`}
                    onClick={() => toggleRole(opt.value)}
                  >
                    {opt.label}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>状态</Label>
              <Select value={formValues.status} onValueChange={(v) => setFormValues({ ...formValues, status: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">活跃</SelectItem>
                  <SelectItem value="disabled">禁用</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>取消</Button>
            <Button onClick={handleSubmit}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认弹窗 */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确认删除用户 <span className="font-semibold">{deletingUser?.username}</span>？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={handleDelete}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

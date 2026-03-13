/**
 * 数据库配置页面
 *
 * 功能：
 * - 查看/创建/编辑/删除数据库连接
 */
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Database, Loader2 } from 'lucide-react';
import { adminApi, type DatabaseConnectionInfo } from '../api';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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

const DB_TYPE_OPTIONS = [
  { label: 'MySQL', value: 'mysql' },
  { label: 'PostgreSQL', value: 'postgres' },
  { label: 'SQLite', value: 'sqlite' },
];

const DB_TYPE_VARIANTS: Record<string, 'default' | 'secondary' | 'outline'> = {
  mysql: 'default',
  postgres: 'secondary',
  sqlite: 'outline',
};

const DEFAULT_PORTS: Record<string, number> = {
  mysql: 3306,
  postgres: 5432,
  sqlite: 0,
};

export default function DatabaseConfigPage() {
  const [connections, setConnections] = useState<DatabaseConnectionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DatabaseConnectionInfo | null>(null);

  // 表单状态
  const [formName, setFormName] = useState('');
  const [formDbType, setFormDbType] = useState('mysql');
  const [formHost, setFormHost] = useState('');
  const [formPort, setFormPort] = useState('3306');
  const [formDbUser, setFormDbUser] = useState('');
  const [formDbPassword, setFormDbPassword] = useState('');
  const [formDbName, setFormDbName] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.getDbConnections();
      setConnections(res.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const resetForm = () => {
    setFormName('');
    setFormDbType('mysql');
    setFormHost('');
    setFormPort('3306');
    setFormDbUser('');
    setFormDbPassword('');
    setFormDbName('');
  };

  const openCreate = () => {
    setEditing(null);
    resetForm();
    setModalOpen(true);
  };

  const openEdit = (record: DatabaseConnectionInfo) => {
    setEditing(record);
    setFormName(record.name);
    setFormDbType(record.dbType);
    setFormHost(record.host);
    setFormPort(String(record.port));
    setFormDbUser(record.dbUser);
    setFormDbPassword('');
    setFormDbName(record.dbName);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!formName.trim()) { toast.error('请输入连接名称'); return; }
    if (!formHost.trim()) { toast.error('请输入主机地址'); return; }
    if (!formDbUser.trim()) { toast.error('请输入用户名'); return; }
    if (!editing && !formDbPassword) { toast.error('请输入密码'); return; }
    if (!formDbName.trim()) { toast.error('请输入数据库名'); return; }

    try {
      const values = {
        name: formName,
        dbType: formDbType,
        host: formHost,
        port: parseInt(formPort) || 3306,
        dbUser: formDbUser,
        dbPassword: formDbPassword || undefined,
        dbName: formDbName,
      };
      if (editing) {
        const data: Record<string, unknown> = { ...values };
        if (!data.dbPassword) delete data.dbPassword;
        await adminApi.updateDbConnection(editing.id, data as Partial<DatabaseConnectionInfo>);
        toast.success('连接已更新');
      } else {
        await adminApi.createDbConnection(values);
        toast.success('连接已创建');
      }
      setModalOpen(false);
      loadData();
    } catch (err: unknown) {
      if (err instanceof Error && err.message) toast.error(err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除此连接？删除后 AI 助手将无法访问该数据库。')) return;
    try {
      await adminApi.deleteDbConnection(id);
      toast.success('已删除');
      loadData();
    } catch (err: unknown) {
      if (err instanceof Error) toast.error(err.message);
    }
  };

  const handleTypeChange = (val: string) => {
    setFormDbType(val);
    setFormPort(String(DEFAULT_PORTS[val] || 3306));
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Database className="h-5 w-5" />
          数据库配置
        </h2>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />
          新增连接
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>连接名称</TableHead>
              <TableHead className="w-24">类型</TableHead>
              <TableHead>主机</TableHead>
              <TableHead>数据库</TableHead>
              <TableHead>用户名</TableHead>
              <TableHead className="w-20">状态</TableHead>
              <TableHead className="w-28">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : connections.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  暂无数据库连接，点击右上角新增
                </TableCell>
              </TableRow>
            ) : (
              connections.map((conn) => (
                <TableRow key={conn.id}>
                  <TableCell className="font-medium">{conn.name}</TableCell>
                  <TableCell>
                    <Badge variant={DB_TYPE_VARIANTS[conn.dbType] || 'outline'}>{conn.dbType}</Badge>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs">{conn.host}:{conn.port}</code>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs">{conn.dbName}</code>
                  </TableCell>
                  <TableCell>{conn.dbUser}</TableCell>
                  <TableCell>
                    <Badge variant={conn.enabled ? 'default' : 'secondary'}>
                      {conn.enabled ? '启用' : '禁用'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(conn)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(conn.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑连接' : '新增连接'}</DialogTitle>
            <DialogDescription>配置数据库连接信息</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>连接名称 <span className="text-destructive">*</span></Label>
              <Input
                placeholder="salary"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                disabled={!!editing}
              />
              <p className="text-xs text-muted-foreground">用于标识连接，如 salary、crm、inventory</p>
            </div>

            <div className="space-y-2">
              <Label>数据库类型 <span className="text-destructive">*</span></Label>
              <Select value={formDbType} onValueChange={handleTypeChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DB_TYPE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-3">
              <div className="flex-1 space-y-2">
                <Label>主机 <span className="text-destructive">*</span></Label>
                <Input
                  placeholder="192.168.1.10"
                  value={formHost}
                  onChange={(e) => setFormHost(e.target.value)}
                />
              </div>
              <div className="w-28 space-y-2">
                <Label>端口 <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  min={0}
                  max={65535}
                  value={formPort}
                  onChange={(e) => setFormPort(e.target.value)}
                />
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1 space-y-2">
                <Label>用户名 <span className="text-destructive">*</span></Label>
                <Input
                  placeholder="root"
                  value={formDbUser}
                  onChange={(e) => setFormDbUser(e.target.value)}
                />
              </div>
              <div className="flex-1 space-y-2">
                <Label>密码 {!editing && <span className="text-destructive">*</span>}</Label>
                <Input
                  type="password"
                  placeholder={editing ? '留空不修改' : '请输入密码'}
                  value={formDbPassword}
                  onChange={(e) => setFormDbPassword(e.target.value)}
                />
                {editing && <p className="text-xs text-muted-foreground">留空则不修改</p>}
              </div>
            </div>

            <div className="space-y-2">
              <Label>数据库名 <span className="text-destructive">*</span></Label>
              <Input
                placeholder="my_database"
                value={formDbName}
                onChange={(e) => setFormDbName(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>取消</Button>
            <Button onClick={handleSubmit}>{editing ? '更新' : '创建'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * 审计日志页面 — 查询 + 导出 + 归档
 */
import { useEffect, useState } from 'react';
import {
  Search,
  Download,
  Archive,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { adminApi, type AuditRecord } from '../api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';

const ACTION_OPTIONS = [
  { label: '全部', value: '__all__' },
  { label: '登录', value: 'auth:login' },
  { label: '登录失败', value: 'auth:login_failed' },
  { label: '登出', value: 'auth:logout' },
  { label: '发送消息', value: 'session:message' },
  { label: '工具调用', value: 'tool:execute' },
  { label: '审计导出', value: 'audit:export' },
  { label: '审计归档', value: 'audit:archive' },
];

const actionColorMap: Record<string, string> = {
  'auth:login': 'bg-green-100 text-green-700',
  'auth:login_failed': 'bg-red-100 text-red-700',
  'auth:logout': 'bg-orange-100 text-orange-700',
  'session:message': 'bg-blue-100 text-blue-700',
  'tool:execute': 'bg-purple-100 text-purple-700',
};

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);

  // 筛选条件
  const [userId, setUserId] = useState('');
  const [action, setAction] = useState('__all__');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // 归档确认
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);

  useEffect(() => {
    loadLogs();
  }, [offset]);

  const buildFilters = () => {
    const f: any = { limit, offset };
    if (userId) f.userId = userId;
    if (action && action !== '__all__') f.action = action;
    if (startDate) f.startTime = new Date(startDate).toISOString();
    if (endDate) f.endTime = new Date(endDate).toISOString();
    return f;
  };

  const loadLogs = async () => {
    setLoading(true);
    try {
      const result = await adminApi.getAuditLogs(buildFilters());
      setLogs(result.data);
      setTotal(result.total);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setOffset(0);
    loadLogs();
  };

  const handleExport = async (format: 'csv' | 'json') => {
    try {
      const blob = await adminApi.exportAuditLogs(buildFilters(), format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-export-${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`已导出 ${format.toUpperCase()} 文件`);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleArchive = async () => {
    try {
      const result = await adminApi.archiveAuditLogs();
      toast.success(`已归档 ${result.archivedCount} 条记录`);
      setArchiveDialogOpen(false);
      loadLogs();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">审计日志</h2>

      <Card>
        <CardContent className="pt-6">
          {/* 筛选栏 */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Input
              placeholder="用户ID"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-40"
            />
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="操作类型" />
              </SelectTrigger>
              <SelectContent>
                {ACTION_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="datetime-local"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-48"
              placeholder="开始时间"
            />
            <Input
              type="datetime-local"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-48"
              placeholder="结束时间"
            />
            <Button onClick={handleSearch}>
              <Search className="h-4 w-4 mr-1" />
              搜索
            </Button>
            <Button variant="outline" onClick={() => handleExport('csv')}>
              <Download className="h-4 w-4 mr-1" />
              CSV
            </Button>
            <Button variant="outline" onClick={() => handleExport('json')}>
              <Download className="h-4 w-4 mr-1" />
              JSON
            </Button>
            <Button variant="destructive" onClick={() => setArchiveDialogOpen(true)}>
              <Archive className="h-4 w-4 mr-1" />
              归档
            </Button>
          </div>

          {/* 表格 */}
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[170px]">时间</TableHead>
                  <TableHead className="w-[130px]">用户</TableHead>
                  <TableHead className="w-[140px]">操作</TableHead>
                  <TableHead className="w-[200px]">资源</TableHead>
                  <TableHead className="w-[80px]">状态</TableHead>
                  <TableHead className="w-[130px]">IP</TableHead>
                  <TableHead className="w-[90px]">耗时</TableHead>
                  <TableHead className="w-[200px]">错误</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.logId}>
                    <TableCell className="text-sm">{new Date(log.createdAt).toLocaleString('zh-CN')}</TableCell>
                    <TableCell className="text-sm truncate max-w-[130px]">{log.username || log.userId || '-'}</TableCell>
                    <TableCell>
                      <Badge className={actionColorMap[log.action] || 'bg-gray-100 text-gray-700'}>{log.action}</Badge>
                    </TableCell>
                    <TableCell className="text-sm truncate max-w-[200px]">{log.resource}</TableCell>
                    <TableCell>
                      {log.success ? (
                        <Badge className="bg-green-100 text-green-700">成功</Badge>
                      ) : (
                        <Badge variant="destructive">失败</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{log.ipAddress}</TableCell>
                    <TableCell className="text-sm">{log.durationMs ? `${log.durationMs}ms` : '-'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">{log.errorMessage || '-'}</TableCell>
                  </TableRow>
                ))}
                {logs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">暂无审计日志</TableCell>
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
                <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setOffset((currentPage - 2) * limit)}>上一页</Button>
                <span>{currentPage} / {totalPages}</span>
                <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setOffset(currentPage * limit)}>下一页</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 归档确认弹窗 */}
      <Dialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认归档</DialogTitle>
            <DialogDescription>
              将把超过保留天数的日志压缩归档并从数据库中删除，此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveDialogOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={handleArchive}>确认归档</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

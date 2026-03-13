/**
 * 系统信息页面
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { adminApi } from '../api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export default function SystemPage() {
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHealth();
  }, []);

  const loadHealth = async () => {
    setLoading(true);
    try {
      const data = await adminApi.getHealth();
      setHealth(data);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !health) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold">系统信息</h2>
        <Card>
          <CardHeader><Skeleton className="h-5 w-32" /></CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-32" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  const statusItems = [
    {
      label: '服务状态',
      value: health.status === 'ok' ? (
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          <Badge className="bg-green-100 text-green-700">运行中</Badge>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-red-500" />
          <Badge variant="destructive">异常</Badge>
        </div>
      ),
    },
    {
      label: '版本',
      value: <span className="text-sm">{health.version || '-'}</span>,
    },
    {
      label: 'AI 模型',
      value: <Badge variant="secondary" className="bg-blue-100 text-blue-700">{health.model || '-'}</Badge>,
    },
    {
      label: 'Mock LDAP',
      value: health.mockLdap ? (
        <Badge className="bg-orange-100 text-orange-700">开发模式</Badge>
      ) : (
        <Badge className="bg-green-100 text-green-700">生产模式</Badge>
      ),
    },
    {
      label: '审计数据库',
      value: health.auditDatabase ? (
        <Badge className="bg-green-100 text-green-700">已启用</Badge>
      ) : (
        <Badge variant="outline">未启用</Badge>
      ),
    },
    {
      label: '服务器时间',
      value: <span className="text-sm">{new Date(health.timestamp).toLocaleString('zh-CN')}</span>,
    },
  ];

  const techStack = [
    { label: '运行时', value: 'Node.js' },
    { label: 'Web 框架', value: 'Express' },
    { label: '数据库 ORM', value: 'Prisma' },
    { label: '数据库', value: 'MySQL' },
    { label: '日志框架', value: 'Winston + Daily Rotate' },
    { label: '认证方式', value: 'LDAP + JWT' },
    { label: '前端框架', value: 'React 18 + shadcn/ui' },
    { label: '包管理', value: 'pnpm Monorepo' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">系统信息</h2>
        <Button variant="outline" size="sm" onClick={loadHealth}>
          <RefreshCw className="h-4 w-4 mr-1" />
          刷新
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">服务状态</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            {statusItems.map((item) => (
              <div key={item.label} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <span className="text-sm text-muted-foreground">{item.label}</span>
                {item.value}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">技术栈信息</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            {techStack.map((item) => (
              <div key={item.label} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <span className="text-sm text-muted-foreground">{item.label}</span>
                <span className="text-sm font-medium">{item.value}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

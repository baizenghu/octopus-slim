/**
 * 仪表盘页面 — 系统概览 + 模块统计 + 趋势图 + 操作分布
 */
import { useEffect, useState } from 'react';
import {
  Users,
  Zap,
  FileText,
  Calendar,
  Plug,
  Bot,
  Clock,
} from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import { toast } from 'sonner';
import { adminApi, type DashboardData, type AuditRecord } from '../api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [recentLogs, setRecentLogs] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const [dashData, logsData] = await Promise.all([
        adminApi.getDashboard(),
        adminApi.getAuditLogs({ limit: 10, offset: 0 }),
      ]);
      setData(dashData);
      setRecentLogs(logsData.data);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold">仪表盘</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // 趋势图配置（亮色主题）
  const trendOption = {
    tooltip: { trigger: 'axis' as const },
    grid: { left: 40, right: 20, top: 20, bottom: 30 },
    xAxis: {
      type: 'category' as const,
      data: data.dailyTrend.map((d) => d.date.slice(5)),
      axisLabel: { color: '#6b7280' },
      axisLine: { lineStyle: { color: '#e5e7eb' } },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: { color: '#6b7280' },
      splitLine: { lineStyle: { color: '#f3f4f6' } },
    },
    series: [
      {
        name: '审计事件',
        type: 'line',
        data: data.dailyTrend.map((d) => d.count),
        smooth: true,
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(59, 130, 246, 0.2)' },
              { offset: 1, color: 'rgba(59, 130, 246, 0.02)' },
            ],
          },
        },
        lineStyle: { color: '#3b82f6', width: 2 },
        itemStyle: { color: '#3b82f6' },
      },
    ],
  };

  // 操作分布饼图
  const distEntries = Object.entries(data.actionDistribution)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8);

  const pieOption = {
    tooltip: { trigger: 'item' as const },
    series: [
      {
        type: 'pie',
        radius: ['40%', '70%'],
        center: ['50%', '50%'],
        data: distEntries.map(([name, value]) => ({
          name: name.replace(/^[a-z]+:/, ''),
          value,
        })),
        label: { color: '#6b7280', fontSize: 12 },
        emphasis: {
          itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0, 0, 0, 0.15)' },
        },
      },
    ],
  };

  const statCards = [
    { title: '总用户数', value: data.totalUsers, icon: Users, color: 'text-blue-600' },
    { title: '活跃用户', value: data.activeUsers, icon: Zap, color: 'text-green-600' },
    { title: '今日审计事件', value: data.todayAuditCount, icon: FileText, color: 'text-orange-500' },
    { title: '本周审计事件', value: data.weekAuditCount, icon: Calendar, color: 'text-purple-600' },
  ];

  const moduleCards = [
    { title: 'MCP 服务器', value: data.enabledMcpServers, total: data.totalMcpServers, icon: Plug, color: 'text-teal-600' },
    { title: 'Skills 技能', value: data.enabledSkills, total: data.totalSkills, icon: Zap, color: 'text-violet-600' },
    { title: 'Agent 总数', value: data.totalAgents, total: undefined, icon: Bot, color: 'text-blue-600' },
    { title: '心跳巡检', value: data.enabledScheduledTasks, total: data.totalScheduledTasks, icon: Clock, color: 'text-red-500' },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">仪表盘</h2>

      {/* 用户 & 审计统计 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
              <card.icon className={`h-4 w-4 ${card.color}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${card.color}`}>{card.value.toLocaleString()}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 模块统计 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {moduleCards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
              <card.icon className={`h-4 w-4 ${card.color}`} />
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-1">
                <span className={`text-2xl font-bold ${card.color}`}>{card.value}</span>
                {card.total !== undefined && (
                  <span className="text-sm text-muted-foreground">/ {card.total}</span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 图表 */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">审计事件趋势（近7天）</CardTitle>
          </CardHeader>
          <CardContent>
            <ReactECharts option={trendOption} style={{ height: 280 }} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">操作类型分布</CardTitle>
          </CardHeader>
          <CardContent>
            <ReactECharts option={pieOption} style={{ height: 280 }} />
          </CardContent>
        </Card>
      </div>

      {/* 最近日志 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">最近审计日志</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">时间</TableHead>
                <TableHead className="w-[120px]">用户</TableHead>
                <TableHead className="w-[140px]">操作</TableHead>
                <TableHead className="w-[180px]">资源</TableHead>
                <TableHead className="w-[80px]">状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentLogs.map((log) => (
                <TableRow key={log.logId}>
                  <TableCell className="text-sm">{new Date(log.createdAt).toLocaleString('zh-CN')}</TableCell>
                  <TableCell className="text-sm truncate max-w-[120px]">{log.userId}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="bg-blue-100 text-blue-700">{log.action}</Badge>
                  </TableCell>
                  <TableCell className="text-sm truncate max-w-[180px]">{log.resource}</TableCell>
                  <TableCell>
                    {log.success ? (
                      <Badge className="bg-green-100 text-green-700">成功</Badge>
                    ) : (
                      <Badge variant="destructive">失败</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {recentLogs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    暂无审计日志
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * 系统配置管理页面（Admin Only）
 * 4 个 Tab：模型管理 / 插件配置 / 安全与工具 / 运行参数
 */
import { useState, useEffect, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { adminApi } from '../api';
import SystemConfigModels from './SystemConfigModels';
import SystemConfigPlugins from './SystemConfigPlugins';
import SystemConfigTools from './SystemConfigTools';
import SystemConfigRuntime from './SystemConfigRuntime';

export default function SystemConfigPage() {
  const [config, setConfig] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const { config: c } = await adminApi.getSystemConfig();
      setConfig(c);
    } catch (err: any) {
      toast.error('加载配置失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  if (loading || !config) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold">系统配置</h2>
        <Card><CardContent className="pt-6 space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">系统配置</h2>
      <Tabs defaultValue="models">
        <TabsList>
          <TabsTrigger value="models">模型管理</TabsTrigger>
          <TabsTrigger value="plugins">插件配置</TabsTrigger>
          <TabsTrigger value="tools">安全与工具</TabsTrigger>
          <TabsTrigger value="runtime">运行参数</TabsTrigger>
        </TabsList>
        <TabsContent value="models">
          <SystemConfigModels config={config} onSaved={loadConfig} />
        </TabsContent>
        <TabsContent value="plugins">
          <SystemConfigPlugins config={config} onSaved={loadConfig} />
        </TabsContent>
        <TabsContent value="tools">
          <SystemConfigTools config={config} onSaved={loadConfig} />
        </TabsContent>
        <TabsContent value="runtime">
          <SystemConfigRuntime config={config} onSaved={loadConfig} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

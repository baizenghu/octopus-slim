/**
 * 系统配置 Tab 3：安全与工具
 * - Loop Detection 阈值
 * - 沙箱配置
 * - 文件系统隔离
 */
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { adminApi } from '../api';

interface Props {
  config: Record<string, any>;
  onSaved: () => void;
}

export default function SystemConfigTools({ config, onSaved }: Props) {
  const tools = config.tools || {};
  const agentDefaults = config.agents?.defaults || {};

  // Loop Detection
  const [loopEnabled, setLoopEnabled] = useState(tools.loopDetection?.enabled !== false);
  const [warningThreshold, setWarningThreshold] = useState(tools.loopDetection?.warningThreshold || 8);
  const [criticalThreshold, setCriticalThreshold] = useState(tools.loopDetection?.criticalThreshold || 15);
  const [globalBreaker, setGlobalBreaker] = useState(tools.loopDetection?.globalCircuitBreakerThreshold || 25);

  // Exec
  const [execHost, setExecHost] = useState(tools.exec?.host || 'sandbox');

  // FS
  const [workspaceOnly, setWorkspaceOnly] = useState(tools.fs?.workspaceOnly !== false);

  // Sandbox defaults
  const [sandboxMode, setSandboxMode] = useState(agentDefaults.sandbox?.mode || 'all');
  const [dockerImage, setDockerImage] = useState(agentDefaults.sandbox?.docker?.image || 'octopus-sandbox:enterprise');

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    // 验证阈值递增
    if (warningThreshold >= criticalThreshold || criticalThreshold >= globalBreaker) {
      toast.error('阈值必须递增：警告 < 临界 < 熔断');
      return;
    }

    setSaving(true);
    try {
      await adminApi.updateToolsConfig({
        loopDetection: {
          enabled: loopEnabled,
          warningThreshold,
          criticalThreshold,
          globalCircuitBreakerThreshold: globalBreaker,
        },
        exec: { host: execHost },
        fs: { workspaceOnly },
        agentsDefaults: {
          sandbox: {
            mode: sandboxMode,
            docker: { image: dockerImage },
          },
        },
      } as any);

      toast.success('工具配置已保存');
      onSaved();
    } catch (err: any) {
      toast.error('保存失败: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 mt-4">
      {/* Loop Detection */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">死循环检测</CardTitle>
              <CardDescription>检测 Agent 工具调用陷入循环的保护机制</CardDescription>
            </div>
            <Switch checked={loopEnabled} onCheckedChange={setLoopEnabled} />
          </div>
        </CardHeader>
        {loopEnabled && (
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">警告阈值</label>
                <Input type="number" min="1" value={warningThreshold} onChange={(e) => setWarningThreshold(parseInt(e.target.value) || 8)} />
                <p className="text-xs text-muted-foreground mt-1">连续失败 N 次后警告</p>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">临界阈值</label>
                <Input type="number" min="1" value={criticalThreshold} onChange={(e) => setCriticalThreshold(parseInt(e.target.value) || 15)} />
                <p className="text-xs text-muted-foreground mt-1">连续失败 N 次后阻断</p>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">熔断阈值</label>
                <Input type="number" min="1" value={globalBreaker} onChange={(e) => setGlobalBreaker(parseInt(e.target.value) || 25)} />
                <p className="text-xs text-muted-foreground mt-1">连续失败 N 次后终止会话</p>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* 执行隔离 */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">执行隔离</CardTitle>
          <CardDescription>Agent 命令执行的隔离策略</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">执行宿主</label>
              <Select value={execHost} onValueChange={setExecHost}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sandbox">Docker 沙箱 (sandbox)</SelectItem>
                  <SelectItem value="gateway">直接执行 (gateway)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">文件系统隔离</label>
              <div className="flex items-center gap-2 h-10">
                <Switch checked={workspaceOnly} onCheckedChange={setWorkspaceOnly} />
                <span className="text-sm">{workspaceOnly ? '仅工作空间' : '全文件系统'}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 沙箱默认配置 */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">沙箱默认配置</CardTitle>
          <CardDescription>所有 Agent 的默认沙箱参数（可被单个 Agent 覆盖）</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">沙箱模式</label>
              <Select value={sandboxMode} onValueChange={setSandboxMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部沙箱 (all)</SelectItem>
                  <SelectItem value="none">不使用沙箱 (none)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Docker 镜像</label>
              <Input value={dockerImage} onChange={(e) => setDockerImage(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            注：sandbox.tools.allow 固定为 ["*"]（不可更改），确保插件工具正常注册
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存工具配置'}</Button>
      </div>
    </div>
  );
}

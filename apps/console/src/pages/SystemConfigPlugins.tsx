/**
 * 系统配置 Tab 2：插件配置
 * 3 张 Card：memory-lancedb-pro / enterprise-audit / enterprise-mcp
 */
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { adminApi } from '../api';

interface Props {
  config: Record<string, any>;
  onSaved: () => void;
}

// 辅助组件：标签+输入
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium mb-1 block">{label}</label>
      {children}
    </div>
  );
}

export default function SystemConfigPlugins({ config, onSaved }: Props) {
  const plugins = config.plugins || {};
  const entries: Record<string, any> = plugins.entries || {};

  // 深拷贝 entries 用于编辑（仅修改 config，不改 enabled/allow）
  const [editEntries, setEditEntries] = useState<Record<string, any>>(() => JSON.parse(JSON.stringify(entries)));
  const [saving, setSaving] = useState(false);

  const updateEntry = (pluginName: string, path: string, value: any) => {
    const updated = JSON.parse(JSON.stringify(editEntries));
    if (!updated[pluginName]) updated[pluginName] = { enabled: false, config: {} };
    if (!updated[pluginName].config) updated[pluginName].config = {};
    const parts = path.split('.');
    let obj = updated[pluginName].config;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]]) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
    setEditEntries(updated);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await adminApi.updatePluginsConfig({
        entries: editEntries,
      });
      toast.success('插件配置已保存');
      onSaved();
    } catch (err: any) {
      toast.error('保存失败: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const getEntry = (name: string) => editEntries[name] || { enabled: false, config: {} };
  const getConfig = (name: string) => getEntry(name).config || {};

  return (
    <div className="space-y-6 mt-4">
      {/* memory-lancedb-pro */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg">memory-lancedb-pro</CardTitle>
              <Badge variant="outline">记忆引擎</Badge>
            </div>
            <Badge variant="secondary" className="text-xs">运行中</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Embedding 配置 */}
          <div className="text-sm font-medium text-muted-foreground">Embedding 嵌入服务</div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="API Key">
              <Input value={getConfig('memory-lancedb-pro').embedding?.apiKey || ''} onChange={(e) => updateEntry('memory-lancedb-pro', 'embedding.apiKey', e.target.value)} />
            </Field>
            <Field label="模型">
              <Input value={getConfig('memory-lancedb-pro').embedding?.model || ''} onChange={(e) => updateEntry('memory-lancedb-pro', 'embedding.model', e.target.value)} />
            </Field>
            <Field label="Base URL">
              <Input value={getConfig('memory-lancedb-pro').embedding?.baseURL || ''} onChange={(e) => updateEntry('memory-lancedb-pro', 'embedding.baseURL', e.target.value)} />
            </Field>
            <Field label="向量维度">
              <Input type="number" value={getConfig('memory-lancedb-pro').embedding?.dimensions || 1024} onChange={(e) => updateEntry('memory-lancedb-pro', 'embedding.dimensions', parseInt(e.target.value) || 1024)} />
            </Field>
          </div>

          <Separator />

          {/* LLM 配置（智能提取） */}
          <div className="text-sm font-medium text-muted-foreground">LLM 智能提取</div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="API Key">
              <Input value={getConfig('memory-lancedb-pro').llm?.apiKey || ''} onChange={(e) => updateEntry('memory-lancedb-pro', 'llm.apiKey', e.target.value)} />
            </Field>
            <Field label="模型">
              <Input value={getConfig('memory-lancedb-pro').llm?.model || ''} onChange={(e) => updateEntry('memory-lancedb-pro', 'llm.model', e.target.value)} />
            </Field>
            <Field label="Base URL">
              <Input value={getConfig('memory-lancedb-pro').llm?.baseURL || ''} onChange={(e) => updateEntry('memory-lancedb-pro', 'llm.baseURL', e.target.value)} />
            </Field>
          </div>

          <Separator />

          {/* 检索配置 */}
          <div className="text-sm font-medium text-muted-foreground">检索策略</div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="检索模式">
              <Select value={getConfig('memory-lancedb-pro').retrieval?.mode || 'hybrid'} onValueChange={(v) => updateEntry('memory-lancedb-pro', 'retrieval.mode', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hybrid">混合检索 (hybrid)</SelectItem>
                  <SelectItem value="vector">向量检索 (vector)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="重排策略">
              <Select value={getConfig('memory-lancedb-pro').retrieval?.rerank || 'cross-encoder'} onValueChange={(v) => updateEntry('memory-lancedb-pro', 'retrieval.rerank', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cross-encoder">cross-encoder</SelectItem>
                  <SelectItem value="lightweight">lightweight</SelectItem>
                  <SelectItem value="none">none</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="重排服务商">
              <Input value={getConfig('memory-lancedb-pro').retrieval?.rerankProvider || ''} onChange={(e) => updateEntry('memory-lancedb-pro', 'retrieval.rerankProvider', e.target.value)} />
            </Field>
          </div>

          <Separator />

          {/* 自动化开关 */}
          <div className="text-sm font-medium text-muted-foreground">自动化</div>
          <div className="flex gap-8">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={getConfig('memory-lancedb-pro').autoCapture !== false}
                onCheckedChange={(v) => updateEntry('memory-lancedb-pro', 'autoCapture', v)}
              />
              自动捕获记忆
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={getConfig('memory-lancedb-pro').autoRecall !== false}
                onCheckedChange={(v) => updateEntry('memory-lancedb-pro', 'autoRecall', v)}
              />
              自动回忆
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={getConfig('memory-lancedb-pro').smartExtraction !== false}
                onCheckedChange={(v) => updateEntry('memory-lancedb-pro', 'smartExtraction', v)}
              />
              智能提取
            </label>
          </div>

          {/* 高级参数折叠 */}
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
                <ChevronDown className="h-4 w-4" />高级参数
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <Field label="向量权重">
                  <Input type="number" step="0.1" min="0" max="1" value={getConfig('memory-lancedb-pro').retrieval?.vectorWeight ?? 0.7} onChange={(e) => updateEntry('memory-lancedb-pro', 'retrieval.vectorWeight', parseFloat(e.target.value))} />
                </Field>
                <Field label="BM25 权重">
                  <Input type="number" step="0.1" min="0" max="1" value={getConfig('memory-lancedb-pro').retrieval?.bm25Weight ?? 0.3} onChange={(e) => updateEntry('memory-lancedb-pro', 'retrieval.bm25Weight', parseFloat(e.target.value))} />
                </Field>
                <Field label="最低分数阈值">
                  <Input type="number" step="0.05" min="0" max="1" value={getConfig('memory-lancedb-pro').retrieval?.hardMinScore ?? 0.3} onChange={(e) => updateEntry('memory-lancedb-pro', 'retrieval.hardMinScore', parseFloat(e.target.value))} />
                </Field>
                <Field label="候选池大小">
                  <Input type="number" min="10" max="100" value={getConfig('memory-lancedb-pro').retrieval?.candidatePoolSize ?? 20} onChange={(e) => updateEntry('memory-lancedb-pro', 'retrieval.candidatePoolSize', parseInt(e.target.value))} />
                </Field>
                <Field label="时间衰减半衰期 (天)">
                  <Input type="number" min="1" max="365" value={getConfig('memory-lancedb-pro').retrieval?.recencyHalfLifeDays ?? 14} onChange={(e) => updateEntry('memory-lancedb-pro', 'retrieval.recencyHalfLifeDays', parseInt(e.target.value))} />
                </Field>
                <Field label="时间衰减权重">
                  <Input type="number" step="0.05" min="0" max="0.5" value={getConfig('memory-lancedb-pro').retrieval?.recencyWeight ?? 0.1} onChange={(e) => updateEntry('memory-lancedb-pro', 'retrieval.recencyWeight', parseFloat(e.target.value))} />
                </Field>
                <Field label="回忆 TopK">
                  <Input type="number" min="1" max="20" value={getConfig('memory-lancedb-pro').autoRecallTopK ?? 3} onChange={(e) => updateEntry('memory-lancedb-pro', 'autoRecallTopK', parseInt(e.target.value))} />
                </Field>
                <Field label="DB 路径">
                  <Input value={getConfig('memory-lancedb-pro').dbPath || ''} onChange={(e) => updateEntry('memory-lancedb-pro', 'dbPath', e.target.value)} />
                </Field>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* enterprise-audit */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg">enterprise-audit</CardTitle>
              <Badge variant="outline">审计日志</Badge>
            </div>
            <Badge variant="secondary" className="text-xs">运行中</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <Field label="数据库连接">
              <Input value={getConfig('enterprise-audit').databaseUrl || ''} onChange={(e) => updateEntry('enterprise-audit', 'databaseUrl', e.target.value)} />
            </Field>
            <Field label="日志目录">
              <Input value={getConfig('enterprise-audit').logDir || ''} onChange={(e) => updateEntry('enterprise-audit', 'logDir', e.target.value)} />
            </Field>
            <Field label="保留天数">
              <Input type="number" min="1" max="365" value={getConfig('enterprise-audit').retentionDays || 30} onChange={(e) => updateEntry('enterprise-audit', 'retentionDays', parseInt(e.target.value))} />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* enterprise-mcp */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg">enterprise-mcp</CardTitle>
              <Badge variant="outline">工具协议</Badge>
            </div>
            <Badge variant="secondary" className="text-xs">运行中</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <Field label="数据库连接">
              <Input value={getConfig('enterprise-mcp').databaseUrl || ''} onChange={(e) => updateEntry('enterprise-mcp', 'databaseUrl', e.target.value)} />
            </Field>
            <Field label="数据目录">
              <Input value={getConfig('enterprise-mcp').dataRoot || ''} onChange={(e) => updateEntry('enterprise-mcp', 'dataRoot', e.target.value)} />
            </Field>
          </div>
          <div className="text-sm font-medium text-muted-foreground mt-4 mb-2">沙箱资源限制</div>
          <div className="grid grid-cols-4 gap-4">
            <Field label="MCP 内存">
              <Input value={getConfig('enterprise-mcp').sandbox?.mcp?.memory || '256m'} onChange={(e) => updateEntry('enterprise-mcp', 'sandbox.mcp.memory', e.target.value)} />
            </Field>
            <Field label="MCP CPU">
              <Input value={getConfig('enterprise-mcp').sandbox?.mcp?.cpus || '0.5'} onChange={(e) => updateEntry('enterprise-mcp', 'sandbox.mcp.cpus', e.target.value)} />
            </Field>
            <Field label="Skill 内存">
              <Input value={getConfig('enterprise-mcp').sandbox?.skill?.memory || '512m'} onChange={(e) => updateEntry('enterprise-mcp', 'sandbox.skill.memory', e.target.value)} />
            </Field>
            <Field label="Skill CPU">
              <Input value={getConfig('enterprise-mcp').sandbox?.skill?.cpus || '1'} onChange={(e) => updateEntry('enterprise-mcp', 'sandbox.skill.cpus', e.target.value)} />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* 保存按钮 */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存插件配置'}</Button>
      </div>
    </div>
  );
}

/**
 * 系统配置 Tab 1：模型管理
 * - Provider 表格：CRUD
 * - 默认模型选择（primary + fallbacks）
 */
import { useState, useMemo, useEffect, Fragment } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { adminApi } from '../api';

interface Props {
  config: Record<string, any>;
  onSaved: () => void;
}

interface ModelEntry {
  id: string;
  name: string;
  [key: string]: unknown;
}

interface ProviderConfig {
  baseUrl: string;
  apiKey?: string;
  api: string;
  models: ModelEntry[];
  compat?: Record<string, unknown>;
}

export default function SystemConfigModels({ config, onSaved }: Props) {
  const providers = (config.models?.providers || {}) as Record<string, ProviderConfig>;
  const defaultModel = config.agents?.defaults?.model || { primary: '', fallbacks: [] };

  // Provider 编辑状态
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null); // null = 新增
  const [formProviderId, setFormProviderId] = useState('');
  const [formBaseUrl, setFormBaseUrl] = useState('');
  const [formApiKey, setFormApiKey] = useState('');
  const [formApi, setFormApi] = useState('openai-completions');
  const [formModels, setFormModels] = useState<ModelEntry[]>([]);

  // 默认模型（config 更新时同步）
  const [primary, setPrimary] = useState(defaultModel.primary || '');
  const [fallbacks, setFallbacks] = useState<string[]>(defaultModel.fallbacks || []);

  useEffect(() => {
    const dm = config.agents?.defaults?.model || { primary: '', fallbacks: [] };
    setPrimary(dm.primary || '');
    setFallbacks(dm.fallbacks || []);
  }, [config]);

  // 展开行（显示模型列表）
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  // 所有可用模型的 flat list（provider/modelId 格式）
  const allModels = useMemo(() => {
    const result: { value: string; label: string }[] = [];
    for (const [pid, p] of Object.entries(providers)) {
      for (const m of (p.models || [])) {
        result.push({ value: `${pid}/${m.id}`, label: `${pid}/${m.name || m.id}` });
      }
    }
    return result;
  }, [providers]);

  const openCreate = () => {
    setEditId(null);
    setFormProviderId('');
    setFormBaseUrl('');
    setFormApiKey('');
    setFormApi('openai-completions');
    setFormModels([{ id: '', name: '' }]);
    setEditOpen(true);
  };

  const openEdit = (id: string) => {
    const p = providers[id];
    if (!p) return;
    setEditId(id);
    setFormProviderId(id);
    setFormBaseUrl(p.baseUrl || '');
    setFormApiKey(p.apiKey || '');
    setFormApi(p.api || 'openai-completions');
    setFormModels(p.models?.length ? [...p.models] : [{ id: '', name: '' }]);
    setEditOpen(true);
  };

  const handleSaveProvider = async () => {
    if (!formProviderId.trim()) {
      toast.error('Provider ID 不能为空');
      return;
    }
    if (!formBaseUrl.trim()) {
      toast.error('Base URL 不能为空');
      return;
    }
    // 过滤空模型
    const models = formModels.filter(m => m.id.trim());
    if (models.length === 0) {
      toast.error('至少需要一个模型');
      return;
    }

    setSaving(true);
    try {
      const newProviders = { ...providers };

      // 若修改了 Provider ID，删除旧 key
      if (editId && editId !== formProviderId) {
        delete newProviders[editId];
      }

      newProviders[formProviderId] = {
        baseUrl: formBaseUrl.trim(),
        apiKey: formApiKey.trim() || undefined,
        api: formApi,
        models,
        // 保留已有 compat
        ...(editId && providers[editId]?.compat ? { compat: providers[editId].compat } : {}),
      };

      await adminApi.updateModelsConfig({
        providers: newProviders,
        defaults: { model: { primary, fallbacks } },
      });
      toast.success('模型配置已保存');
      setEditOpen(false);
      onSaved();
    } catch (err: any) {
      toast.error('保存失败: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProvider = async (id: string) => {
    if (!confirm(`确定删除 Provider "${id}"？`)) return;
    setSaving(true);
    try {
      const newProviders = { ...providers };
      delete newProviders[id];
      await adminApi.updateModelsConfig({
        providers: newProviders,
        defaults: { model: { primary, fallbacks } },
      });
      toast.success(`Provider "${id}" 已删除`);
      onSaved();
    } catch (err: any) {
      toast.error('删除失败: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDefaults = async () => {
    if (!primary) {
      toast.error('请选择主模型');
      return;
    }
    setSaving(true);
    try {
      await adminApi.updateModelsConfig({
        providers,
        defaults: { model: { primary, fallbacks: fallbacks.filter(Boolean) } },
      });
      toast.success('默认模型已保存');
      onSaved();
    } catch (err: any) {
      toast.error('保存失败: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const addModelRow = () => setFormModels([...formModels, { id: '', name: '' }]);
  const removeModelRow = (idx: number) => setFormModels(formModels.filter((_, i) => i !== idx));
  const updateModelRow = (idx: number, field: 'id' | 'name', value: string) => {
    const updated = [...formModels];
    updated[idx] = { ...updated[idx], [field]: value };
    setFormModels(updated);
  };

  return (
    <div className="space-y-6 mt-4">
      {/* Provider 列表 */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">模型 Provider</CardTitle>
            <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" />添加 Provider</Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Provider ID</TableHead>
                <TableHead>API 类型</TableHead>
                <TableHead>Base URL</TableHead>
                <TableHead>API Key</TableHead>
                <TableHead>模型数</TableHead>
                <TableHead className="w-24">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(providers).map(([id, p]) => (
                <Fragment key={id}>
                  <TableRow className="cursor-pointer" onClick={() => setExpandedProvider(expandedProvider === id ? null : id)}>
                    <TableCell>
                      {expandedProvider === id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </TableCell>
                    <TableCell className="font-medium">{id}</TableCell>
                    <TableCell><Badge variant="outline">{p.api}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{p.baseUrl}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[120px] truncate">{p.apiKey || '-'}</TableCell>
                    <TableCell>{p.models?.length || 0}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); openEdit(id); }}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleDeleteProvider(id); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {expandedProvider === id && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-muted/30 p-4">
                        <div className="text-sm font-medium mb-2">模型列表</div>
                        <div className="space-y-1">
                          {p.models?.map((m) => (
                            <div key={m.id} className="flex gap-4 text-sm">
                              <span className="font-mono">{m.id}</span>
                              <span className="text-muted-foreground">{m.name}</span>
                            </div>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
              {Object.keys(providers).length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">暂无 Provider</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 默认模型 */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">全局默认模型</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">主模型 (Primary)</label>
              <Select value={primary} onValueChange={setPrimary}>
                <SelectTrigger><SelectValue placeholder="选择主模型" /></SelectTrigger>
                <SelectContent>
                  {allModels.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">备用模型 (Fallbacks)</label>
              <Select value={fallbacks[0] || '__none__'} onValueChange={(v) => setFallbacks(v === '__none__' ? [] : [v])}>
                <SelectTrigger><SelectValue placeholder="选择备用模型（可选）" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">无</SelectItem>
                  {allModels.filter(m => m.value !== primary).map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSaveDefaults} disabled={saving}>保存默认模型</Button>
          </div>
        </CardContent>
      </Card>

      {/* Provider 编辑 Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? `编辑 Provider: ${editId}` : '添加 Provider'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Provider ID</label>
              <Input value={formProviderId} onChange={(e) => setFormProviderId(e.target.value)} placeholder="如 deepseek, openai-codex" disabled={!!editId} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">API 类型</label>
              <Select value={formApi} onValueChange={setFormApi}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai-completions">openai-completions</SelectItem>
                  <SelectItem value="openai-codex-responses">openai-codex-responses</SelectItem>
                  <SelectItem value="anthropic">anthropic</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Base URL</label>
              <Input value={formBaseUrl} onChange={(e) => setFormBaseUrl(e.target.value)} placeholder="https://api.deepseek.com/v1" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">API Key</label>
              <Input value={formApiKey} onChange={(e) => setFormApiKey(e.target.value)} placeholder="sk-..." />
            </div>
            <Separator />
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">模型列表</label>
                <Button variant="outline" size="sm" onClick={addModelRow}><Plus className="h-3 w-3 mr-1" />添加模型</Button>
              </div>
              <div className="space-y-2">
                {formModels.map((m, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <Input className="flex-1" value={m.id} onChange={(e) => updateModelRow(idx, 'id', e.target.value)} placeholder="模型 ID (如 deepseek-chat)" />
                    <Input className="flex-1" value={m.name} onChange={(e) => updateModelRow(idx, 'name', e.target.value)} placeholder="显示名称" />
                    {formModels.length > 1 && (
                      <Button variant="ghost" size="icon" onClick={() => removeModelRow(idx)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
            <Button onClick={handleSaveProvider} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

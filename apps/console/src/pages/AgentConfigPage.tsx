/**
 * Agent 配置页面 -- SOUL.md / USER.md 编辑
 *
 * 通过 tab 切换，支持在线编辑、下载、上传多个配置文件。
 */
import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Download, Upload, Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { adminApi, type AgentInfo } from '../api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface AgentConfigPageProps {
  agent: AgentInfo;
  onBack: () => void;
}

const CONFIG_TABS = ['SOUL.md', 'USER.md'] as const;
type ConfigTab = typeof CONFIG_TABS[number];

export default function AgentConfigPage({ agent, onBack }: AgentConfigPageProps) {
  const [activeTab, setActiveTab] = useState<ConfigTab>('SOUL.md');
  // 每个 tab 独立跟踪内容
  const [contents, setContents] = useState<Record<ConfigTab, string>>({ 'SOUL.md': '', 'USER.md': '' });
  const [originals, setOriginals] = useState<Record<ConfigTab, string>>({ 'SOUL.md': '', 'USER.md': '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const agentDisplayName = agent.identity?.name || agent.name;

  const content = contents[activeTab];
  const originalContent = originals[activeTab];

  const setContent = (text: string) => {
    setContents(prev => ({ ...prev, [activeTab]: text }));
  };

  // 加载所有配置文件
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await adminApi.getAgentConfig(agent.id);
        if (!cancelled) {
          const next: Record<ConfigTab, string> = { 'SOUL.md': '', 'USER.md': '' };
          for (const tab of CONFIG_TABS) {
            const f = res.files?.find((f: { name: string }) => f.name === tab);
            next[tab] = f?.content || '';
          }
          setContents(next);
          setOriginals(next);
        }
      } catch (err: any) {
        if (!cancelled) toast.error(err.message || '加载配置失败');
      }
      if (!cancelled) setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [agent.id]);

  const hasChanges = content !== originalContent;

  // 保存
  const handleSave = async () => {
    setSaving(true);
    try {
      await adminApi.updateAgentConfig(agent.id, activeTab, content);
      setOriginals(prev => ({ ...prev, [activeTab]: content }));
      toast.success(`${activeTab} 已保存`);
    } catch (err: any) {
      toast.error(err.message || '保存失败');
    }
    setSaving(false);
  };

  // 下载
  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${agent.name}-${activeTab}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 上传
  const handleUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === 'string') {
        setContent(text);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center pt-32">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">加载配置中...</span>
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto">
      {/* 顶部导航 */}
      <div className="flex items-center mb-4">
        <Button
          variant="ghost"
          size="sm"
          className="mr-3 text-muted-foreground"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          返回
        </Button>
        <h2 className="text-lg font-semibold">
          Agent 配置 - {agentDisplayName}
        </h2>
      </div>

      <Card>
        <CardContent className="pt-6">
          {/* Tab 切换 */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ConfigTab)} className="mb-4">
            <TabsList>
              {CONFIG_TABS.map((tab) => {
                const tabChanged = contents[tab] !== originals[tab];
                return (
                  <TabsTrigger key={tab} value={tab}>
                    {tab}{tabChanged ? ' *' : ''}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>

          {/* 工具栏 */}
          <div className="flex gap-2 mb-4">
            <Button
              variant={hasChanges ? 'default' : 'outline'}
              size="sm"
              disabled={!hasChanges || saving}
              onClick={handleSave}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              保存
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-1" />
              下载
            </Button>
            <Button variant="outline" size="sm" onClick={handleUpload}>
              <Upload className="h-4 w-4 mr-1" />
              上传
            </Button>
          </div>

          {/* 编辑器 */}
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="font-mono text-sm min-h-[400px] resize-y"
            placeholder={`在此编辑 ${activeTab}...`}
          />
        </CardContent>
      </Card>

      {/* 隐藏的文件上传 input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.txt"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}

/**
 * Agent 配置页面 -- SOUL.md 编辑
 *
 * 直接展示 SOUL.md 内容的编辑器，支持在线编辑、下载、上传。
 */
import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Download, Upload, Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { adminApi, type AgentInfo } from '../api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

interface AgentConfigPageProps {
  agent: AgentInfo;
  onBack: () => void;
}

export default function AgentConfigPage({ agent, onBack }: AgentConfigPageProps) {
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const agentDisplayName = agent.identity?.name || agent.name;

  // 加载 SOUL.md 内容
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await adminApi.getAgentConfig(agent.id);
        const soulFile = res.files?.find((f: { name: string }) => f.name === 'SOUL.md');
        const text = soulFile?.content || '';
        if (!cancelled) {
          setContent(text);
          setOriginalContent(text);
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
      await adminApi.updateAgentConfig(agent.id, 'SOUL.md', content);
      setOriginalContent(content);
      toast.success('SOUL.md 已保存');
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
    a.download = `${agent.name}-SOUL.md`;
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
            placeholder="在此编辑 SOUL.md..."
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

/**
 * 文件管理页面 — 按 Agent 分组展示
 *
 * 存储布局：
 * - 文件存储在 agent workspace 下: agents/{name}/workspace/files|outputs|temp/
 * - 按 agent 分组展示，可折叠
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import {
  FolderOpen, Upload, Download, Trash2, Eye, Loader2,
  FileText, FileImage, FileCode, File, FolderArchive, Bot,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { adminApi, type FileInfo } from '../api';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

const TEXT_EXTS = new Set([
  'txt', 'md', 'csv', 'json', 'xml', 'yaml', 'yml', 'toml',
  'py', 'js', 'ts', 'css', 'sql', 'sh', 'log', 'jsonl',
]);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'bmp', 'webp']);
const PDF_EXTS = new Set(['pdf']);
const HTML_EXTS = new Set(['html']);

type PreviewType = 'text' | 'image' | 'pdf' | 'html' | null;

function getPreviewType(name: string): PreviewType {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (TEXT_EXTS.has(ext)) return 'text';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (PDF_EXTS.has(ext)) return 'pdf';
  if (HTML_EXTS.has(ext)) return 'html';
  return null;
}

function getPreviewUrl(agent: string, dir: string, fileName: string): string {
  const token = localStorage.getItem('admin_token');
  return `/api/files/download/${encodeURIComponent(agent)}/${dir}/${encodeURIComponent(fileName)}?preview=true&token=${encodeURIComponent(token || '')}`;
}

function getLanguage(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    py: 'python', js: 'javascript', ts: 'typescript', css: 'css',
    sql: 'sql', sh: 'bash', json: 'json', xml: 'xml', yaml: 'yaml',
    yml: 'yaml', md: 'markdown', csv: 'csv', html: 'html',
  };
  return langMap[ext] || 'text';
}

function getFileIcon(name: string, isDir: boolean) {
  if (isDir) return <FolderOpen className="h-4 w-4 text-yellow-600" />;
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (IMAGE_EXTS.has(ext)) return <FileImage className="h-4 w-4 text-purple-600" />;
  if (['py', 'js', 'ts', 'css', 'sql', 'sh'].includes(ext)) return <FileCode className="h-4 w-4 text-blue-600" />;
  if (['zip', 'tar', 'gz'].includes(ext)) return <FolderArchive className="h-4 w-4 text-orange-600" />;
  if (TEXT_EXTS.has(ext) || PDF_EXTS.has(ext)) return <FileText className="h-4 w-4 text-gray-600" />;
  return <File className="h-4 w-4 text-gray-500" />;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 按 agent 分组文件 */
function groupByAgent(files: FileInfo[]): { agent: string; files: FileInfo[] }[] {
  const map = new Map<string, FileInfo[]>();
  for (const f of files) {
    const agent = f.agent || 'default';
    if (!map.has(agent)) map.set(agent, []);
    map.get(agent)!.push(f);
  }
  // default 排第一，其余按名称排序
  const groups = Array.from(map.entries()).map(([agent, files]) => ({ agent, files }));
  groups.sort((a, b) => {
    if (a.agent === 'default') return -1;
    if (b.agent === 'default') return 1;
    return a.agent.localeCompare(b.agent);
  });
  return groups;
}

export default function FilesPage() {
  const [activeTab, setActiveTab] = useState<'files' | 'outputs'>('files');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [collapsedAgents, setCollapsedAgents] = useState<Set<string>>(new Set());

  // 预览状态
  const [previewFile, setPreviewFile] = useState<FileInfo | null>(null);
  const [previewType, setPreviewType] = useState<PreviewType>(null);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.listFiles(activeTab);
      setFiles(res.files);
    } catch { setFiles([]); }
    setLoading(false);
  }, [activeTab]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const toggleAgent = (agent: string) => {
    setCollapsedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return next;
    });
  };

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      for (let i = 0; i < fileList.length; i++) {
        await adminApi.uploadFile(fileList[i]);
      }
      toast.success('上传完成');
      loadFiles();
    } catch (err: any) {
      toast.error(`上传失败: ${err.message}`);
    }
    setUploading(false);
  };

  const handleDownload = (file: FileInfo) => {
    const agent = file.agent || 'default';
    const token = localStorage.getItem('admin_token');
    const url = `/api/files/download/${encodeURIComponent(agent)}/${activeTab}/${encodeURIComponent(file.name)}?token=${encodeURIComponent(token || '')}`;
    window.open(url, '_blank');
  };

  const handleDelete = async (file: FileInfo) => {
    if (!confirm(`确定删除 ${file.name}？`)) return;
    const agent = file.agent || 'default';
    try {
      await adminApi.deleteFile(`${encodeURIComponent(agent)}/${activeTab}/${encodeURIComponent(file.name)}`);
      toast.success('已删除');
      loadFiles();
    } catch (err: any) {
      toast.error(`删除失败: ${err.message}`);
    }
  };

  const handlePreview = async (file: FileInfo) => {
    const type = getPreviewType(file.name);
    if (!type) return;
    setPreviewFile(file);
    setPreviewType(type);
    setPreviewContent('');
    if (type === 'text') {
      setPreviewLoading(true);
      try {
        const url = getPreviewUrl(file.agent || 'default', activeTab, file.name);
        const res = await fetch(url);
        if (!res.ok) throw new Error('加载失败');
        const text = await res.text();
        setPreviewContent(text.length > 512000 ? text.slice(0, 512000) + '\n\n... (文件过大，已截断)' : text);
      } catch { setPreviewContent('加载失败'); }
      setPreviewLoading(false);
    }
  };

  const closePreview = () => { setPreviewFile(null); setPreviewType(null); setPreviewContent(''); };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  };

  const groups = groupByAgent(files);
  const totalFiles = files.length;

  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
        <FolderOpen className="h-5 w-5" />
        文件管理
      </h2>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'files' | 'outputs')}>
        <TabsList>
          <TabsTrigger value="files" className="gap-1">
            <FolderOpen className="h-3.5 w-3.5" />
            我的文件
          </TabsTrigger>
          <TabsTrigger value="outputs" className="gap-1">
            <Bot className="h-3.5 w-3.5" />
            AI 生成
          </TabsTrigger>
        </TabsList>

        <TabsContent value="files">
          {/* 上传工具栏 */}
          <div
            className={`mt-3 mb-4 flex items-center gap-3 p-3 rounded-lg border-2 border-dashed transition-colors ${
              dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-muted-foreground/50'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors text-sm font-medium">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? '上传中...' : '上传文件'}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => handleUpload(e.target.files)}
                disabled={uploading}
              />
            </label>
            <span className="text-sm text-muted-foreground">或将文件拖拽到此处</span>
          </div>
          {renderGroupedFiles(groups, totalFiles, loading, activeTab, collapsedAgents, toggleAgent, handlePreview, handleDownload, handleDelete)}
        </TabsContent>

        <TabsContent value="outputs">
          {renderGroupedFiles(groups, totalFiles, loading, activeTab, collapsedAgents, toggleAgent, handlePreview, handleDownload, handleDelete)}
        </TabsContent>
      </Tabs>

      {/* 文件预览 Dialog */}
      <Dialog open={!!previewFile} onOpenChange={(open) => { if (!open) closePreview(); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {previewFile && getFileIcon(previewFile.name, false)}
              <span>{previewFile?.name}</span>
              {previewFile?.agent && (
                <Badge variant="secondary" className="ml-1 text-xs">{previewFile.agent}</Badge>
              )}
              {previewType === 'text' && previewFile && (
                <Badge variant="outline" className="ml-2 text-xs">{getLanguage(previewFile.name)}</Badge>
              )}
            </DialogTitle>
            <DialogDescription className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => previewFile && handleDownload(previewFile)}>
                <Download className="h-3.5 w-3.5 mr-1" />
                下载
              </Button>
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-auto">
            {previewType === 'text' && (
              previewLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <pre className="p-4 bg-muted rounded-md text-xs leading-relaxed overflow-auto max-h-[60vh]">
                  <code>{previewContent}</code>
                </pre>
              )
            )}
            {previewType === 'image' && previewFile && (
              <div className="flex items-center justify-center p-4">
                <img
                  src={getPreviewUrl(previewFile.agent || 'default', activeTab, previewFile.name)}
                  alt={previewFile.name}
                  className="max-w-full max-h-[60vh] object-contain rounded-md"
                />
              </div>
            )}
            {(previewType === 'pdf' || previewType === 'html') && previewFile && (
              <iframe
                src={getPreviewUrl(previewFile.agent || 'default', activeTab, previewFile.name)}
                className="w-full h-[60vh] rounded-md border"
                title={previewFile.name}
                {...(previewType === 'html' ? { sandbox: 'allow-scripts' } : {})}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function renderGroupedFiles(
  groups: { agent: string; files: FileInfo[] }[],
  totalFiles: number,
  loading: boolean,
  activeTab: string,
  collapsedAgents: Set<string>,
  toggleAgent: (agent: string) => void,
  handlePreview: (file: FileInfo) => void,
  handleDownload: (file: FileInfo) => void,
  handleDelete: (file: FileInfo) => void,
) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (totalFiles === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        {activeTab === 'files' ? '还没有上传文件' : '还没有 AI 生成的文件'}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map(({ agent, files }) => {
        const collapsed = collapsedAgents.has(agent);
        return (
          <div key={agent} className="rounded-md border">
            {/* Agent 分组头 */}
            <div
              className="flex items-center gap-2 px-4 py-2.5 bg-muted/50 cursor-pointer hover:bg-muted/80 transition-colors"
              onClick={() => toggleAgent(agent)}
            >
              {collapsed
                ? <ChevronRight className="h-4 w-4 text-muted-foreground" />
                : <ChevronDown className="h-4 w-4 text-muted-foreground" />
              }
              <Bot className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">{agent}</span>
              <Badge variant="outline" className="text-xs ml-1">{files.length} 个文件</Badge>
            </div>

            {/* 文件列表 */}
            {!collapsed && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>文件名</TableHead>
                    <TableHead className="w-24">大小</TableHead>
                    <TableHead className="w-44">修改时间</TableHead>
                    <TableHead className="w-40">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.map((f) => (
                    <TableRow key={f.name}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getFileIcon(f.name, f.isDirectory)}
                          <span className="text-sm">{f.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatSize(f.size)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(f.modifiedAt).toLocaleString('zh-CN')}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {!f.isDirectory && getPreviewType(f.name) && (
                            <Button variant="outline" size="sm" onClick={() => handlePreview(f)}>
                              <Eye className="h-3.5 w-3.5 mr-1" />
                              预览
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => handleDownload(f)}>
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          {activeTab === 'files' && (
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDelete(f)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        );
      })}
    </div>
  );
}

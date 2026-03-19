/**
 * 文件管理页面
 *
 * 功能：
 * - 切换 files/（用户上传）和 outputs/（AI 生成）
 * - 拖拽上传
 * - 文件列表（名称、大小、修改时间）
 * - 下载 / 删除
 * - 文件预览（文本/图片/PDF/HTML 仪表盘）
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import {
  FolderOpen, Upload, Download, Trash2, Eye, X, Loader2,
  FileText, FileImage, FileCode, File, FolderArchive, Bot,
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

/** 可预览的文件类型分类 */
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

function getPreviewUrl(dir: string, fileName: string): string {
  const token = localStorage.getItem('admin_token');
  return `/api/files/download/${dir}/${encodeURIComponent(fileName)}?preview=true&token=${encodeURIComponent(token || '')}`;
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

export default function FilesPage() {
  const [activeTab, setActiveTab] = useState<'files' | 'outputs'>('files');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 预览状态
  const [previewFile, setPreviewFile] = useState<string | null>(null);
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

  const handleDownload = (fileName: string) => {
    const dir = activeTab;
    const token = localStorage.getItem('admin_token');
    const url = `/api/files/download/${dir}/${encodeURIComponent(fileName)}?token=${encodeURIComponent(token || '')}`;
    window.open(url, '_blank');
  };

  const handleDelete = async (fileName: string) => {
    if (!confirm(`确定删除 ${fileName}？`)) return;
    try {
      await adminApi.deleteFile(`${activeTab}/${fileName}`);
      toast.success('已删除');
      loadFiles();
    } catch (err: any) {
      toast.error(`删除失败: ${err.message}`);
    }
  };

  const handlePreview = async (fileName: string) => {
    const type = getPreviewType(fileName);
    if (!type) return;

    setPreviewFile(fileName);
    setPreviewType(type);
    setPreviewContent('');

    if (type === 'text') {
      setPreviewLoading(true);
      try {
        const url = getPreviewUrl(activeTab, fileName);
        const res = await fetch(url);
        if (!res.ok) throw new Error('加载失败');
        const text = await res.text();
        setPreviewContent(text.length > 512000 ? text.slice(0, 512000) + '\n\n... (文件过大，已截断)' : text);
      } catch {
        setPreviewContent('加载失败');
      }
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setPreviewFile(null);
    setPreviewType(null);
    setPreviewContent('');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  };

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
          {/* 上传区 */}
          <div
            className={`mt-2 mb-4 border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
            ) : (
              <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            )}
            <div className="text-sm">
              {uploading ? '上传中...' : '拖拽文件到此处，或点击选择文件'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              支持文档、代码、图片等，单文件最大 20MB
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleUpload(e.target.files)}
            />
          </div>

          {renderFileTable(files, loading, activeTab, handlePreview, handleDownload, handleDelete)}
        </TabsContent>

        <TabsContent value="outputs">
          {renderFileTable(files, loading, activeTab, handlePreview, handleDownload, handleDelete)}
        </TabsContent>
      </Tabs>

      {/* 文件预览 Dialog */}
      <Dialog open={!!previewFile} onOpenChange={(open) => { if (!open) closePreview(); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {previewFile && getFileIcon(previewFile, false)}
              <span>{previewFile}</span>
              {previewType === 'text' && previewFile && (
                <Badge variant="outline" className="ml-2 text-xs">{getLanguage(previewFile)}</Badge>
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
                  src={getPreviewUrl(activeTab, previewFile)}
                  alt={previewFile}
                  className="max-w-full max-h-[60vh] object-contain rounded-md"
                />
              </div>
            )}
            {previewType === 'pdf' && previewFile && (
              <iframe
                src={getPreviewUrl(activeTab, previewFile)}
                className="w-full h-[60vh] rounded-md border"
                title={previewFile}
              />
            )}
            {previewType === 'html' && previewFile && (
              <iframe
                src={getPreviewUrl(activeTab, previewFile)}
                className="w-full h-[60vh] rounded-md border"
                title={previewFile}
                sandbox="allow-scripts"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function renderFileTable(
  files: FileInfo[],
  loading: boolean,
  activeTab: string,
  handlePreview: (name: string) => void,
  handleDownload: (name: string) => void,
  handleDelete: (name: string) => void,
) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>文件名</TableHead>
            <TableHead className="w-24">大小</TableHead>
            <TableHead className="w-44">修改时间</TableHead>
            <TableHead className="w-48">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center py-8">
                <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
              </TableCell>
            </TableRow>
          ) : files.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                {activeTab === 'files' ? '还没有上传文件' : '还没有 AI 生成的文件'}
              </TableCell>
            </TableRow>
          ) : (
            files.map((f) => (
              <TableRow key={f.name}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {getFileIcon(f.name, f.isDirectory)}
                    <span className="font-medium text-sm">{f.name}</span>
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
                      <Button variant="outline" size="sm" onClick={() => handlePreview(f.name)}>
                        <Eye className="h-3.5 w-3.5 mr-1" />
                        预览
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => handleDownload(f.name)}>
                      <Download className="h-3.5 w-3.5 mr-1" />
                      下载
                    </Button>
                    {activeTab === 'files' && (
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDelete(f.name)}>
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        删除
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

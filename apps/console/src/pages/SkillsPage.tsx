/**
 * Skills 技能管理页面（管理员）
 *
 * 功能：
 * - 表格展示所有技能（企业级 + 个人）
 * - 上传 zip 包（自动扫描）
 * - 查看扫描报告
 * - 审批/拒绝/启用/禁用/删除
 * - 重新扫描
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Upload,
  Zap,
  Trash2,
  CheckCircle,
  XCircle,
  Search,
  Eye,
  Loader2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Info,
  ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { adminApi, type SkillInfo } from '../api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';

const statusColorMap: Record<string, string> = {
  pending: 'bg-orange-100 text-orange-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  active: 'bg-cyan-100 text-cyan-700',
  disabled: 'bg-gray-100 text-gray-500',
};

const statusTextMap: Record<string, string> = {
  pending: '待审批',
  approved: '已通过',
  rejected: '已拒绝',
  active: '已激活',
  disabled: '已禁用',
};

const severityIconMap: Record<string, typeof ShieldAlert> = {
  critical: ShieldAlert,
  warning: AlertTriangle,
  info: Info,
};

const severityColorMap: Record<string, string> = {
  critical: 'text-red-600',
  warning: 'text-yellow-600',
  info: 'text-blue-600',
};

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState('');

  // 上传表单
  const [uploadForm, setUploadForm] = useState({ name: '', description: '', command: '', scriptPath: '' });

  // 扫描报告 Modal
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportSkill, setReportSkill] = useState<SkillInfo | null>(null);
  const [expandedFindings, setExpandedFindings] = useState<Set<number>>(new Set());

  // 删除确认
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingSkill, setDeletingSkill] = useState<SkillInfo | null>(null);

  // 拒绝原因
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectingSkillId, setRejectingSkillId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.getSkills();
      setSkills(res.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  // 上传
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      fileRef.current = file;
      setFileName(file.name);
    }
  };

  const handleUpload = async () => {
    if (!fileRef.current) {
      toast.error('请选择 zip 文件');
      return;
    }
    setUploading(true);
    try {
      const result = await adminApi.uploadSkill(fileRef.current, {
        name: uploadForm.name || undefined,
        description: uploadForm.description || undefined,
        command: uploadForm.command || undefined,
        scriptPath: uploadForm.scriptPath || undefined,
      });
      toast.success(result.message);
      setUploadModalOpen(false);
      setUploadForm({ name: '', description: '', command: '', scriptPath: '' });
      fileRef.current = null;
      setFileName('');
      loadSkills();
    } catch (err: any) {
      toast.error(err.message);
    }
    setUploading(false);
  };

  // 审批
  const handleApprove = async (id: string) => {
    try {
      await adminApi.approveSkill(id);
      toast.success('已审批通过');
      loadSkills();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // 拒绝
  const openRejectDialog = (id: string) => {
    setRejectingSkillId(id);
    setRejectReason('');
    setRejectDialogOpen(true);
  };

  const handleReject = async () => {
    if (!rejectingSkillId) return;
    try {
      await adminApi.rejectSkill(rejectingSkillId, rejectReason || undefined);
      toast.success('已拒绝');
      setRejectDialogOpen(false);
      loadSkills();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // 启用/禁用
  const handleToggleEnable = async (id: string, enabled: boolean) => {
    try {
      await adminApi.enableSkill(id, enabled);
      toast.success(enabled ? '已启用' : '已禁用');
      loadSkills();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // 重新扫描
  const handleScan = async (id: string) => {
    try {
      const result = await adminApi.scanSkill(id);
      toast.success('扫描完成');
      loadSkills();
      setReportSkill({ ...skills.find(s => s.id === id)!, scanReport: result.scanReport });
      setExpandedFindings(new Set());
      setReportModalOpen(true);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // 删除
  const confirmDelete = (skill: SkillInfo) => {
    setDeletingSkill(skill);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingSkill) return;
    try {
      await adminApi.deleteSkill(deletingSkill.id);
      toast.success('已删除');
      setDeleteDialogOpen(false);
      loadSkills();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // 查看扫描报告
  const showReport = (skill: SkillInfo) => {
    setReportSkill(skill);
    setExpandedFindings(new Set());
    setReportModalOpen(true);
  };

  const toggleFinding = (index: number) => {
    setExpandedFindings((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Zap className="h-5 w-5" />
          Skills 技能管理
        </h2>
        <Button onClick={() => { setUploadForm({ name: '', description: '', command: '', scriptPath: '' }); fileRef.current = null; setFileName(''); setUploadModalOpen(true); }}>
          <Upload className="h-4 w-4 mr-1" />
          上传技能包
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead className="w-[100px]">范围</TableHead>
                  <TableHead className="w-[80px]">版本</TableHead>
                  <TableHead className="w-[100px]">状态</TableHead>
                  <TableHead className="w-[180px]">扫描结果</TableHead>
                  <TableHead className="w-[80px]">启用</TableHead>
                  <TableHead className="w-[260px] text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {skills.map((skill) => (
                  <TableRow key={skill.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{skill.name}</div>
                        {skill.description && (
                          <div className="text-xs text-muted-foreground">{skill.description}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={skill.scope === 'enterprise' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}>
                        {skill.scope === 'enterprise' ? '企业级' : '个人'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{skill.version || '-'}</TableCell>
                    <TableCell>
                      <Badge className={statusColorMap[skill.status] || 'bg-gray-100 text-gray-700'}>
                        {statusTextMap[skill.status] || skill.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {skill.scanReport ? (
                        <div className="flex items-center gap-1.5">
                          <Badge className={skill.scanReport.passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>
                            {skill.scanReport.passed ? '通过' : '未通过'}
                          </Badge>
                          {skill.scanReport.summary.critical > 0 && (
                            <Badge variant="destructive" className="text-xs">{skill.scanReport.summary.critical} 严重</Badge>
                          )}
                          {skill.scanReport.summary.warning > 0 && (
                            <Badge className="bg-orange-100 text-orange-700 text-xs">{skill.scanReport.summary.warning} 警告</Badge>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => showReport(skill)}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">未扫描</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={skill.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}>
                        {skill.enabled ? '启用' : '禁用'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1 flex-wrap">
                        {skill.status === 'pending' && (
                          <>
                            <Button size="sm" onClick={() => handleApprove(skill.id)}>
                              <CheckCircle className="h-4 w-4 mr-1" />
                              通过
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => openRejectDialog(skill.id)}>
                              <XCircle className="h-4 w-4 mr-1" />
                              拒绝
                            </Button>
                          </>
                        )}
                        {skill.status !== 'pending' && (
                          <Button variant="outline" size="sm" onClick={() => handleToggleEnable(skill.id, !skill.enabled)}>
                            {skill.enabled ? '禁用' : '启用'}
                          </Button>
                        )}
                        <Button variant="outline" size="sm" onClick={() => handleScan(skill.id)}>
                          <Search className="h-4 w-4 mr-1" />
                          扫描
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => confirmDelete(skill)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {skills.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">暂无技能</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 上传弹窗 */}
      <Dialog open={uploadModalOpen} onOpenChange={setUploadModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>上传企业级技能包</DialogTitle>
            <DialogDescription>上传 zip 文件，系统将自动扫描安全性</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>技能包 (zip) *</Label>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-1" />
                  选择文件
                </Button>
                <span className="text-sm text-muted-foreground">{fileName || '未选择文件'}</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </div>
              <p className="text-xs text-muted-foreground">zip 包应包含 SKILL.md 文件（YAML frontmatter 定义元数据）和入口脚本</p>
            </div>
            <div className="space-y-2">
              <Label>名称（可选，从 SKILL.md 自动读取）</Label>
              <Input placeholder="覆盖 SKILL.md 中的 name" value={uploadForm.name} onChange={(e) => setUploadForm({ ...uploadForm, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>描述</Label>
              <Input placeholder="覆盖 SKILL.md 中的 description" value={uploadForm.description} onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>执行命令</Label>
              <Input placeholder="例如: python3 / node / bash" value={uploadForm.command} onChange={(e) => setUploadForm({ ...uploadForm, command: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>入口脚本路径</Label>
              <Input placeholder="相对路径，例如: main.py" value={uploadForm.scriptPath} onChange={(e) => setUploadForm({ ...uploadForm, scriptPath: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadModalOpen(false)}>取消</Button>
            <Button onClick={handleUpload} disabled={uploading}>
              {uploading && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              上传并扫描
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认弹窗 */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定删除技能 <span className="font-semibold">{deletingSkill?.name}</span>？相关文件也将被清理。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={handleDelete}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 拒绝原因弹窗 */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>拒绝技能</DialogTitle>
            <DialogDescription>请输入拒绝原因（可选）</DialogDescription>
          </DialogHeader>
          <Input
            placeholder="拒绝原因"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={handleReject}>拒绝</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 扫描报告弹窗 */}
      <Dialog open={reportModalOpen} onOpenChange={setReportModalOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>扫描报告: {reportSkill?.name || ''}</DialogTitle>
          </DialogHeader>

          {reportSkill?.scanReport ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Badge className={reportSkill.scanReport.passed ? 'bg-green-100 text-green-700 text-sm px-3 py-1' : 'bg-red-100 text-red-700 text-sm px-3 py-1'}>
                  {reportSkill.scanReport.passed ? '扫描通过' : '扫描未通过'}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  扫描文件: {reportSkill.scanReport.totalFiles} | 总行数: {reportSkill.scanReport.totalLines}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Badge variant="destructive" className="text-xs">严重: {reportSkill.scanReport.summary.critical}</Badge>
                <Badge className="bg-orange-100 text-orange-700 text-xs">警告: {reportSkill.scanReport.summary.warning}</Badge>
                <Badge className="bg-blue-100 text-blue-700 text-xs">信息: {reportSkill.scanReport.summary.info}</Badge>
              </div>

              {reportSkill.scanReport.rejectReason && (
                <div className="p-3 rounded-md bg-red-50 border border-red-200">
                  <p className="text-sm text-red-700">拒绝原因: {reportSkill.scanReport.rejectReason}</p>
                </div>
              )}

              {reportSkill.scanReport.findings && reportSkill.scanReport.findings.length > 0 ? (
                <div className="space-y-2">
                  {reportSkill.scanReport.findings.map((f, i) => {
                    const SeverityIcon = severityIconMap[f.severity] || Info;
                    const isExpanded = expandedFindings.has(i);
                    return (
                      <div key={i} className="border rounded-md">
                        <button
                          className="w-full flex items-center gap-2 p-3 text-left hover:bg-muted/50 transition-colors"
                          onClick={() => toggleFinding(i)}
                        >
                          {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                          <SeverityIcon className={`h-4 w-4 shrink-0 ${severityColorMap[f.severity] || 'text-gray-500'}`} />
                          <Badge variant="outline" className="text-xs shrink-0">
                            {f.severity === 'critical' ? '严重' : f.severity === 'warning' ? '警告' : '信息'}
                          </Badge>
                          <span className="text-sm truncate">[{f.ruleId}] {f.message}</span>
                        </button>
                        {isExpanded && (
                          <div className="px-3 pb-3 text-xs space-y-2">
                            <div>
                              <span className="text-muted-foreground">文件: </span>
                              {f.file}{f.line ? `:${f.line}` : ''}
                            </div>
                            {f.snippet && (
                              <pre className="p-2 bg-muted rounded overflow-auto text-xs">
                                {f.snippet}
                              </pre>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">无安全发现项</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4">暂无扫描报告</p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setReportModalOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

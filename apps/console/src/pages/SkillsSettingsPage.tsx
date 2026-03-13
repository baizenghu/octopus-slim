/**
 * Skills 设置页面
 *
 * 功能：
 * - Tab 1: 企业级技能（admin 可上传/审批/拒绝/启用/禁用/删除/扫描，普通用户只读）
 * - Tab 2: 我的技能（上传 zip + 删除 + 查看扫描报告）
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  Zap, Trash2, Upload, Eye, CheckCircle, XCircle, Search, Loader2, ChevronDown, ChevronRight,
} from 'lucide-react';
import { adminApi, type SkillInfo } from '../api';
import { useAuthStore } from '../store';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Collapsible, CollapsibleTrigger, CollapsibleContent,
} from '@/components/ui/collapsible';

export default function SkillsSettingsPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.roles?.some((r: string) => r.toLowerCase() === 'admin');

  const [enterpriseSkills, setEnterpriseSkills] = useState<SkillInfo[]>([]);
  const [personalSkills, setPersonalSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(false);

  // 个人技能上传
  const [personalUploadOpen, setPersonalUploadOpen] = useState(false);
  const [personalUploading, setPersonalUploading] = useState(false);
  const personalFileRef = useRef<File | null>(null);
  const [personalFormName, setPersonalFormName] = useState('');
  const [personalFormDesc, setPersonalFormDesc] = useState('');
  const [personalFormCmd, setPersonalFormCmd] = useState('');
  const [personalFormScript, setPersonalFormScript] = useState('');

  // 企业级技能上传（admin）
  const [enterpriseUploadOpen, setEnterpriseUploadOpen] = useState(false);
  const [enterpriseUploading, setEnterpriseUploading] = useState(false);
  const enterpriseFileRef = useRef<File | null>(null);
  const [enterpriseFormName, setEnterpriseFormName] = useState('');
  const [enterpriseFormDesc, setEnterpriseFormDesc] = useState('');
  const [enterpriseFormCmd, setEnterpriseFormCmd] = useState('');
  const [enterpriseFormScript, setEnterpriseFormScript] = useState('');

  // 扫描报告 Modal
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportSkill, setReportSkill] = useState<SkillInfo | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [allRes, personalRes] = await Promise.all([
        adminApi.getSkills(),
        adminApi.getPersonalSkills(),
      ]);
      setEnterpriseSkills(allRes.data.filter(s => s.scope === 'enterprise'));
      setPersonalSkills(personalRes.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // =============== 企业级技能操作（admin） ===============

  const handleEnterpriseUpload = async () => {
    if (!enterpriseFileRef.current) {
      toast.error('请选择 zip 文件');
      return;
    }
    setEnterpriseUploading(true);
    try {
      const result = await adminApi.uploadSkill(enterpriseFileRef.current, {
        name: enterpriseFormName || undefined,
        description: enterpriseFormDesc || undefined,
        command: enterpriseFormCmd || undefined,
        scriptPath: enterpriseFormScript || undefined,
      });
      toast.success(result.message);
      setEnterpriseUploadOpen(false);
      enterpriseFileRef.current = null;
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
    setEnterpriseUploading(false);
  };

  const handleApprove = async (id: string) => {
    try {
      await adminApi.approveSkill(id);
      toast.success('已审批通过');
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleReject = async (id: string) => {
    const reason = prompt('请输入拒绝原因（可选）:');
    try {
      await adminApi.rejectSkill(id, reason || undefined);
      toast.success('已拒绝');
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleToggleEnable = async (id: string, enabled: boolean) => {
    try {
      await adminApi.enableSkill(id, enabled);
      toast.success(enabled ? '已启用' : '已禁用');
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleScan = async (id: string) => {
    try {
      const result = await adminApi.scanSkill(id);
      toast.success('扫描完成');
      loadData();
      const skill = enterpriseSkills.find(s => s.id === id);
      if (skill) {
        setReportSkill({ ...skill, scanReport: result.scanReport });
        setReportModalOpen(true);
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleEnterpriseDelete = async (id: string) => {
    if (!confirm('确定删除此技能？相关文件也将被清理。')) return;
    try {
      await adminApi.deleteSkill(id);
      toast.success('已删除');
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // =============== 个人技能操作 ===============

  const handlePersonalUpload = async () => {
    if (!personalFileRef.current) {
      toast.error('请选择 zip 文件');
      return;
    }
    setPersonalUploading(true);
    try {
      const result = await adminApi.uploadPersonalSkill(personalFileRef.current, {
        name: personalFormName || undefined,
        description: personalFormDesc || undefined,
        command: personalFormCmd || undefined,
        scriptPath: personalFormScript || undefined,
      });
      toast.success(result.message);
      setPersonalUploadOpen(false);
      personalFileRef.current = null;
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
    setPersonalUploading(false);
  };

  const handlePersonalDelete = async (id: string) => {
    if (!confirm('确定删除此技能？')) return;
    try {
      await adminApi.deletePersonalSkill(id);
      toast.success('已删除');
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // =============== 通用 ===============

  const showReport = (skill: SkillInfo) => {
    setReportSkill(skill);
    setReportModalOpen(true);
  };

  const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    pending: 'outline',
    approved: 'default',
    rejected: 'destructive',
    active: 'default',
    disabled: 'secondary',
  };

  const statusText: Record<string, string> = {
    pending: '待审批',
    approved: '已通过',
    rejected: '已拒绝',
    active: '已激活',
    disabled: '已禁用',
  };

  const severityColor: Record<string, string> = {
    critical: 'text-red-600',
    warning: 'text-yellow-600',
    info: 'text-blue-600',
  };

  const severityBg: Record<string, string> = {
    critical: 'bg-red-50 border-red-200',
    warning: 'bg-yellow-50 border-yellow-200',
    info: 'bg-blue-50 border-blue-200',
  };

  // =============== 渲染上传表单 ===============
  const renderUploadForm = (
    scope: 'enterprise' | 'personal',
    formName: string, setName: (v: string) => void,
    formDesc: string, setDesc: (v: string) => void,
    formCmd: string, setCmd: (v: string) => void,
    formScript: string, setScript: (v: string) => void,
    fileRef: React.MutableRefObject<File | null>,
  ) => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>技能包 (zip) <span className="text-destructive">*</span></Label>
        <div>
          <input
            type="file"
            accept=".zip"
            className="text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-input file:bg-background file:text-sm file:font-medium hover:file:bg-accent"
            onChange={(e) => { fileRef.current = e.target.files?.[0] || null; }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {scope === 'enterprise'
            ? 'zip 包应包含 SKILL.md 文件（YAML frontmatter 定义元数据）和入口脚本'
            : 'zip 包应包含 SKILL.md 和入口脚本，扫描通过后自动启用'}
        </p>
      </div>
      <div className="space-y-2">
        <Label>名称（可选{scope === 'enterprise' ? '，从 SKILL.md 自动读取' : ''}）</Label>
        <Input
          placeholder={scope === 'enterprise' ? '覆盖 SKILL.md 中的 name' : '从 SKILL.md 自动读取'}
          value={formName}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label>描述</Label>
        <Input
          placeholder={scope === 'enterprise' ? '覆盖 SKILL.md 中的 description' : '简要描述技能用途'}
          value={formDesc}
          onChange={(e) => setDesc(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label>执行命令</Label>
        <Input
          placeholder="例如: python3 / node / bash"
          value={formCmd}
          onChange={(e) => setCmd(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label>入口脚本路径</Label>
        <Input
          placeholder="相对路径，例如: main.py"
          value={formScript}
          onChange={(e) => setScript(e.target.value)}
        />
      </div>
    </div>
  );

  // =============== 渲染技能表格 ===============
  const renderSkillsTable = (skills: SkillInfo[], scope: 'enterprise' | 'personal') => (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead className="w-20">版本</TableHead>
            <TableHead className="w-24">状态</TableHead>
            {scope === 'enterprise' && <TableHead className="w-20">启用</TableHead>}
            {(scope === 'personal' || isAdmin) && <TableHead className="w-36">扫描结果</TableHead>}
            {(scope === 'personal' || isAdmin) && <TableHead className="w-64">操作</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center py-8">
                <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
              </TableCell>
            </TableRow>
          ) : skills.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                {scope === 'enterprise' ? '暂无企业级技能' : '暂无个人技能'}
              </TableCell>
            </TableRow>
          ) : (
            skills.map((skill) => (
              <TableRow key={skill.id}>
                <TableCell>
                  <div className="font-medium">{skill.name}</div>
                  {skill.description && <div className="text-xs text-muted-foreground">{skill.description}</div>}
                </TableCell>
                <TableCell>{skill.version || '-'}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant[skill.status] || 'outline'}>
                    {statusText[skill.status] || skill.status}
                  </Badge>
                </TableCell>
                {scope === 'enterprise' && (
                  <TableCell>
                    <Badge variant={skill.enabled ? 'default' : 'secondary'}>
                      {skill.enabled ? '启用' : '禁用'}
                    </Badge>
                  </TableCell>
                )}
                {(scope === 'personal' || isAdmin) && (
                  <TableCell>
                    {skill.scanReport ? (
                      <div className="flex items-center gap-1">
                        <Badge variant={skill.scanReport.passed ? 'default' : 'destructive'}>
                          {skill.scanReport.passed ? '通过' : '未通过'}
                        </Badge>
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => showReport(skill)}>
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          详情
                        </Button>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">未扫描</span>
                    )}
                  </TableCell>
                )}
                {scope === 'personal' && (
                  <TableCell>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => handlePersonalDelete(skill.id)}>
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      删除
                    </Button>
                  </TableCell>
                )}
                {scope === 'enterprise' && isAdmin && (
                  <TableCell>
                    <div className="flex items-center gap-1 flex-wrap">
                      {skill.status === 'pending' && (
                        <>
                          <Button size="sm" onClick={() => handleApprove(skill.id)}>
                            <CheckCircle className="h-3.5 w-3.5 mr-1" />
                            通过
                          </Button>
                          <Button variant="destructive" size="sm" onClick={() => handleReject(skill.id)}>
                            <XCircle className="h-3.5 w-3.5 mr-1" />
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
                        <Search className="h-3.5 w-3.5 mr-1" />
                        扫描
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleEnterpriseDelete(skill.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
        <Zap className="h-5 w-5" />
        技能设置
      </h2>

      <Tabs defaultValue="enterprise">
        <TabsList>
          <TabsTrigger value="enterprise">企业级技能 ({enterpriseSkills.length})</TabsTrigger>
          <TabsTrigger value="personal">我的技能 ({personalSkills.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="enterprise">
          {isAdmin && (
            <div className="flex justify-end mb-4">
              <Button onClick={() => {
                setEnterpriseFormName(''); setEnterpriseFormDesc(''); setEnterpriseFormCmd(''); setEnterpriseFormScript('');
                enterpriseFileRef.current = null;
                setEnterpriseUploadOpen(true);
              }}>
                <Upload className="h-4 w-4 mr-1" />
                上传企业级技能
              </Button>
            </div>
          )}
          {renderSkillsTable(enterpriseSkills, 'enterprise')}
        </TabsContent>

        <TabsContent value="personal">
          <div className="flex justify-end mb-4">
            <Button onClick={() => {
              setPersonalFormName(''); setPersonalFormDesc(''); setPersonalFormCmd(''); setPersonalFormScript('');
              personalFileRef.current = null;
              setPersonalUploadOpen(true);
            }}>
              <Upload className="h-4 w-4 mr-1" />
              上传个人技能
            </Button>
          </div>
          {renderSkillsTable(personalSkills, 'personal')}
        </TabsContent>
      </Tabs>

      {/* 企业级技能上传 Dialog（admin） */}
      <Dialog open={enterpriseUploadOpen} onOpenChange={setEnterpriseUploadOpen}>
        <DialogContent className="max-w-[600px]">
          <DialogHeader>
            <DialogTitle>上传企业级技能包</DialogTitle>
            <DialogDescription>上传 zip 格式的技能包，系统将自动扫描安全性</DialogDescription>
          </DialogHeader>
          {renderUploadForm(
            'enterprise',
            enterpriseFormName, setEnterpriseFormName,
            enterpriseFormDesc, setEnterpriseFormDesc,
            enterpriseFormCmd, setEnterpriseFormCmd,
            enterpriseFormScript, setEnterpriseFormScript,
            enterpriseFileRef,
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnterpriseUploadOpen(false)}>取消</Button>
            <Button onClick={handleEnterpriseUpload} disabled={enterpriseUploading}>
              {enterpriseUploading && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              上传并扫描
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 个人技能上传 Dialog */}
      <Dialog open={personalUploadOpen} onOpenChange={setPersonalUploadOpen}>
        <DialogContent className="max-w-[600px]">
          <DialogHeader>
            <DialogTitle>上传个人技能包</DialogTitle>
            <DialogDescription>上传 zip 格式的技能包，扫描通过后自动启用</DialogDescription>
          </DialogHeader>
          {renderUploadForm(
            'personal',
            personalFormName, setPersonalFormName,
            personalFormDesc, setPersonalFormDesc,
            personalFormCmd, setPersonalFormCmd,
            personalFormScript, setPersonalFormScript,
            personalFileRef,
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPersonalUploadOpen(false)}>取消</Button>
            <Button onClick={handlePersonalUpload} disabled={personalUploading}>
              {personalUploading && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              上传并扫描
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 扫描报告 Dialog */}
      <Dialog open={reportModalOpen} onOpenChange={setReportModalOpen}>
        <DialogContent className="max-w-[800px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>扫描报告: {reportSkill?.name || ''}</DialogTitle>
            <DialogDescription>安全扫描详细结果</DialogDescription>
          </DialogHeader>

          {reportSkill?.scanReport ? (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Badge
                  variant={reportSkill.scanReport.passed ? 'default' : 'destructive'}
                  className="text-sm px-3 py-1"
                >
                  {reportSkill.scanReport.passed ? '扫描通过' : '扫描未通过'}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  扫描文件: {reportSkill.scanReport.totalFiles} | 总行数: {reportSkill.scanReport.totalLines}
                </span>
              </div>

              <div className="flex gap-2">
                <Badge variant="destructive">严重: {reportSkill.scanReport.summary.critical}</Badge>
                <Badge variant="outline" className="border-yellow-400 text-yellow-700">警告: {reportSkill.scanReport.summary.warning}</Badge>
                <Badge variant="outline" className="border-blue-400 text-blue-700">信息: {reportSkill.scanReport.summary.info}</Badge>
              </div>

              {reportSkill.scanReport.rejectReason && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                  <span className="text-sm text-red-700">拒绝原因: {reportSkill.scanReport.rejectReason}</span>
                </div>
              )}

              {reportSkill.scanReport.findings && reportSkill.scanReport.findings.length > 0 ? (
                <div className="space-y-2">
                  {reportSkill.scanReport.findings.map((f, i) => (
                    <FindingItem key={i} finding={f} severityColor={severityColor} severityBg={severityBg} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">无安全发现项</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">暂无扫描报告</p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setReportModalOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 扫描发现项（可折叠） */
function FindingItem({ finding, severityColor, severityBg }: {
  finding: any;
  severityColor: Record<string, string>;
  severityBg: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const severityLabel = finding.severity === 'critical' ? '严重' : finding.severity === 'warning' ? '警告' : '信息';

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className={`w-full flex items-center gap-2 p-2 rounded-md border text-left text-sm hover:bg-accent/50 transition-colors ${severityBg[finding.severity] || ''}`}>
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <Badge variant="outline" className={`${severityColor[finding.severity] || ''} shrink-0`}>
            {severityLabel}
          </Badge>
          <span className="truncate">[{finding.ruleId}] {finding.message}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-6 mt-1 p-2 text-xs space-y-1">
          <div>
            <span className="text-muted-foreground">文件: </span>
            {finding.file}{finding.line ? `:${finding.line}` : ''}
          </div>
          {finding.snippet && (
            <pre className="mt-2 p-2 bg-muted rounded-md overflow-auto text-xs">
              {finding.snippet}
            </pre>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

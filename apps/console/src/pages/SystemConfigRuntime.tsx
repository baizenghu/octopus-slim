/**
 * 系统配置 Tab 4：运行参数
 * 管理企业网关的所有运行时参数（超时、限制、缓存等）
 */
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { adminApi } from '../api';

interface Props {
  config: Record<string, any>;
  onSaved: () => void;
}

/** 毫秒 → 秒 */
const msToSec = (ms: number) => ms / 1000;
/** 秒 → 毫秒 */
const secToMs = (s: number) => s * 1000;
/** 字节 → MB */
const bytesToMB = (b: number) => b / 1048576;
/** MB → 字节 */
const mbToBytes = (mb: number) => mb * 1048576;

export default function SystemConfigRuntime({ config, onSaved }: Props) {
  const ent = config.enterprise || {};
  const chatCfg = ent.chat || {};
  const uploadCfg = ent.upload || {};
  const securityCfg = ent.security || {};
  const engineCfg = ent.engine || {};
  const imCfg = ent.im || {};
  const schedulerCfg = ent.scheduler || {};
  const adminCfg = ent.admin || {};
  const filesCfg = ent.files || {};
  const skillsCfg = ent.skills || {};

  // ─── Card 1: 对话参数 ───
  const [sseHeartbeatIntervalMs, setSseHeartbeatIntervalMs] = useState(msToSec(chatCfg.sseHeartbeatIntervalMs ?? 15000));
  const [sessionPrefsTTLMs, setSessionPrefsTTLMs] = useState(msToSec(chatCfg.sessionPrefsTTLMs ?? 1800000));
  const [maxAttachmentSizeBytes, setMaxAttachmentSizeBytes] = useState(bytesToMB(chatCfg.maxAttachmentSizeBytes ?? 10485760));
  const [maxSessionTokensCache, setMaxSessionTokensCache] = useState(chatCfg.maxSessionTokensCache ?? 2000);
  const [heartbeatSummaryMaxChars, setHeartbeatSummaryMaxChars] = useState(chatCfg.heartbeatSummaryMaxChars ?? 2000);

  // ─── Card 2: 上传限制 ───
  const [maxFileSizeBytes, setMaxFileSizeBytes] = useState(bytesToMB(uploadCfg.maxFileSizeBytes ?? 20971520));
  const [maxSkillSizeBytes, setMaxSkillSizeBytes] = useState(bytesToMB(uploadCfg.maxSkillSizeBytes ?? 52428800));
  const [maxAvatarSizeBytes, setMaxAvatarSizeBytes] = useState(bytesToMB(uploadCfg.maxAvatarSizeBytes ?? 2097152));

  // ─── Card 3: 安全策略 ───
  const [loginFailThreshold, setLoginFailThreshold] = useState(securityCfg.loginFailThreshold ?? 10);
  const [loginFailWindowMs, setLoginFailWindowMs] = useState(msToSec(securityCfg.loginFailWindowMs ?? 60000));
  const [apiRateThreshold, setApiRateThreshold] = useState(securityCfg.apiRateThreshold ?? 200);
  const [authCacheTTLMs, setAuthCacheTTLMs] = useState(msToSec(securityCfg.authCacheTTLMs ?? 300000));
  const [authCacheMaxSize, setAuthCacheMaxSize] = useState(securityCfg.authCacheMaxSize ?? 1000);
  const [rateLimitWindowMs, setRateLimitWindowMs] = useState(msToSec(securityCfg.rateLimitWindowMs ?? 60000));
  const [rateLimitMax, setRateLimitMax] = useState(securityCfg.rateLimitMax ?? 20);

  // ─── Card 4: 引擎参数 ───
  const [port, setPort] = useState(engineCfg.port ?? 19791);
  const [configBatchWindowMs, setConfigBatchWindowMs] = useState(msToSec(engineCfg.configBatchWindowMs ?? 2000));
  const [maxConfigRetries, setMaxConfigRetries] = useState(engineCfg.maxConfigRetries ?? 5);
  const [agentInitTimeoutMs, setAgentInitTimeoutMs] = useState(msToSec(engineCfg.agentInitTimeoutMs ?? 1500));

  // ─── Card 5: IM 与调度 ───
  const [runTimeoutMs, setRunTimeoutMs] = useState(msToSec(imCfg.runTimeoutMs ?? 1800000));
  const [bindWindowMs, setBindWindowMs] = useState(msToSec(imCfg.bindWindowMs ?? 900000));
  const [bindMaxAttempts, setBindMaxAttempts] = useState(imCfg.bindMaxAttempts ?? 5);
  const [fileSizeLimitBytes, setFileSizeLimitBytes] = useState(bytesToMB(imCfg.fileSizeLimitBytes ?? 10485760));
  const [defaultHeartbeatDelayMs, setDefaultHeartbeatDelayMs] = useState(msToSec(schedulerCfg.defaultHeartbeatDelayMs ?? 60000));

  // ─── Card 6: 其他 ───
  const [maxPageSize, setMaxPageSize] = useState(adminCfg.maxPageSize ?? 100);
  const [defaultAuditQueryLimit, setDefaultAuditQueryLimit] = useState(adminCfg.defaultAuditQueryLimit ?? 50);
  const [dashboardStatsDays, setDashboardStatsDays] = useState(adminCfg.dashboardStatsDays ?? 7);
  const [tempLinkExpiryMs, setTempLinkExpiryMs] = useState(msToSec(filesCfg.tempLinkExpiryMs ?? 300000));
  const [maxSkillMdChars, setMaxSkillMdChars] = useState(skillsCfg.maxSkillMdChars ?? 8000);

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await adminApi.updateRuntimeConfig({
        chat: {
          sseHeartbeatIntervalMs: secToMs(sseHeartbeatIntervalMs),
          sessionPrefsTTLMs: secToMs(sessionPrefsTTLMs),
          maxAttachmentSizeBytes: mbToBytes(maxAttachmentSizeBytes),
          maxSessionTokensCache,
          heartbeatSummaryMaxChars,
        },
        upload: {
          maxFileSizeBytes: mbToBytes(maxFileSizeBytes),
          maxSkillSizeBytes: mbToBytes(maxSkillSizeBytes),
          maxAvatarSizeBytes: mbToBytes(maxAvatarSizeBytes),
        },
        security: {
          loginFailThreshold,
          loginFailWindowMs: secToMs(loginFailWindowMs),
          apiRateThreshold,
          authCacheTTLMs: secToMs(authCacheTTLMs),
          authCacheMaxSize,
          rateLimitWindowMs: secToMs(rateLimitWindowMs),
          rateLimitMax,
        },
        engine: {
          port,
          configBatchWindowMs: secToMs(configBatchWindowMs),
          maxConfigRetries,
          agentInitTimeoutMs: secToMs(agentInitTimeoutMs),
        },
        im: {
          runTimeoutMs: secToMs(runTimeoutMs),
          bindWindowMs: secToMs(bindWindowMs),
          bindMaxAttempts,
          fileSizeLimitBytes: mbToBytes(fileSizeLimitBytes),
        },
        scheduler: {
          defaultHeartbeatDelayMs: secToMs(defaultHeartbeatDelayMs),
        },
        admin: {
          maxPageSize,
          defaultAuditQueryLimit,
          dashboardStatsDays,
        },
        files: {
          tempLinkExpiryMs: secToMs(tempLinkExpiryMs),
        },
        skills: {
          maxSkillMdChars,
        },
      });

      toast.success('运行参数已保存，部分配置需重启生效');
      onSaved();
    } catch (err: any) {
      toast.error('保存失败: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  /** 通用数值输入 onChange handler */
  const numChange = (setter: (v: number) => void, fallback: number) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value);
      setter(Number.isNaN(v) ? fallback : v);
    };

  return (
    <div className="space-y-6 mt-4">
      {/* Card 1: 对话参数 */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">对话参数</CardTitle>
          <CardDescription>聊天 SSE、会话缓存、附件等核心对话参数</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">SSE 心跳间隔（秒）</label>
              <Input type="number" min="1" step="1" value={sseHeartbeatIntervalMs} onChange={numChange(setSseHeartbeatIntervalMs, 15)} />
              <p className="text-xs text-muted-foreground mt-1">SSE 连接保活间隔</p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">会话偏好缓存 TTL（秒）</label>
              <Input type="number" min="1" step="1" value={sessionPrefsTTLMs} onChange={numChange(setSessionPrefsTTLMs, 1800)} />
              <p className="text-xs text-muted-foreground mt-1">会话偏好缓存过期时间</p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">附件大小限制（MB）</label>
              <Input type="number" min="0.1" step="0.1" value={maxAttachmentSizeBytes} onChange={numChange(setMaxAttachmentSizeBytes, 10)} />
              <p className="text-xs text-muted-foreground mt-1">聊天附件 Base64 大小上限</p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">会话 Token 缓存数</label>
              <Input type="number" min="1" step="1" value={maxSessionTokensCache} onChange={numChange(setMaxSessionTokensCache, 2000)} />
              <p className="text-xs text-muted-foreground mt-1">内存中最大缓存会话数</p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">心跳摘要截断</label>
              <Input type="number" min="100" step="100" value={heartbeatSummaryMaxChars} onChange={numChange(setHeartbeatSummaryMaxChars, 2000)} />
              <p className="text-xs text-muted-foreground mt-1">心跳巡检结果摘要最大字符数</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Card 2: 上传限制 */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">上传限制</CardTitle>
          <CardDescription>各类文件上传的大小限制</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">文件上传限制（MB）</label>
              <Input type="number" min="0.1" step="0.1" value={maxFileSizeBytes} onChange={numChange(setMaxFileSizeBytes, 20)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Skill 上传限制（MB）</label>
              <Input type="number" min="0.1" step="0.1" value={maxSkillSizeBytes} onChange={numChange(setMaxSkillSizeBytes, 50)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">头像上传限制（MB）</label>
              <Input type="number" min="0.1" step="0.1" value={maxAvatarSizeBytes} onChange={numChange(setMaxAvatarSizeBytes, 2)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Card 3: 安全策略 */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">安全策略</CardTitle>
          <CardDescription>登录保护、API 限流、认证缓存</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">登录失败阈值</label>
              <Input type="number" min="1" step="1" value={loginFailThreshold} onChange={numChange(setLoginFailThreshold, 10)} />
              <p className="text-xs text-muted-foreground mt-1">连续失败 N 次后触发安全告警</p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">登录失败窗口（秒）</label>
              <Input type="number" min="1" step="1" value={loginFailWindowMs} onChange={numChange(setLoginFailWindowMs, 60)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">API 速率阈值</label>
              <Input type="number" min="1" step="1" value={apiRateThreshold} onChange={numChange(setApiRateThreshold, 200)} />
              <p className="text-xs text-muted-foreground mt-1">单窗口期内最大 API 请求数</p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">认证缓存 TTL（秒）</label>
              <Input type="number" min="1" step="1" value={authCacheTTLMs} onChange={numChange(setAuthCacheTTLMs, 300)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">认证缓存容量</label>
              <Input type="number" min="1" step="1" value={authCacheMaxSize} onChange={numChange(setAuthCacheMaxSize, 1000)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">登录速率限制窗口（秒）</label>
              <Input type="number" min="1" step="1" value={rateLimitWindowMs} onChange={numChange(setRateLimitWindowMs, 60)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">登录速率限制次数</label>
              <Input type="number" min="1" step="1" value={rateLimitMax} onChange={numChange(setRateLimitMax, 20)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Card 4: 引擎参数 */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">引擎参数</CardTitle>
          <CardDescription>内嵌引擎端口、配置批处理、初始化超时</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">引擎端口</label>
              <Input type="number" min="1024" max="65535" step="1" value={port} onChange={numChange(setPort, 19791)} />
              <p className="text-xs text-muted-foreground mt-1">内嵌引擎 gateway 端口</p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">配置批处理窗口（秒）</label>
              <Input type="number" min="0.1" step="0.1" value={configBatchWindowMs} onChange={numChange(setConfigBatchWindowMs, 2)} />
              <p className="text-xs text-muted-foreground mt-1">配置变更合并写入的等待窗口</p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">配置最大重试</label>
              <Input type="number" min="1" step="1" value={maxConfigRetries} onChange={numChange(setMaxConfigRetries, 5)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Agent 初始化超时（秒）</label>
              <Input type="number" min="0.1" step="0.1" value={agentInitTimeoutMs} onChange={numChange(setAgentInitTimeoutMs, 1.5)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Card 5: IM 与调度 */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">IM 与调度</CardTitle>
          <CardDescription>IM 运行超时、绑定窗口、心跳延迟</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">运行超时（秒）</label>
              <Input type="number" min="1" step="1" value={runTimeoutMs} onChange={numChange(setRunTimeoutMs, 1800)} />
              <p className="text-xs text-muted-foreground mt-1">IM /run 命令最大执行时间</p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">绑定窗口（秒）</label>
              <Input type="number" min="1" step="1" value={bindWindowMs} onChange={numChange(setBindWindowMs, 900)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">绑定最大尝试</label>
              <Input type="number" min="1" step="1" value={bindMaxAttempts} onChange={numChange(setBindMaxAttempts, 5)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">文件大小限制（MB）</label>
              <Input type="number" min="0.1" step="0.1" value={fileSizeLimitBytes} onChange={numChange(setFileSizeLimitBytes, 10)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">心跳默认延迟（秒）</label>
              <Input type="number" min="1" step="1" value={defaultHeartbeatDelayMs} onChange={numChange(setDefaultHeartbeatDelayMs, 60)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Card 6: 其他 */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">其他</CardTitle>
          <CardDescription>分页、审计、Dashboard、临时链接等杂项参数</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">分页最大条数</label>
              <Input type="number" min="1" step="1" value={maxPageSize} onChange={numChange(setMaxPageSize, 100)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">审计默认条数</label>
              <Input type="number" min="1" step="1" value={defaultAuditQueryLimit} onChange={numChange(setDefaultAuditQueryLimit, 50)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Dashboard 统计天数</label>
              <Input type="number" min="1" step="1" value={dashboardStatsDays} onChange={numChange(setDashboardStatsDays, 7)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">临时链接过期（秒）</label>
              <Input type="number" min="1" step="1" value={tempLinkExpiryMs} onChange={numChange(setTempLinkExpiryMs, 300)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Skill.md 最大字符</label>
              <Input type="number" min="100" step="100" value={maxSkillMdChars} onChange={numChange(setMaxSkillMdChars, 8000)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存运行参数'}</Button>
      </div>
    </div>
  );
}

/**
 * Admin Console API 客户端
 */

const API_BASE = '/api';

export interface UserInfo {
  userId: string;
  username: string;
  email: string;
  displayName?: string;
  department?: string;
  roles: string[];
  status: string;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardData {
  totalUsers: number;
  activeUsers: number;
  todayAuditCount: number;
  weekAuditCount: number;
  dailyTrend: { date: string; count: number }[];
  actionDistribution: Record<string, number>;
  totalMcpServers: number;
  enabledMcpServers: number;
  totalSkills: number;
  enabledSkills: number;
  totalAgents: number;
  totalScheduledTasks: number;
  enabledScheduledTasks: number;
}

export interface AuditRecord {
  logId: string;
  userId: string;
  username: string;
  action: string;
  resource: string;
  details: any;
  ipAddress: string;
  userAgent: string;
  success: boolean;
  errorMessage?: string;
  durationMs?: number;
  createdAt: string;
}

export interface SessionInfo {
  sessionId: string;
  title: string;
  messageCount: number;
  lastActiveAt: string;
}

export interface SearchResult {
  sessionId: string;
  role: string;
  content: string;
  ts: string;
  snippet: string;
}

export interface FileInfo {
  name: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
}

export interface McpServerInfo {
  id: string;
  name: string;
  description?: string;
  scope: 'enterprise' | 'personal';
  ownerId?: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled: boolean;
  createdAt: string;
}

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface SkillInfo {
  id: string;
  name: string;
  description?: string;
  scope: 'enterprise' | 'personal';
  ownerId?: string;
  version?: string;
  status: 'pending' | 'approved' | 'rejected' | 'active' | 'disabled';
  scriptPath?: string;
  command?: string;
  scanReport?: {
    passed: boolean;
    totalFiles: number;
    totalLines: number;
    summary: { critical: number; warning: number; info: number };
    findings: { ruleId: string; severity: string; message: string; file: string; line?: number; snippet?: string }[];
    rejectReason?: string;
  };
  enabled: boolean;
  createdAt: string;
}

export interface ScheduledTaskInfo {
  id: string;
  name: string;
  userId: string;
  cron: string;
  taskType: 'skill' | 'mcp' | 'report' | 'mail' | 'heartbeat';
  taskConfig: Record<string, any>;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
}

export interface DatabaseConnectionInfo {
  id: string;
  userId: string;
  name: string;
  dbType: string;
  host: string;
  port: number;
  dbUser: string;
  dbPassword: string;
  dbName: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  description?: string;
  model?: string;
  systemPrompt?: string;
  identity?: { name?: string; emoji?: string; avatar?: string };
  skillsFilter?: string[] | null;
  mcpFilter?: string[] | null;
  toolsFilter?: string[] | null;
  allowedConnections?: string[] | null;
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

class AdminApi {
  private token: string | null = null;
  private refreshToken: string | null = null;
  /** 防止并发刷新：多个 401 请求同时触发时只刷新一次 */
  private refreshPromise: Promise<boolean> | null = null;
  /** 登出回调：token 刷新彻底失败时通知 store 清理状态 */
  private onAuthFailure: (() => void) | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  setRefreshToken(refreshToken: string | null) {
    this.refreshToken = refreshToken;
  }

  /** 注册认证失败回调（由 store 调用） */
  setOnAuthFailure(callback: () => void) {
    this.onAuthFailure = callback;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  /**
   * 尝试使用 refresh token 获取新的 access token
   * 使用 refreshPromise 防止并发刷新竞争
   */
  private async tryRefreshToken(): Promise<boolean> {
    if (!this.refreshToken) return false;

    // 并发请求复用同一个刷新 Promise
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: this.refreshToken }),
        });
        if (res.ok) {
          const data = await res.json();
          this.token = data.accessToken;
          // 更新 localStorage 以便页面刷新后仍能使用
          localStorage.setItem('admin_token', data.accessToken);
          if (data.refreshToken) {
            this.refreshToken = data.refreshToken;
            localStorage.setItem('admin_refresh_token', data.refreshToken);
          }
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    let res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { ...this.headers(), ...options?.headers },
    });

    // 401 时尝试自动刷新 token 并重试（排除 auth 相关路径，避免循环）
    if (res.status === 401 && this.refreshToken && !path.startsWith('/auth/')) {
      const refreshed = await this.tryRefreshToken();
      if (refreshed) {
        // 用新 token 重试原请求
        res = await fetch(`${API_BASE}${path}`, {
          ...options,
          headers: { ...this.headers(), ...options?.headers },
        });
      } else {
        // 刷新失败，通知外部清理认证状态
        if (this.onAuthFailure) this.onAuthFailure();
      }
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Request failed (${res.status})`);
    }
    return res.json();
  }

  // ─── Auth ───

  async login(username: string, password: string) {
    return this.request<{
      user: { id: string; username: string; email: string; department: string; roles: string[] };
      accessToken: string;
      refreshToken: string;
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }

  async getMe() {
    return this.request<any>('/auth/me');
  }

  async logout() {
    return this.request<any>('/auth/logout', { method: 'POST' }).catch(() => {});
  }

  async changePassword(oldPassword: string, newPassword: string) {
    return this.request<{ message: string }>('/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ oldPassword, newPassword }),
    });
  }

  // ─── Users ───

  async getUsers(params: { page?: number; pageSize?: number; search?: string; status?: string }) {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params.search) qs.set('search', params.search);
    if (params.status) qs.set('status', params.status);
    return this.request<{ data: UserInfo[]; total: number; page: number; pageSize: number }>(
      `/admin/users?${qs.toString()}`,
    );
  }

  async createUser(data: Partial<UserInfo>) {
    return this.request<UserInfo>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateUser(id: string, data: Partial<UserInfo>) {
    return this.request<UserInfo>(`/admin/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteUser(id: string) {
    return this.request<{ message: string }>(`/admin/users/${id}`, { method: 'DELETE' });
  }

  // ─── Quotas ───

  async getUserQuota(userId: string) {
    return this.request<{
      userId: string;
      tokenDaily: number;
      tokenMonthly: number;
      requestHourly: number;
      limits: Record<string, number>;
    }>(`/quotas/${userId}`);
  }

  async setUserQuota(userId: string, type: string, limit: number) {
    return this.request<{ message: string }>(`/quotas/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ type, limit }),
    });
  }

  // ─── Dashboard ───

  async getDashboard() {
    return this.request<DashboardData>('/admin/dashboard');
  }

  // ─── Audit ───

  async getAuditLogs(params: {
    userId?: string;
    action?: string;
    startTime?: string;
    endTime?: string;
    success?: string;
    limit?: number;
    offset?: number;
  }) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    });
    return this.request<{ data: AuditRecord[]; total: number; offset: number; limit: number }>(
      `/audit/logs?${qs.toString()}`,
    );
  }

  async exportAuditLogs(params: any, format: 'csv' | 'json') {
    const qs = new URLSearchParams({ format });
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') qs.set(k, String(v as string));
    });
    const res = await fetch(`${API_BASE}/audit/export?${qs.toString()}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
  }

  async archiveAuditLogs(beforeDate?: string) {
    return this.request<{ message: string; archivedCount: number }>('/audit/archive', {
      method: 'POST',
      body: JSON.stringify({ beforeDate }),
    });
  }

  async getAuditStats(days = 7) {
    return this.request<any>(`/audit/stats?days=${days}`);
  }

  // ─── Health ───

  async getHealth() {
    const res = await fetch('/health', { headers: this.headers() });
    if (!res.ok) throw new Error('Health check failed');
    return res.json();
  }

  // ─── Chat Sessions ───

  async getSessions(agentId?: string) {
    const qs = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
    return this.request<{ sessions: SessionInfo[] }>(`/chat/sessions${qs}`);
  }

  async getChatHistory(sessionId: string, agentId?: string) {
    const qs = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
    return this.request<{ sessionId: string; messages: { role: string; content: string; thinking?: string; ts: string }[] }>(
      `/chat/history/${encodeURIComponent(sessionId)}${qs}`,
    );
  }

  async deleteSession(sessionId: string, agentId?: string) {
    const qs = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
    return this.request<{ message: string }>(`/chat/history/${encodeURIComponent(sessionId)}${qs}`, {
      method: 'DELETE',
    });
  }

  async renameSession(sessionId: string, title: string, agentId?: string) {
    return this.request<{ message: string; title: string }>(
      `/chat/sessions/${encodeURIComponent(sessionId)}/title`,
      { method: 'PUT', body: JSON.stringify({ title, agentId }) },
    );
  }

  async generateTitle(sessionId: string, agentId?: string) {
    return this.request<{ sessionId: string; title: string }>(
      `/chat/sessions/${encodeURIComponent(sessionId)}/generate-title`,
      { method: 'POST', body: JSON.stringify({ agentId }) },
    );
  }

  async searchMessages(q: string, limit = 50, agentId?: string) {
    const qs = new URLSearchParams({ q, limit: String(limit) });
    if (agentId) qs.set('agentId', agentId);
    return this.request<{ query: string; count: number; results: SearchResult[] }>(
      `/chat/search?${qs.toString()}`,
    );
  }

  async exportSession(sessionId: string, format: 'md' | 'json', agentId?: string) {
    const qs = new URLSearchParams({ format });
    if (agentId) qs.set('agentId', agentId);
    const res = await fetch(
      `${API_BASE}/chat/export/${encodeURIComponent(sessionId)}?${qs.toString()}`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error('Export failed');
    return res.blob();
  }

  // ─── Files ───

  async uploadFile(file: File, subdir?: string) {
    const formData = new FormData();
    formData.append('file', file);
    const qs = subdir ? `?subdir=${encodeURIComponent(subdir)}` : '';
    const res = await fetch(`${API_BASE}/files/upload${qs}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Upload failed');
    }
    return res.json();
  }

  async listFiles(dir: 'files' | 'outputs' = 'files', subdir?: string) {
    const qs = new URLSearchParams({ dir });
    if (subdir) qs.set('subdir', subdir);
    return this.request<{ dir: string; subdir: string; files: FileInfo[] }>(
      `/files/list?${qs.toString()}`,
    );
  }

  async deleteFile(filePath: string) {
    return this.request<{ message: string }>(`/files/${filePath}`, { method: 'DELETE' });
  }

  // ─── MCP Servers ───

  async getMcpServers() {
    return this.request<{ data: McpServerInfo[]; total: number }>('/mcp/servers');
  }

  async createMcpServer(data: Partial<McpServerInfo>) {
    return this.request<{ message: string; server: McpServerInfo }>('/mcp/servers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateMcpServer(id: string, data: Partial<McpServerInfo>) {
    return this.request<{ message: string; server: McpServerInfo }>(`/mcp/servers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteMcpServer(id: string) {
    return this.request<{ message: string }>(`/mcp/servers/${id}`, { method: 'DELETE' });
  }

  async testMcpServer(id: string) {
    return this.request<{ success: boolean; message: string; tools: McpToolInfo[] }>(
      `/mcp/servers/${id}/test`,
      { method: 'POST' },
    );
  }

  async getMcpServerTools(id: string) {
    return this.request<{ tools: McpToolInfo[] }>(`/mcp/servers/${id}/tools`);
  }

  // ─── Personal MCP ───

  async getPersonalMcpServers() {
    return this.request<{ data: McpServerInfo[]; total: number }>('/mcp/personal');
  }

  async createPersonalMcpServer(data: Partial<McpServerInfo>) {
    return this.request<{ message: string; server: McpServerInfo }>('/mcp/personal', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updatePersonalMcpServer(id: string, data: Partial<McpServerInfo>) {
    return this.request<{ message: string; server: McpServerInfo }>(`/mcp/personal/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deletePersonalMcpServer(id: string) {
    return this.request<{ message: string }>(`/mcp/personal/${id}`, { method: 'DELETE' });
  }

  async uploadPersonalMcpServer(file: File, name?: string): Promise<{ message: string; server: McpServerInfo; entryFile: string; toolCount: number }> {
    const formData = new FormData();
    formData.append('file', file);
    if (name) formData.append('name', name);
    const res = await fetch(`${API_BASE}/mcp/personal/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      // 不设 Content-Type，让浏览器自动设 multipart boundary
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || '上传失败');
    }
    return res.json();
  }

  // ─── Skills ───

  async getSkills() {
    return this.request<{ data: SkillInfo[]; total: number }>('/skills');
  }

  async uploadSkill(file: File, meta?: { name?: string; description?: string; command?: string; scriptPath?: string }) {
    const formData = new FormData();
    formData.append('file', file);
    if (meta?.name) formData.append('name', meta.name);
    if (meta?.description) formData.append('description', meta.description);
    if (meta?.command) formData.append('command', meta.command);
    if (meta?.scriptPath) formData.append('scriptPath', meta.scriptPath);
    const res = await fetch(`${API_BASE}/skills/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Upload failed');
    }
    return res.json() as Promise<{ message: string; skill: SkillInfo; scanReport: any }>;
  }

  async updateSkill(id: string, data: Partial<SkillInfo>) {
    return this.request<{ message: string; skill: SkillInfo }>(`/skills/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteSkill(id: string) {
    return this.request<{ message: string }>(`/skills/${id}`, { method: 'DELETE' });
  }

  async scanSkill(id: string) {
    return this.request<{ message: string; scanReport: any }>(`/skills/${id}/scan`, { method: 'POST' });
  }

  async approveSkill(id: string) {
    return this.request<{ message: string; skill: SkillInfo }>(`/skills/${id}/approve`, { method: 'POST' });
  }

  async rejectSkill(id: string, reason?: string) {
    return this.request<{ message: string; skill: SkillInfo }>(`/skills/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async enableSkill(id: string, enabled: boolean) {
    return this.request<{ message: string; skill: SkillInfo }>(`/skills/${id}/enable`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
  }

  // ─── Personal Skills ───

  async getPersonalSkills() {
    return this.request<{ data: SkillInfo[]; total: number }>('/skills/personal');
  }

  async uploadPersonalSkill(file: File, meta?: { name?: string; description?: string; command?: string; scriptPath?: string }) {
    const formData = new FormData();
    formData.append('file', file);
    if (meta?.name) formData.append('name', meta.name);
    if (meta?.description) formData.append('description', meta.description);
    if (meta?.command) formData.append('command', meta.command);
    if (meta?.scriptPath) formData.append('scriptPath', meta.scriptPath);
    const res = await fetch(`${API_BASE}/skills/personal/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Upload failed');
    }
    return res.json() as Promise<{ message: string; skill: SkillInfo; scanReport: any }>;
  }

  async deletePersonalSkill(id: string) {
    return this.request<{ message: string }>(`/skills/personal/${id}`, { method: 'DELETE' });
  }

  // ─── Agents ───

  async getAgents() {
    return this.request<{ agents: AgentInfo[] }>('/agents');
  }

  async createAgent(data: Partial<AgentInfo>) {
    return this.request<{ agent: AgentInfo }>('/agents', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateAgent(id: string, data: Partial<AgentInfo>) {
    return this.request<{ agent: AgentInfo }>(`/agents/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteAgent(id: string) {
    return this.request<{ ok: boolean }>(`/agents/${id}`, { method: 'DELETE' });
  }

  async getChatModels(): Promise<{ models: { id: string; provider?: string; name?: string }[] }> {
    return this.request('/chat/models');
  }

  async setDefaultAgent(id: string) {
    return this.request<{ agent: AgentInfo }>(`/agents/${id}/default`, { method: 'POST' });
  }

  async getAgentConfig(id: string): Promise<{ files: Array<{ name: string; content: string }> }> {
    return this.request<{ files: Array<{ name: string; content: string }> }>(`/agents/${id}/config`);
  }

  async updateAgentConfig(id: string, fileName: string, content: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>(`/agents/${id}/config`, {
      method: 'PUT',
      body: JSON.stringify({ fileName, content }),
    });
  }

  // ─── Scheduler ───

  async getScheduledTasks() {
    return this.request<{ tasks: ScheduledTaskInfo[] }>('/scheduler/tasks');
  }

  async createScheduledTask(data: { name: string; cron: string; taskType: string; taskConfig?: Record<string, any> }) {
    return this.request<{ task: ScheduledTaskInfo }>('/scheduler/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateScheduledTask(id: string, data: Partial<ScheduledTaskInfo>) {
    return this.request<{ task: ScheduledTaskInfo }>(`/scheduler/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteScheduledTask(id: string) {
    return this.request<{ ok: boolean }>(`/scheduler/tasks/${id}`, { method: 'DELETE' });
  }

  async runScheduledTask(id: string) {
    return this.request<{ task: ScheduledTaskInfo; message: string }>(`/scheduler/tasks/${id}/run`, {
      method: 'POST',
    });
  }

  // ─── Reminders ───

  async getDueReminders() {
    return this.request<{ reminders: { id: string; title: string; text?: string; firedAt: string }[] }>(
      '/scheduler/reminders/due',
    );
  }

  async dismissReminder(id: string) {
    return this.request<{ ok: boolean }>(`/scheduler/reminders/${id}/dismiss`, { method: 'POST' });
  }

  // ─── Database Connections ───

  async getDbConnections() {
    return this.request<{ data: DatabaseConnectionInfo[] }>('/user/db-connections');
  }

  async createDbConnection(data: Partial<DatabaseConnectionInfo>) {
    return this.request<{ data: DatabaseConnectionInfo }>('/user/db-connections', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateDbConnection(id: string, data: Partial<DatabaseConnectionInfo>) {
    return this.request<{ data: DatabaseConnectionInfo }>(`/user/db-connections/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteDbConnection(id: string) {
    return this.request<{ ok: boolean }>(`/user/db-connections/${id}`, {
      method: 'DELETE',
    });
  }
}

export const adminApi = new AdminApi();

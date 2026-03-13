/**
 * 统一配置页面
 *
 * 左侧导航菜单 + 右侧内容区，整合所有用户级配置和管理功能：
 * - 用户配置：Agent 设置、MCP 设置、技能设置、环境变量、文件管理、心跳配置
 * - 管理功能（admin）：仪表盘、用户管理、审计日志、MCP 工具、技能管理、系统信息
 */
import { useState } from 'react';
import type { AgentInfo } from '../api';
import {
  Bot,
  Cable,
  Zap,
  Database,
  FolderOpen,
  Clock,
  ArrowLeft,
  LayoutDashboard,
  Users,
  ShieldCheck,
  Settings,
  User,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import AgentsPage from './AgentsPage';
import McpSettingsPage from './McpSettingsPage';
import SkillsSettingsPage from './SkillsSettingsPage';
import EnvConfigPage from './EnvConfigPage';
import FilesPage from './FilesPage';
import SchedulerPage from './SchedulerPage';
import DashboardPage from './DashboardPage';
import UsersPage from './UsersPage';
import AuditPage from './AuditPage';
import SystemPage from './SystemPage';
import PersonalSettingsPage from './PersonalSettingsPage';
import AgentConfigPage from './AgentConfigPage';
import { cn } from '@/lib/utils';

const userMenuItems = [
  { key: 'personal', icon: User, label: '个人设置' },
  { key: 'agents', icon: Bot, label: 'Agent 设置' },
  { key: 'mcp', icon: Cable, label: 'MCP 设置' },
  { key: 'skills', icon: Zap, label: '技能设置' },
  { key: 'db-config', icon: Database, label: '数据库配置' },
  { key: 'files', icon: FolderOpen, label: '文件管理' },
  { key: 'scheduler', icon: Clock, label: '心跳配置' },
];

const adminMenuItems = [
  { key: 'dashboard', icon: LayoutDashboard, label: '仪表盘' },
  { key: 'users', icon: Users, label: '用户管理' },
  { key: 'audit', icon: ShieldCheck, label: '审计日志' },
  { key: 'admin-system', icon: Settings, label: '系统信息' },
];

const sectionComponents: Record<string, React.ComponentType> = {
  personal: PersonalSettingsPage,
  agents: AgentsPage,
  mcp: McpSettingsPage,
  skills: SkillsSettingsPage,
  'db-config': EnvConfigPage,
  files: FilesPage,
  scheduler: SchedulerPage,
  dashboard: DashboardPage,
  users: UsersPage,
  audit: AuditPage,
  'admin-system': SystemPage,
};

export default function SettingsPage() {
  const [activeKey, setActiveKey] = useState('agents');
  const [configAgent, setConfigAgent] = useState<AgentInfo | null>(null);
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isAdmin = user?.roles?.some((r: string) => r.toLowerCase() === 'admin');
  const ActiveComponent = sectionComponents[activeKey];

  return (
    <div className="flex h-full">
      {/* 左侧导航 */}
      <div className="w-[200px] shrink-0 bg-muted/40 border-r overflow-hidden flex flex-col">
        {/* 返回对话 */}
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 rounded-none h-12 px-4 text-muted-foreground hover:text-foreground border-b"
          onClick={() => navigate('/chat')}
        >
          <ArrowLeft className="h-4 w-4" />
          返回对话
        </Button>

        <ScrollArea className="flex-1 pt-2">
          {/* 用户菜单 */}
          <div className="px-2 space-y-0.5">
            {userMenuItems.map((item) => {
              const Icon = item.icon;
              return (
                <Button
                  key={item.key}
                  variant="ghost"
                  className={cn(
                    'w-full justify-start gap-2 h-9 px-3 text-sm font-normal',
                    activeKey === item.key
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => { setActiveKey(item.key); setConfigAgent(null); }}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Button>
              );
            })}
          </div>

          {/* 管理员菜单 */}
          {isAdmin && (
            <>
              <Separator className="my-3 mx-2" />
              <div className="px-2 space-y-0.5">
                {adminMenuItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Button
                      key={item.key}
                      variant="ghost"
                      className={cn(
                        'w-full justify-start gap-2 h-9 px-3 text-sm font-normal',
                        activeKey === item.key
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                      onClick={() => { setActiveKey(item.key); setConfigAgent(null); }}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Button>
                  );
                })}
              </div>
            </>
          )}
        </ScrollArea>
      </div>

      {/* 右侧内容区 */}
      <div className="flex-1 overflow-auto p-6">
        {configAgent ? (
          <AgentConfigPage agent={configAgent} onBack={() => setConfigAgent(null)} />
        ) : activeKey === 'agents' ? (
          <AgentsPage onConfigAgent={setConfigAgent} />
        ) : (
          <ActiveComponent />
        )}
      </div>
    </div>
  );
}

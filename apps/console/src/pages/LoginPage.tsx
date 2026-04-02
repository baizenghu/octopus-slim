/**
 * 管理员登录页 — 现代亮色设计 + 动画效果（shadcn/ui + Tailwind CSS）
 */
import { useState } from 'react';
import { useAuthStore } from '../store';
import { adminApi } from '../api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import {
  User,
  Lock,
  MessageSquare,
  Wrench,
  BarChart3,
  Loader2,
  AlertCircle,
  Sparkles,
  Shield,
  Zap,
  UserPlus,
  CheckCircle2,
} from 'lucide-react';
import { OctopusIcon } from '@/components/OctopusIcon';

const features = [
  { icon: MessageSquare, label: '智能对话', desc: '多模型 AI 助手' },
  { icon: Wrench, label: '工具集成', desc: 'MCP 协议扩展' },
  { icon: BarChart3, label: '数据分析', desc: '审计与可视化' },
  { icon: Shield, label: '企业安全', desc: '沙箱隔离执行' },
];

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const { login, isLoading } = useAuthStore();

  const switchMode = (next: 'login' | 'register') => {
    setMode(next);
    setError('');
    setRegisterSuccess(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'register') {
      if (!username.trim() || !password.trim()) {
        setError('请输入用户名和密码');
        return;
      }
      if (password !== confirmPassword) {
        setError('两次输入的密码不一致');
        return;
      }
      setIsRegistering(true);
      try {
        await adminApi.register(username.trim(), password, displayName.trim() || undefined);
        setRegisterSuccess(true);
        setPassword('');
        setConfirmPassword('');
        setDisplayName('');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '注册失败';
        setError(message);
      } finally {
        setIsRegistering(false);
      }
      return;
    }

    if (!username.trim() || !password.trim()) {
      setError('请输入用户名和密码');
      return;
    }
    try {
      await login(username, password);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '登录失败';
      setError(message);
    }
  };

  return (
    <div className="flex min-h-screen w-full">
      {/* ========== 左侧品牌展示区 ========== */}
      <div className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center bg-gradient-to-br from-indigo-600 via-purple-600 to-violet-700 p-12 relative overflow-hidden animate-gradient-shift">
        {/* 装饰浮动圆 */}
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-white/5 rounded-full animate-float-slow" />
        <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] bg-white/5 rounded-full animate-float" style={{ animationDelay: '2s' }} />
        <div className="absolute top-1/4 right-12 w-32 h-32 bg-white/5 rounded-full animate-pulse-glow" />
        <div className="absolute bottom-1/4 left-16 w-20 h-20 bg-white/5 rounded-full animate-float" style={{ animationDelay: '4s' }} />

        {/* 光带扫过效果 */}
        <div className="absolute inset-0 animate-shimmer pointer-events-none" />

        {/* 内容 */}
        <div className="relative z-10 flex flex-col items-center gap-6 text-center">
          {/* Logo + 光环 */}
          <div className="relative animate-scale-in">
            <div className="absolute inset-0 w-28 h-28 -m-2 rounded-3xl bg-white/10 animate-pulse-glow" />
            <div className="flex items-center justify-center w-24 h-24 rounded-2xl bg-white/15 backdrop-blur-sm border border-white/20 shadow-2xl">
              <OctopusIcon className="w-16 h-16 text-white drop-shadow-lg" animated />
            </div>
            <Sparkles className="absolute -top-2 -right-2 w-6 h-6 text-yellow-300 animate-bounce-gentle" />
          </div>

          <h1 className="text-5xl font-bold text-white tracking-tight animate-slide-up delay-200">
            Octopus AI
          </h1>
          <p className="text-lg text-indigo-100 font-medium animate-slide-up delay-300">
            智能企业助手平台
          </p>

          {/* Feature 卡片 */}
          <div className="grid grid-cols-2 gap-4 mt-10 w-full max-w-sm">
            {features.map(({ icon: Icon, label, desc }, i) => (
              <div
                key={label}
                className={cn(
                  'flex flex-col items-center gap-2 p-4 rounded-xl bg-white/10 backdrop-blur-sm border border-white/15',
                  'hover-lift cursor-default animate-slide-up',
                  'hover:bg-white/20 transition-colors duration-300'
                )}
                style={{ animationDelay: `${400 + i * 100}ms` }}
              >
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/15">
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <span className="text-sm font-medium text-white">{label}</span>
                <span className="text-xs text-indigo-200">{desc}</span>
              </div>
            ))}
          </div>

          {/* 底部装饰 */}
          <div className="flex items-center gap-2 mt-8 animate-fade-in delay-800">
            <Zap className="w-4 h-4 text-yellow-300" />
            <span className="text-sm text-indigo-200">Powered by DeepSeek & Claude</span>
          </div>
        </div>
      </div>

      {/* ========== 右侧登录表单区 ========== */}
      <div className="flex w-full lg:w-1/2 items-center justify-center bg-white p-6 sm:p-12 relative overflow-hidden">
        {/* 淡色装饰 */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-50 rounded-full -translate-y-1/2 translate-x-1/2 opacity-50" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-50 rounded-full translate-y-1/2 -translate-x-1/2 opacity-50" />

        <div className="w-full max-w-md space-y-8 relative z-10">
          {/* 移动端 Logo */}
          <div className="flex items-center gap-2 lg:hidden animate-slide-down">
            <OctopusIcon className="w-9 h-9 text-indigo-600" />
            <span className="text-xl font-bold text-gray-900">Octopus AI</span>
          </div>

          {/* 标题 */}
          <div className="space-y-2 animate-slide-up delay-100">
            <h2 className="text-3xl font-bold tracking-tight text-gray-900">
              {mode === 'login' ? '欢迎回来' : '创建账号'}
            </h2>
            <p className="text-muted-foreground">
              {mode === 'login' ? '请输入您的账号信息登录系统' : '填写以下信息完成注册'}
            </p>
          </div>

          {/* 错误提示 */}
          {error && (
            <Alert variant="destructive" className="animate-slide-down">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* 注册成功提示 */}
          {registerSuccess && (
            <Alert className="border-emerald-200 bg-emerald-50 animate-slide-down">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <AlertDescription className="text-emerald-700">
                注册成功！请使用新账号登录。
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="ml-1 font-medium underline cursor-pointer"
                >
                  立即登录
                </button>
              </AlertDescription>
            </Alert>
          )}

          {/* 表单 */}
          <form onSubmit={handleSubmit} className="space-y-5 animate-slide-up delay-200">
            <div className="space-y-2">
              <Label htmlFor="username">用户名</Label>
              <div className="relative group">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-indigo-500" />
                <Input
                  id="username"
                  placeholder={mode === 'register' ? '字母、数字、连字符，2-32位' : '请输入用户名'}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="pl-10 h-11 transition-shadow duration-300 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.1)]"
                  autoComplete="username"
                />
              </div>
            </div>

            {mode === 'register' && (
              <div className="space-y-2">
                <Label htmlFor="displayName">显示名称 <span className="text-muted-foreground text-xs">（可选）</span></Label>
                <div className="relative group">
                  <UserPlus className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-indigo-500" />
                  <Input
                    id="displayName"
                    placeholder="您的姓名或昵称"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="pl-10 h-11 transition-shadow duration-300 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.1)]"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <div className="relative group">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-indigo-500" />
                <Input
                  id="password"
                  type="password"
                  placeholder={mode === 'register' ? '至少8位，含字母和数字' : '请输入密码'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 h-11 transition-shadow duration-300 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.1)]"
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                />
              </div>
            </div>

            {mode === 'register' && (
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">确认密码</Label>
                <div className="relative group">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-indigo-500" />
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="再次输入密码"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="pl-10 h-11 transition-shadow duration-300 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.1)]"
                    autoComplete="new-password"
                  />
                </div>
              </div>
            )}

            <Button
              type="submit"
              className={cn(
                'w-full h-11 text-base font-medium',
                'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700',
                'transition-all duration-300 hover:shadow-lg hover:shadow-indigo-500/25',
                'active:scale-[0.98]'
              )}
              disabled={isLoading || isRegistering}
            >
              {(isLoading || isRegistering) ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {mode === 'register' ? '注册中...' : '登录中...'}
                </>
              ) : (
                mode === 'register' ? '立即注册' : '登 录'
              )}
            </Button>
          </form>

          {/* 切换登录/注册 */}
          <div className="text-center text-sm animate-fade-in delay-400">
            {mode === 'login' ? (
              <span className="text-muted-foreground">
                还没有账号？
                <button
                  type="button"
                  onClick={() => switchMode('register')}
                  className="ml-1 text-indigo-600 hover:text-indigo-700 font-medium cursor-pointer"
                >
                  立即注册
                </button>
              </span>
            ) : (
              <span className="text-muted-foreground">
                已有账号？
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="ml-1 text-indigo-600 hover:text-indigo-700 font-medium cursor-pointer"
                >
                  返回登录
                </button>
              </span>
            )}
          </div>

          {/* 底部版权 */}
          <p className="text-center text-xs text-muted-foreground animate-fade-in delay-500">
            &copy; {new Date().getFullYear()} Octopus AI &mdash; 智能企业助手平台
          </p>
        </div>
      </div>
    </div>
  );
}

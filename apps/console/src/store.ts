/**
 * 认证状态管理 (zustand)
 * 所有用户均可登录，admin 角色通过 UI 路由控制权限
 */
import { create } from 'zustand';
import { adminApi } from './api';

interface UserInfo {
  id: string;
  username: string;
  email: string;
  department: string;
  roles: string[];
}

interface AuthState {
  user: UserInfo | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  restoreSession: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,

  login: async (username: string, password: string) => {
    set({ isLoading: true });
    try {
      const result = await adminApi.login(username, password);

      adminApi.setToken(result.accessToken);
      adminApi.setRefreshToken(result.refreshToken);
      localStorage.setItem('admin_token', result.accessToken);
      localStorage.setItem('admin_refresh_token', result.refreshToken);
      localStorage.setItem('admin_user', JSON.stringify(result.user));

      set({
        user: result.user,
        token: result.accessToken,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  logout: () => {
    adminApi.logout().catch(() => {});
    adminApi.setToken(null);
    adminApi.setRefreshToken(null);
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_refresh_token');
    localStorage.removeItem('admin_user');
    set({
      user: null,
      token: null,
      isAuthenticated: false,
    });
  },

  restoreSession: () => {
    const token = localStorage.getItem('admin_token');
    const refreshToken = localStorage.getItem('admin_refresh_token');
    const userStr = localStorage.getItem('admin_user');

    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        adminApi.setToken(token);
        adminApi.setRefreshToken(refreshToken);
        // 注册认证失败回调：token 刷新彻底失败时自动登出
        adminApi.setOnAuthFailure(() => {
          useAuthStore.getState().logout();
        });
        set({
          user,
          token,
          isAuthenticated: true,
        });
      } catch {
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_refresh_token');
        localStorage.removeItem('admin_user');
      }
    }
  },
}));

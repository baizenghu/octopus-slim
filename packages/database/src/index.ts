/**
 * 数据库访问层
 * 封装 Prisma Client，提供统一的数据库连接管理
 */
import { PrismaClient } from '@prisma/client';

// 单例模式：确保整个应用只有一个 PrismaClient 实例
let prismaInstance: PrismaClient | null = null;

/**
 * 获取 Prisma Client 单例
 * 支持开发环境热重载时复用连接
 */
export function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
      log: process.env.NODE_ENV === 'development'
        ? ['query', 'info', 'warn', 'error']
        : ['error'],
    });
  }
  return prismaInstance;
}

/**
 * 关闭数据库连接
 * 在应用关闭时调用
 */
export async function disconnectDatabase(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
  }
}

// 导出 Prisma Client 实例（便捷用法）
export const db = getPrismaClient();

// 重新导出 Prisma Client 类型
export { PrismaClient } from '@prisma/client';

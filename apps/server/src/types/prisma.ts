/**
 * Prisma Client 统一类型定义
 *
 * 用于替换路由函数签名中的 prisma: any，提供类型安全
 */
import type { PrismaClient } from '@prisma/client';

/** 应用级 Prisma Client 类型 */
export type AppPrismaClient = PrismaClient;

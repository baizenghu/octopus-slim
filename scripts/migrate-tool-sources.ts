/**
 * 一次性迁移：将所有 Agent 的 mcpFilter + skillsFilter 合并写入 allowedToolSources
 * 用法：npx tsx scripts/migrate-tool-sources.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const agents = await prisma.agent.findMany();
  let migrated = 0;
  let skipped = 0;

  for (const agent of agents) {
    // 已有 allowedToolSources 的跳过
    if (agent.allowedToolSources !== null && agent.allowedToolSources !== undefined) {
      console.log(`  Skip ${agent.id} — already has allowedToolSources`);
      skipped++;
      continue;
    }

    const mcpFilter = (agent.mcpFilter as string[]) ?? [];
    const skillsFilter = (agent.skillsFilter as string[]) ?? [];

    // 都为空 = 全部可用 → null
    const allowedToolSources = mcpFilter.length === 0 && skillsFilter.length === 0
      ? null
      : [...mcpFilter, ...skillsFilter];

    await prisma.agent.update({
      where: { id: agent.id },
      data: { allowedToolSources: allowedToolSources ?? undefined },
    });

    const display = allowedToolSources ? JSON.stringify(allowedToolSources) : 'null (all allowed)';
    console.log(`  Migrated ${agent.id}: ${display}`);
    migrated++;
  }

  console.log(`\nDone. Migrated: ${migrated}, Skipped: ${skipped}, Total: ${agents.length}`);
}

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

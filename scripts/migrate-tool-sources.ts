/**
 * 一次性迁移：将所有 Agent 的 mcpFilter + skillsFilter 合并写入 allowedToolSources
 * 用法：npx tsx scripts/migrate-tool-sources.ts [--dry-run]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

async function main() {
  if (dryRun) console.log('=== DRY RUN MODE (no changes will be written) ===\n');

  const agents = await prisma.agent.findMany();
  const updates: Array<{ id: string; allowedToolSources: string[] | null }> = [];

  for (const agent of agents) {
    if (agent.allowedToolSources !== null && agent.allowedToolSources !== undefined) {
      console.log(`  Skip ${agent.id} — already has allowedToolSources`);
      continue;
    }

    const mcpFilter = (agent.mcpFilter as string[]) ?? [];
    const skillsFilter = (agent.skillsFilter as string[]) ?? [];
    const allowedToolSources = mcpFilter.length === 0 && skillsFilter.length === 0
      ? null
      : [...mcpFilter, ...skillsFilter];

    updates.push({ id: agent.id, allowedToolSources });
    const display = allowedToolSources ? JSON.stringify(allowedToolSources) : 'null (all allowed)';
    console.log(`  ${dryRun ? '[DRY] ' : ''}Migrate ${agent.id}: ${display}`);
  }

  if (dryRun) {
    console.log(`\nDry run complete. Would migrate ${updates.length}/${agents.length} agents.`);
    return;
  }

  if (updates.length === 0) {
    console.log('\nNothing to migrate.');
    return;
  }

  // 事务包装，确保原子性
  await prisma.$transaction(
    updates.map(u => prisma.agent.update({
      where: { id: u.id },
      data: { allowedToolSources: u.allowedToolSources ?? undefined },
    })),
  );

  console.log(`\nDone. Migrated: ${updates.length}, Total: ${agents.length}`);
}

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

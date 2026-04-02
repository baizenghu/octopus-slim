-- AlterTable: 为 agent_tasks 增加优先级字段
ALTER TABLE `agent_tasks` ADD COLUMN `priority` INT NOT NULL DEFAULT 0;

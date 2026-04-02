-- Wave5 Task 1: AgentTask Token 消耗统计
-- 为 agent_tasks 表增加 input_tokens / output_tokens / model_name 字段
ALTER TABLE `agent_tasks`
  ADD COLUMN `input_tokens` INT NULL,
  ADD COLUMN `output_tokens` INT NULL,
  ADD COLUMN `model_name` VARCHAR(128) NULL;

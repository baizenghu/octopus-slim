-- CreateTable
CREATE TABLE `agent_tasks` (
    `task_id` VARCHAR(64) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `agent_name` VARCHAR(255) NOT NULL,
    `message` TEXT NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `progress` JSON NOT NULL DEFAULT ('[]'),
    `result` LONGTEXT NULL,
    `error` TEXT NULL,
    `run_id` VARCHAR(128) NULL,
    `session_key` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,

    INDEX `agent_tasks_user_id_status_idx`(`user_id`, `status`),
    INDEX `agent_tasks_created_at_idx`(`created_at`),
    PRIMARY KEY (`task_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `agent_tasks` ADD CONSTRAINT `agent_tasks_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;

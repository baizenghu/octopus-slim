-- CreateTable
CREATE TABLE `users` (
    `user_id` VARCHAR(64) NOT NULL,
    `username` VARCHAR(255) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `display_name` VARCHAR(255) NULL,
    `department` VARCHAR(255) NULL,
    `roles` JSON NOT NULL,
    `quotas` JSON NOT NULL,
    `password_hash` VARCHAR(255) NULL,
    `avatar_path` VARCHAR(512) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `ldap_dn` VARCHAR(512) NULL,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_username_key`(`username`),
    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_department_idx`(`department`),
    INDEX `users_status_idx`(`status`),
    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `log_id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` VARCHAR(64) NULL,
    `action` VARCHAR(255) NOT NULL,
    `resource` VARCHAR(512) NULL,
    `details` JSON NULL,
    `ip_address` VARCHAR(45) NULL,
    `user_agent` VARCHAR(512) NULL,
    `success` BOOLEAN NOT NULL DEFAULT true,
    `error_message` TEXT NULL,
    `duration_ms` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_user_id_idx`(`user_id`),
    INDEX `audit_logs_action_idx`(`action`),
    INDEX `audit_logs_created_at_idx`(`created_at`),
    INDEX `audit_logs_user_id_action_created_at_idx`(`user_id`, `action`, `created_at`),
    PRIMARY KEY (`log_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_sessions` (
    `session_id` VARCHAR(128) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `token_hash` VARCHAR(128) NOT NULL,
    `ip_address` VARCHAR(45) NULL,
    `user_agent` VARCHAR(512) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_sessions_user_id_idx`(`user_id`),
    PRIMARY KEY (`session_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tool_sources` (
    `source_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `scope` VARCHAR(20) NOT NULL DEFAULT 'enterprise',
    `owner_id` VARCHAR(64) NULL,
    `transport` VARCHAR(20) NULL,
    `command` VARCHAR(512) NULL,
    `args` JSON NULL,
    `url` VARCHAR(512) NULL,
    `env` JSON NULL,
    `script_path` VARCHAR(512) NULL,
    `runtime` VARCHAR(20) NULL,
    `description` TEXT NULL,
    `tools` JSON NULL,
    `config` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tool_sources_name_key`(`name`),
    INDEX `tool_sources_owner_id_scope_idx`(`owner_id`, `scope`),
    PRIMARY KEY (`source_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agents` (
    `agent_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `description` VARCHAR(1024) NULL,
    `owner_id` VARCHAR(64) NOT NULL,
    `model` VARCHAR(128) NULL,
    `system_prompt` TEXT NULL,
    `identity` JSON NULL,
    `allowed_tool_sources` JSON NULL,
    `tools_profile` VARCHAR(64) NULL,
    `tools_deny` JSON NULL,
    `tools_allow` JSON NULL,
    `subagents` JSON NULL,
    `memory_scope` JSON NULL,
    `sandbox_mode` VARCHAR(20) NULL,
    `skills_filter` JSON NULL,
    `mcp_filter` JSON NULL,
    `tools_filter` JSON NULL,
    `allowed_connections` JSON NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `agents_owner_id_idx`(`owner_id`),
    PRIMARY KEY (`agent_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `im_channels` (
    `channel_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `webhook_url` VARCHAR(512) NULL,
    `bot_token` VARCHAR(512) NULL,
    `config` JSON NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`channel_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `im_user_bindings` (
    `binding_id` VARCHAR(64) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `channel` VARCHAR(20) NOT NULL,
    `im_user_id` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `im_user_bindings_user_id_idx`(`user_id`),
    UNIQUE INDEX `im_user_bindings_channel_im_user_id_key`(`channel`, `im_user_id`),
    PRIMARY KEY (`binding_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scheduled_tasks` (
    `task_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `cron` VARCHAR(64) NOT NULL,
    `task_type` VARCHAR(20) NOT NULL,
    `task_config` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `last_run_at` DATETIME(3) NULL,
    `next_run_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `scheduled_tasks_user_id_idx`(`user_id`),
    PRIMARY KEY (`task_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mail_logs` (
    `log_id` VARCHAR(64) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `to` TEXT NOT NULL,
    `subject` VARCHAR(255) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `mail_logs_user_id_idx`(`user_id`),
    PRIMARY KEY (`log_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `database_connections` (
    `connection_id` VARCHAR(64) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `db_type` VARCHAR(20) NOT NULL,
    `host` VARCHAR(255) NOT NULL,
    `port` INTEGER NOT NULL,
    `db_user` VARCHAR(255) NOT NULL,
    `db_password` VARCHAR(512) NOT NULL,
    `db_name` VARCHAR(255) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `database_connections_user_id_idx`(`user_id`),
    UNIQUE INDEX `database_connections_user_id_name_key`(`user_id`, `name`),
    PRIMARY KEY (`connection_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `generated_files` (
    `file_id` VARCHAR(512) NOT NULL,
    `user_id` VARCHAR(64) NOT NULL,
    `category` VARCHAR(20) NOT NULL,
    `file_path` VARCHAR(1024) NOT NULL,
    `file_size` INTEGER NOT NULL,
    `skill_id` VARCHAR(64) NULL,
    `agent_name` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',

    INDEX `generated_files_user_id_idx`(`user_id`),
    INDEX `generated_files_status_expires_at_idx`(`status`, `expires_at`),
    INDEX `generated_files_user_id_category_idx`(`user_id`, `category`),
    PRIMARY KEY (`file_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_sessions` ADD CONSTRAINT `user_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Octopus Enterprise 初始数据库结构
-- 版本: v1.0
-- 数据库: MySQL 8.0+

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  user_id VARCHAR(64) PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(255),
  department VARCHAR(255),
  roles JSON NOT NULL COMMENT '角色列表 ["ADMIN","USER"]',
  quotas JSON NOT NULL COMMENT '配额设置',
  status VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'active/inactive/suspended',
  ldap_dn VARCHAR(512) COMMENT 'LDAP DN',
  last_login_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_username (username),
  INDEX idx_users_department (department),
  INDEX idx_users_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 审计日志表
CREATE TABLE IF NOT EXISTS audit_logs (
  log_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(64),
  action VARCHAR(255) NOT NULL COMMENT '操作类型',
  resource VARCHAR(512) COMMENT '操作资源',
  details JSON COMMENT '操作详情',
  ip_address VARCHAR(45),
  user_agent VARCHAR(512),
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,
  duration_ms INT COMMENT '操作耗时(毫秒)',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_audit_user (user_id),
  INDEX idx_audit_action (action),
  INDEX idx_audit_created (created_at),
  INDEX idx_audit_user_action (user_id, action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 用户会话表（跟踪活跃会话）
CREATE TABLE IF NOT EXISTS user_sessions (
  session_id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  token_hash VARCHAR(128) NOT NULL COMMENT 'JWT token hash',
  ip_address VARCHAR(45),
  user_agent VARCHAR(512),
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_session_user (user_id),
  INDEX idx_session_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

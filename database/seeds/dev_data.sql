-- 开发环境种子数据
-- 仅用于本地开发和测试

-- 管理员用户
INSERT INTO users (user_id, username, email, display_name, department, roles, quotas, status) VALUES
('admin-001', 'admin', 'admin@sgcc.com.cn', '系统管理员', '信息中心', 
 '["ADMIN"]', 
 '{"maxApiCallsDaily": 10000, "maxStorageMB": 10240, "maxConcurrentSessions": 10}',
 'active');

-- 高级用户
INSERT INTO users (user_id, username, email, display_name, department, roles, quotas, status) VALUES
('power-001', 'zhangsan', 'zhangsan@sgcc.com.cn', '张三', '调度中心',
 '["POWER_USER"]',
 '{"maxApiCallsDaily": 5000, "maxStorageMB": 5120, "maxConcurrentSessions": 5}',
 'active');

-- 普通用户
INSERT INTO users (user_id, username, email, display_name, department, roles, quotas, status) VALUES
('user-001', 'lisi', 'lisi@sgcc.com.cn', '李四', '运维部门',
 '["USER"]',
 '{"maxApiCallsDaily": 1000, "maxStorageMB": 1024, "maxConcurrentSessions": 3}',
 'active'),
('user-002', 'wangwu', 'wangwu@sgcc.com.cn', '王五', '营销部门',
 '["USER"]',
 '{"maxApiCallsDaily": 1000, "maxStorageMB": 1024, "maxConcurrentSessions": 3}',
 'active');

-- 只读用户
INSERT INTO users (user_id, username, email, display_name, department, roles, quotas, status) VALUES
('readonly-001', 'zhaoliu', 'zhaoliu@sgcc.com.cn', '赵六', '财务部门',
 '["READONLY"]',
 '{"maxApiCallsDaily": 500, "maxStorageMB": 512, "maxConcurrentSessions": 2}',
 'active');

-- 审计日志示例数据
INSERT INTO audit_logs (user_id, action, resource, details, ip_address, success) VALUES
('admin-001', 'USER_LOGIN', '/auth/login', '{"method": "LDAP"}', '192.168.1.100', true),
('power-001', 'CHAT_MESSAGE', '/chat/session-001', '{"model": "deepseek-chat", "tokens": 1250}', '192.168.1.101', true),
('user-001', 'FILE_UPLOAD', '/files/report.pdf', '{"size": 2048576, "type": "application/pdf"}', '192.168.1.102', true);

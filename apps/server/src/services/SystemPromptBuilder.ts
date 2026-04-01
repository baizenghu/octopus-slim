/**
 * SystemPromptBuilder — 企业级系统提示缓存管理
 *
 * 实际的 prompt 段落构建由 enterprise-prompt-sections.ts 实现，
 * 注入由 enterprise-mcp 插件的 before_prompt_build hook 执行。
 *
 * enterprise-mcp 插件内部有独立的 5 分钟 TTL 缓存（_enterpriseCtxCache），
 * 无法从企业层直接清除（跨进程），缓存刷新依赖 TTL 自然过期。
 */

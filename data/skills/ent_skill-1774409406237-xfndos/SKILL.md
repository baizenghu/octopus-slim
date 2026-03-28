---
name: team-research
description: 多角色团队协作式研究分析工具（调研报告/头脑风暴/发言稿）
version: 1.0.0
command-dispatch: tool
command-tool: run_skill
---

# ClawTeam 多智能体协作研究

## 能力
多角色团队协作式研究分析工具，借鉴 ClawTeam 多 Agent 协调模式。
支持三种工作模式：
- 调研报告（research-survey）：政策/行业/技术调研，输出正式调研报告
- 头脑风暴（brainstorm）：多视角创意发散与方案收敛
- 发言稿（speech-draft）：领导讲话稿/汇报材料撰写

## 参数
通过 run_skill 的 args 字符串传递命令行参数：

| 参数 | 必填 | 说明 |
|------|------|------|
| --topic | 是 | 研究/讨论主题 |
| --template | 否 | 模板名：research-survey / brainstorm / speech-draft。不指定时根据关键词自动匹配 |
| --context | 否 | 补充背景（目标受众、字数要求、特殊要求等） |
| --depth | 否 | 研究深度：quick(3 worker) / standard(5) / deep(7)，默认 standard |
| --source-file | 否 | 原始参考材料的文件路径（workspace 内相对路径或绝对路径）。用户提供了附件或文档时必须使用此参数 |

## 重要：当用户提供了参考材料时
如果用户上传了文件、附件或提供了文档内容，**必须**使用 --source-file 参数把完整材料传递给 skill。

**禁止**把文件内容总结/摘要后塞进 --topic 或 --context，这样会丢失原始材料导致输出编造内容。

传递方式：
- 附件文件已在 workspace 中（如 `files/xxx.md`）→ 直接用 `--source-file 'files/xxx.md'`
- 用户在消息中粘贴了文本 → 先 write_file 保存，再用 --source-file 指定路径

## 触发示例
- "用团队研究调研 国企数字化转型中AI大模型的落地路径"
- "用团队研究头脑风暴 如何提升集团内部知识管理效率"
- "用团队研究写发言稿 集团年度科技创新大会领导致辞"
- "根据我提供的资料写一份汇报发言稿"（用户上传了文件）

## 调用方式
run_skill(skill_name="team-research", args="--topic '国企数字化转型' --template research-survey --depth standard")

### 带参考材料的调用方式（用户上传了附件）
```
# 附件已在 files/ 目录，直接传路径
run_skill(skill_name="team-research", args="--topic 'Octopus平台汇报发言稿' --template speech-draft --source-file 'files/Octopus企业级AI-Agent平台-汇报材料.md'")
```

### 带参考材料的调用方式（用户粘贴了文本）
```
# 1. 先保存为文件
write_file(path="team-source.md", content="用户粘贴的完整材料内容...")
# 2. 再调用 skill
run_skill(skill_name="team-research", args="--topic 'Octopus平台汇报发言稿' --template speech-draft --source-file team-source.md")
```

## 输出
Markdown 格式报告，保存至 outputs/ 目录。

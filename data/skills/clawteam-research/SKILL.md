---
name: clawteam-research
description: 多角色团队协作式研究分析工具（调研报告/头脑风暴/发言稿）
license: MIT
compatibility: opencode
metadata:
  audience: 国企用户
  category: 研究分析
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

## 触发示例
- "用 clawteam 调研 国企数字化转型中AI大模型的落地路径"
- "用 clawteam 头脑风暴 如何提升集团内部知识管理效率"
- "用 clawteam 写发言稿 集团年度科技创新大会领导致辞"

## 调用方式
run_skill(skill_name="clawteam-research", args="--topic '国企数字化转型' --template research-survey --depth standard")

## 输出
Markdown 格式报告，保存至 outputs/ 目录。

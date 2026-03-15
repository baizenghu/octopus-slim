# 标书生成 Skill 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建一个标书生成 Skill，通过 extract.py 提取 .docx 文档结构、render.py 在副本上执行修改指令，实现基于模板的标书自动生成。

**Architecture:** 两个独立 Python 脚本（extract.py + render.py），通过 `run_skill` 工具的 `script` 参数分别调用。AI agent 先调用 extract 获取文档结构 JSON，分析后生成修改指令 JSON，再调用 render 执行修改。

**Tech Stack:** Python 3.12, python-docx, argparse, json

**Spec:** `docs/superpowers/specs/2026-03-13-bid-document-skill-design.md`

---

## File Structure

| 文件 | 职责 |
|------|------|
| `data/skills/skill-bid-document/SKILL.md` | Skill 描述文件，AI 自动发现并读取使用说明 |
| `data/skills/skill-bid-document/scripts/extract.py` | 提取 .docx 段落+表格结构，输出 JSON 到 stdout |
| `data/skills/skill-bid-document/scripts/render.py` | 读取修改指令 JSON，在文档副本上执行文本替换 |
| `data/skills/requirements.txt` | 添加 `python-docx` 依赖 |

---

## Chunk 1: 依赖安装 + extract.py

### Task 1: 安装 python-docx 依赖

**Files:**
- Modify: `data/skills/requirements.txt`

- [ ] **Step 1: 添加 python-docx 到 requirements.txt**

在 `data/skills/requirements.txt` 末尾添加：
```
python-docx==1.1.2
```

- [ ] **Step 2: 安装到共享 venv**

Run: `data/skills/.venv/bin/pip install python-docx==1.1.2`
Expected: `Successfully installed python-docx-1.1.2`

- [ ] **Step 3: 验证安装**

Run: `data/skills/.venv/bin/python3 -c "from docx import Document; print('OK')"`
Expected: `OK`

---

### Task 2: 实现 extract.py

**Files:**
- Create: `data/skills/skill-bid-document/scripts/extract.py`

- [ ] **Step 1: 创建目录结构**

Run: `mkdir -p data/skills/skill-bid-document/scripts`

- [ ] **Step 2: 编写 extract.py**

```python
#!/usr/bin/env python3
"""
extract.py — 提取 .docx 文档的段落和表格结构，输出 JSON。

用法: python3 extract.py --input <file.docx>
输出: JSON 到 stdout
"""

import sys
import json
import argparse
from docx import Document
from docx.oxml.ns import qn


def extract_structure(doc_path: str) -> dict:
    """提取文档段落和表格结构。"""
    doc = Document(doc_path)

    # 段落提取
    paragraphs = []
    for i, para in enumerate(doc.paragraphs):
        paragraphs.append({
            "index": i,
            "text": para.text,
            "style": para.style.name if para.style else "Normal",
        })

    # 表格提取（含位置信息）
    tables = []
    # 用 body 子元素顺序确定 table 在段落间的位置
    para_count = 0
    table_idx = 0
    for element in doc.element.body:
        tag = element.tag.split('}')[-1] if '}' in element.tag else element.tag
        if tag == 'p':
            para_count += 1
        elif tag == 'tbl':
            if table_idx < len(doc.tables):
                tbl = doc.tables[table_idx]
                rows = []
                for row in tbl.rows:
                    cells = [cell.text for cell in row.cells]
                    rows.append(cells)
                tables.append({
                    "index": table_idx,
                    "location_after_paragraph": para_count - 1,
                    "rows": rows,
                })
                table_idx += 1

    return {"paragraphs": paragraphs, "tables": tables}


def main():
    parser = argparse.ArgumentParser(description="提取 .docx 文档结构")
    parser.add_argument("--input", required=True, help="源 .docx 文件路径")
    args = parser.parse_args()

    try:
        result = extract_structure(args.input)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except Exception as e:
        print(f"错误: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: 创建测试用 .docx 文件并验证**

用 python-docx 创建一个简单的测试文档，然后用 extract.py 提取：

```bash
data/skills/.venv/bin/python3 -c "
from docx import Document
doc = Document()
doc.add_heading('测试标题', level=1)
doc.add_paragraph('第一段正文内容')
table = doc.add_table(rows=2, cols=2)
table.cell(0, 0).text = '姓名'
table.cell(0, 1).text = '张三'
table.cell(1, 0).text = '职位'
table.cell(1, 1).text = '经理'
doc.add_paragraph('表格后的段落')
doc.save('/tmp/test_bid.docx')
print('测试文档已创建')
"
```

Run: `data/skills/.venv/bin/python3 data/skills/skill-bid-document/scripts/extract.py --input /tmp/test_bid.docx`

Expected: JSON 输出包含 paragraphs 数组（含 "测试标题"、"第一段正文内容"、"表格后的段落"）和 tables 数组（含 1 个表格，2 行 2 列）。

- [ ] **Step 4: 验证错误处理**

Run: `data/skills/.venv/bin/python3 data/skills/skill-bid-document/scripts/extract.py --input /tmp/nonexistent.docx; echo "EXIT: $?"`

Expected: stderr 输出错误信息，退出码 1。

---

## Chunk 2: render.py

### Task 3: 实现 render.py

**Files:**
- Create: `data/skills/skill-bid-document/scripts/render.py`

- [ ] **Step 1: 编写 render.py**

```python
#!/usr/bin/env python3
"""
render.py — 在 .docx 文档副本上执行修改指令，生成新文档。

用法: python3 render.py --input <src.docx> --output <dst.docx> --instructions <instructions.json>
"""

import sys
import json
import shutil
import argparse
from docx import Document


def replace_paragraph_text(paragraph, new_text: str):
    """替换段落文本，保留首个 run 的格式。"""
    if not paragraph.runs:
        # 无 run，直接设置文本
        paragraph.text = new_text
        return

    # 保留第一个 run 的格式，设置新文本
    first_run = paragraph.runs[0]
    first_run.text = new_text

    # 清空后续 runs
    for run in paragraph.runs[1:]:
        run.text = ""


def replace_cell_text(cell, new_text: str):
    """替换表格单元格文本，保留首个 run 的格式。"""
    # 单元格可能有多个段落，只修改第一个
    if not cell.paragraphs:
        return

    para = cell.paragraphs[0]
    replace_paragraph_text(para, new_text)

    # 清空后续段落
    for p in cell.paragraphs[1:]:
        p.text = ""


def apply_instructions(doc_path: str, output_path: str, instructions: dict):
    """在文档副本上执行修改指令。"""
    # 复制源文件
    shutil.copy2(doc_path, output_path)

    # 打开副本进行修改
    doc = Document(output_path)

    # 段落修改
    para_instructions = instructions.get("paragraphs", [])
    for instr in para_instructions:
        idx = instr["index"]
        action = instr.get("action", "replace")
        if action != "replace":
            print(f"警告: 不支持的操作 '{action}'，跳过段落 {idx}", file=sys.stderr)
            continue
        if idx < 0 or idx >= len(doc.paragraphs):
            print(f"警告: 段落索引 {idx} 超出范围 (0-{len(doc.paragraphs)-1})，跳过", file=sys.stderr)
            continue
        replace_paragraph_text(doc.paragraphs[idx], instr["new_text"])

    # 表格修改
    table_instructions = instructions.get("tables", [])
    for tbl_instr in table_instructions:
        tbl_idx = tbl_instr["table_index"]
        if tbl_idx < 0 or tbl_idx >= len(doc.tables):
            print(f"警告: 表格索引 {tbl_idx} 超出范围 (0-{len(doc.tables)-1})，跳过", file=sys.stderr)
            continue
        table = doc.tables[tbl_idx]
        for cell_update in tbl_instr.get("cell_updates", []):
            row = cell_update["row"]
            col = cell_update["col"]
            if row < 0 or row >= len(table.rows):
                print(f"警告: 表格 {tbl_idx} 行索引 {row} 超出范围，跳过", file=sys.stderr)
                continue
            if col < 0 or col >= len(table.rows[row].cells):
                print(f"警告: 表格 {tbl_idx} 列索引 {col} 超出范围，跳过", file=sys.stderr)
                continue
            replace_cell_text(table.rows[row].cells[col], cell_update["new_text"])

    doc.save(output_path)
    print(f"成功: 已生成 {output_path}")


def main():
    parser = argparse.ArgumentParser(description="在 .docx 副本上执行修改指令")
    parser.add_argument("--input", required=True, help="源 .docx 文件路径")
    parser.add_argument("--output", required=True, help="输出 .docx 文件路径")
    parser.add_argument("--instructions", required=True, help="修改指令 JSON 文件路径")
    args = parser.parse_args()

    try:
        with open(args.instructions, 'r', encoding='utf-8') as f:
            instructions = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"错误: 无法读取指令文件: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        apply_instructions(args.input, args.output, instructions)
    except Exception as e:
        print(f"错误: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 端到端测试 — extract → render**

先用之前创建的测试文档，走完整流程：

```bash
# 1. 提取结构
data/skills/.venv/bin/python3 data/skills/skill-bid-document/scripts/extract.py \
  --input /tmp/test_bid.docx > /tmp/test_structure.json
cat /tmp/test_structure.json

# 2. 创建修改指令
cat > /tmp/test_instructions.json << 'EOF'
{
  "paragraphs": [
    {"index": 0, "action": "replace", "new_text": "2026年新标题"},
    {"index": 1, "action": "replace", "new_text": "修改后的正文"}
  ],
  "tables": [
    {
      "table_index": 0,
      "cell_updates": [
        {"row": 0, "col": 1, "new_text": "李四"},
        {"row": 1, "col": 1, "new_text": "总监"}
      ]
    }
  ]
}
EOF

# 3. 渲染
data/skills/.venv/bin/python3 data/skills/skill-bid-document/scripts/render.py \
  --input /tmp/test_bid.docx \
  --output /tmp/test_bid_output.docx \
  --instructions /tmp/test_instructions.json

# 4. 验证输出 — 再次 extract 确认修改生效
data/skills/.venv/bin/python3 data/skills/skill-bid-document/scripts/extract.py \
  --input /tmp/test_bid_output.docx
```

Expected: 输出 JSON 中段落 0 的 text 为 "2026年新标题"，段落 1 为 "修改后的正文"，表格 cell(0,1) 为 "李四"，cell(1,1) 为 "总监"。

- [ ] **Step 3: 验证 render 错误处理**

```bash
# 不存在的指令文件
data/skills/.venv/bin/python3 data/skills/skill-bid-document/scripts/render.py \
  --input /tmp/test_bid.docx --output /tmp/out.docx --instructions /tmp/no_such_file.json
echo "EXIT: $?"

# 无效 JSON
echo "not json" > /tmp/bad.json
data/skills/.venv/bin/python3 data/skills/skill-bid-document/scripts/render.py \
  --input /tmp/test_bid.docx --output /tmp/out.docx --instructions /tmp/bad.json
echo "EXIT: $?"
```

Expected: 两种情况都输出 stderr 错误信息，退出码 1。

---

## Chunk 3: SKILL.md + 注册验证

### Task 4: 创建 SKILL.md

**Files:**
- Create: `data/skills/skill-bid-document/SKILL.md`

- [ ] **Step 1: 编写 SKILL.md**

内容已在设计文档中定义。创建文件 `data/skills/skill-bid-document/SKILL.md`，使用设计文档 spec 中的完整 SKILL.md 内容（包含 frontmatter: name, description, license, compatibility, metadata）。

关键要点：
- `name: bid-document` — 与目录名后缀一致
- `compatibility: opencode` — 匹配 PPT skill 的格式
- 工具调用方式使用 `script` 参数指定脚本：
  ```
  run_skill(skill_name="bid-document", script="scripts/extract.py", args="--input <路径>")
  run_skill(skill_name="bid-document", script="scripts/render.py", args="--input <源> --output <目标> --instructions <JSON>")
  ```

- [ ] **Step 2: 验证 Skill 被 native gateway 发现**

重启 native gateway 后，检查日志确认 skill 被发现：

Run: `grep -i "bid-document" /home/baizh/octopus/.octopus-state/agents/*/agent/*.log 2>/dev/null || echo "检查 gateway 日志确认 skill 发现"`

或通过 API 检查 skill 列表（如果有对应的 RPC endpoint）。

- [ ] **Step 3: 端到端集成测试**

通过 Octopus AI 对话界面测试完整流程：
1. 上传一个 .docx 标书文件
2. 让 AI 调用 `run_skill(skill_name="bid-document", script="scripts/extract.py", args="--input <上传路径>")`
3. 验证 AI 收到文档结构 JSON
4. 让 AI 生成修改指令并调用 render
5. 验证输出文件生成

---

## 实现注意事项

1. **python-docx 版本**: 使用 `1.1.2`（截至 2026-03 的稳定版），若 pip 找不到精确版本可用 `python-docx>=1.1.0`
2. **run_skill 调用方式**: AI agent 必须使用 `script` 参数指定脚本路径（`scripts/extract.py` 或 `scripts/render.py`），因为 skill 目录下没有单一入口文件
3. **文件路径**: 脚本接收的路径相对于 cwd（用户 workspace），AI 需要传递正确的相对路径
4. **stdout 限制**: SkillExecutor 有 1MB stdout 限制，大型标书的 extract 输出可能被截断。SKILL.md 中应提醒 AI 注意

"""
ClawTeam 多智能体协作研究 - 主协调脚本

借鉴 ClawTeam Leader-Worker-Editor 模式，
通过并行 LLM 调用实现多角色协作研究。
"""

import argparse
import json
import os
import re
import signal
import sys
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# --- 依赖检查 ---

def check_dependencies():
    """启动时检查必要依赖"""
    missing = []
    try:
        import requests  # noqa: F401
    except ImportError:
        missing.append("requests")
    if sys.version_info < (3, 11):
        try:
            import tomli  # noqa: F401
        except ImportError:
            missing.append("tomli")
    if missing:
        print(json.dumps({
            "error": f"缺少依赖: {', '.join(missing)}。"
                     f"请执行: data/skills/.venv/bin/pip install {' '.join(missing)}"
        }))
        sys.exit(1)

check_dependencies()

import requests
try:
    import tomllib as tomli
except ImportError:
    import tomli  # Python < 3.11 fallback

# --- 配置加载 ---

SKILL_DIR = Path(os.environ.get("SKILL_DIR", Path(__file__).parent.parent))

def load_config():
    """加载 config.toml，环境变量优先覆盖"""
    config = tomli.loads((SKILL_DIR / "config.toml").read_bytes().decode())

    # 环境变量优先
    if url := os.environ.get("CLAWTEAM_API_URL"):
        config["api"]["base_url"] = url
    if key := os.environ.get("CLAWTEAM_API_KEY"):
        config["api"]["api_key"] = key

    if not config["api"].get("api_key"):
        print(json.dumps({"error": "未配置 API Key。请设置环境变量 CLAWTEAM_API_KEY 或编辑 config.toml"}))
        sys.exit(1)

    return config

# --- 模板加载 ---

def load_all_templates():
    """加载所有模板并构建关键词映射"""
    keyword_map = {}
    templates_dir = SKILL_DIR / "templates"
    for toml_file in templates_dir.glob("*.toml"):
        tmpl = tomli.loads(toml_file.read_bytes().decode())
        for kw in tmpl.get("template", {}).get("keyword_triggers", []):
            keyword_map[kw] = toml_file.stem
    return keyword_map

def load_template(template_name):
    """加载指定 TOML 团队模板"""
    path = SKILL_DIR / "templates" / f"{template_name}.toml"
    if not path.exists():
        raise ValueError(f"未找到模板: {template_name}")
    return tomli.loads(path.read_bytes().decode())

def detect_template(topic, keyword_map):
    """根据关键词自动匹配模板"""
    for keyword, template_name in keyword_map.items():
        if keyword in topic:
            return template_name
    return "research-survey"  # 默认

# --- LLM 调用 ---

def call_llm(config, model_key, system_prompt, user_prompt, max_tokens, timeout_override=None):
    """调用 LLM API（OpenAI 兼容格式）"""
    api = config["api"]
    model = config["models"][model_key]
    timeout = timeout_override or api["timeout"]

    resp = requests.post(
        f"{api['base_url']}/chat/completions",
        headers={"Authorization": f"Bearer {api['api_key']}"},
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "max_tokens": max_tokens,
            "temperature": config["params"]["temperature"],
        },
        timeout=timeout,
    )
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    # 剥离推理模型的思考链标签（如 MiniMax M2.7 的 <think>...</think>）
    content = re.sub(r'<think>.*?</think>\s*', '', content, flags=re.DOTALL)
    return content.strip()

# --- 三阶段执行 ---

def phase_leader(config, tmpl_data, topic, context, num_workers):
    """Phase 1: Leader 拆分任务（含重试和降级）"""
    leader = tmpl_data["leader"]
    user_prompt = (
        f"课题：{topic}\n"
        f"补充背景：{context or '无'}\n"
        f"请拆分为 {num_workers} 个调研维度。"
    )

    for attempt in range(2):  # 最多重试 1 次
        try:
            result = call_llm(
                config, "leader",
                leader["system_prompt"], user_prompt,
                config["params"]["leader_max_tokens"],
            )
            return parse_json_response(result)
        except (json.JSONDecodeError, ValueError) as e:
            if attempt == 0:
                print(f"[ClawTeam] Leader JSON 解析失败，重试中... ({e})", file=sys.stderr)
                continue
            # 降级：使用默认维度
            print(f"[ClawTeam] Leader 重试仍失败，使用默认维度拆分", file=sys.stderr)
            workers = tmpl_data.get("workers", [])
            return [
                {"name": w["role"], "description": "", "focus_prompt": f"请从 {w['role']} 的角度深入分析课题：{topic}"}
                for w in workers[:num_workers]
            ]

def phase_workers(config, tmpl_data, dimensions):
    """Phase 2: Workers 并行调研"""
    workers = tmpl_data.get("workers", [])
    findings = [None] * len(dimensions)
    max_concurrent = config["params"].get("max_concurrent_workers", 5)

    def run_worker(i, dim):
        if i < len(workers):
            sys_prompt = workers[i]["system_prompt"]
        else:
            sys_prompt = "你是研究员，负责深入分析以下维度。输出 Markdown 格式。"

        user_prompt = (
            f"维度：{dim['name']}\n"
            f"说明：{dim.get('description', '')}\n"
            f"具体要求：{dim.get('focus_prompt', '请深入分析此维度')}"
        )
        return call_llm(
            config, "worker",
            sys_prompt, user_prompt,
            config["params"]["worker_max_tokens"],
        )

    with ThreadPoolExecutor(max_workers=min(len(dimensions), max_concurrent)) as pool:
        future_to_idx = {
            pool.submit(run_worker, i, dim): i
            for i, dim in enumerate(dimensions)
        }
        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            try:
                result = future.result()
                # 质量校验：过短的结果标记警告
                if len(result.strip()) < 100:
                    findings[idx] = f"[此维度内容过短，可能需要补充]\n\n{result}"
                else:
                    findings[idx] = result
            except Exception as e:
                findings[idx] = f"[此维度调研失败: {e}]"

    return findings

def phase_editor(config, tmpl_data, topic, dimensions, findings):
    """Phase 3: Editor 汇总合成（含降级）"""
    editor = tmpl_data["editor"]

    # 截断过长的 Worker 输出，避免 Editor 输入超过模型上下文限制
    max_chars_per_worker = 3000
    sections = []
    for dim, finding in zip(dimensions, findings):
        trimmed = finding[:max_chars_per_worker] + "\n...(已截断)" if len(finding) > max_chars_per_worker else finding
        sections.append(f"### {dim['name']}\n{trimmed}")

    user_prompt = (
        f"课题：{topic}\n\n"
        f"以下是各维度的研究成果：\n\n"
        + "\n\n---\n\n".join(sections)
    )

    try:
        # Editor 整合长文需要更多时间（推理模型思考链长），给 1.5 倍超时
        editor_timeout = int(config["api"]["timeout"] * 1.5)
        return call_llm(
            config, "editor",
            editor["system_prompt"], user_prompt,
            config["params"]["editor_max_tokens"],
            timeout_override=editor_timeout,
        )
    except Exception as e:
        # 降级：直接拼接 Worker 成果
        print(f"[ClawTeam] Editor 调用失败，降级为拼接输出: {e}", file=sys.stderr)
        return f"# {topic}\n\n> 注意：报告整合失败，以下为各维度原始研究成果。\n\n" + "\n\n---\n\n".join(sections)

# --- 辅助函数 ---

def parse_json_response(text):
    """从 LLM 输出中提取 JSON 数组"""
    # 尝试提取 ```json ... ``` 块
    match = re.search(r'```(?:json)?\s*(\[.*?\])\s*```', text, re.DOTALL)
    if match:
        return json.loads(match.group(1))
    # 尝试找到最后一个完整的 JSON 数组（避免匹配示例中的数组）
    try:
        start = text.rindex('[')  # 用 rindex 取最后一个
        end = text.rindex(']') + 1
        return json.loads(text[start:end])
    except (ValueError, json.JSONDecodeError):
        raise ValueError(f"无法从 LLM 输出中解析 JSON 数组")

DEPTH_MAP = {"quick": 3, "standard": 5, "deep": 7}

# --- 全局超时 ---

def on_timeout(signum, frame):
    print(json.dumps({"error": "执行超时，已强制终止"}))
    sys.exit(124)

# --- 主入口 ---

def main():
    # 命令行参数解析（run_skill 通过 args 传递，stdin 不可用）
    parser = argparse.ArgumentParser(description="ClawTeam 多智能体协作研究")
    parser.add_argument("--topic", required=True, help="研究/讨论主题")
    parser.add_argument("--template", default="", help="模板名称")
    parser.add_argument("--context", default="", help="补充背景信息")
    parser.add_argument("--depth", default="standard", choices=["quick", "standard", "deep"])
    args = parser.parse_args()

    config = load_config()

    # 设置全局超时
    total_timeout = config["api"].get("total_timeout", 280)
    if hasattr(signal, 'SIGALRM'):
        signal.signal(signal.SIGALRM, on_timeout)
        signal.alarm(total_timeout)

    # 加载关键词映射
    keyword_map = load_all_templates()

    # 自动匹配模板
    template_name = args.template or detect_template(args.topic, keyword_map)
    tmpl_data = load_template(template_name)

    num_workers = DEPTH_MAP.get(args.depth, 5)

    print(f"[ClawTeam] 模式: {template_name} | 深度: {args.depth} ({num_workers} workers)", file=sys.stderr)
    print(f"[ClawTeam] Phase 1: Leader 拆分任务...", file=sys.stderr)

    # Phase 1
    dimensions = phase_leader(config, tmpl_data, args.topic, args.context, num_workers)
    dim_names = [d["name"] for d in dimensions]
    print(f"[ClawTeam] 拆分为 {len(dimensions)} 个维度: {', '.join(dim_names)}", file=sys.stderr)

    # Phase 2
    print(f"[ClawTeam] Phase 2: {len(dimensions)} 个 Worker 并行调研...", file=sys.stderr)
    findings = phase_workers(config, tmpl_data, dimensions)

    # 检查是否所有 Worker 都失败
    all_failed = all("[此维度调研失败" in (f or "") for f in findings)
    if all_failed:
        print(json.dumps({"error": "所有 Worker 调研均失败，无法生成报告"}, ensure_ascii=False))
        sys.exit(1)

    # Phase 3
    print(f"[ClawTeam] Phase 3: Editor 整合报告...", file=sys.stderr)
    report = phase_editor(config, tmpl_data, args.topic, dimensions, findings)

    # 输出文件
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    filename = f"clawteam-{template_name}-{timestamp}.md"

    outputs_dir = Path(os.environ.get("WORKSPACE_PATH", ".")) / "outputs"
    outputs_dir.mkdir(parents=True, exist_ok=True)
    output_path = outputs_dir / filename
    output_path.write_text(report, encoding="utf-8")

    # 取消超时
    if hasattr(signal, 'SIGALRM'):
        signal.alarm(0)

    # 返回结果给 Agent（stdout，run_skill 捕获这部分）
    summary = report[:500] + "..." if len(report) > 500 else report
    result = {
        "status": "success",
        "template": template_name,
        "dimensions": dim_names,
        "output_file": str(output_path),
        "summary": summary,
        "stats": {
            "workers": len(dimensions),
            "total_llm_calls": 1 + len(dimensions) + 1,
        }
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()

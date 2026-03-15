#!/usr/bin/env python3
"""
HTML 演示文稿生成器

读取 JSON 配置文件，结合 base_template.html 模板，生成单文件 HTML 演示文稿。
纯标准库实现，无额外依赖。

用法:
    python3 html_ppt_generator.py <config.json> [-o output.html]
"""

import json
import os
import sys
import argparse
import html as html_module

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_PATH = os.path.join(SCRIPT_DIR, '..', 'templates', 'base_template.html')

# ---------------------------------------------------------------------------
# Color mapping system
# ---------------------------------------------------------------------------
COLORS = {
    'blue':   {'main': '#3b82f6', 'light': '#60a5fa', 'bg': 'rgba(59,130,246,0.12)'},
    'purple': {'main': '#8b5cf6', 'light': '#a78bfa', 'bg': 'rgba(139,92,246,0.12)'},
    'green':  {'main': '#22c55e', 'light': '#4ade80', 'bg': 'rgba(34,197,94,0.12)'},
    'yellow': {'main': '#fbbf24', 'light': '#fcd34d', 'bg': 'rgba(251,191,36,0.12)'},
    'pink':   {'main': '#ec4899', 'light': '#f472b6', 'bg': 'rgba(236,72,153,0.12)'},
    'red':    {'main': '#ef4444', 'light': '#f87171', 'bg': 'rgba(239,68,68,0.12)'},
    'cyan':   {'main': '#06b6d4', 'light': '#22d3ee', 'bg': 'rgba(6,182,212,0.12)'},
}

def get_color(name, variant='main'):
    """Get color hex/rgba by name and variant. Falls back to blue."""
    c = COLORS.get((name or 'blue').lower(), COLORS['blue'])
    return c.get(variant, c['main'])

# ---------------------------------------------------------------------------
# Theme system
# ---------------------------------------------------------------------------
THEMES = {
    'tech-dark': {
        '--bg-primary': '#1e293b',
        '--bg-secondary': '#273549',
        '--accent': '#3b82f6',
        '--accent2': '#8b5cf6',
        '--accent-glow': '#60a5fa',
        '--text-primary': '#f1f5f9',
        '--text-secondary': '#94a3b8',
    },
    'professional': {
        '--bg-primary': '#1a1f36',
        '--bg-secondary': '#252d4a',
        '--accent': '#4f8df5',
        '--accent2': '#7c6cf5',
        '--accent-glow': '#7aabff',
        '--text-primary': '#eef2f7',
        '--text-secondary': '#8c9ab5',
    },
    'dark-green': {
        '--bg-primary': '#0f2318',
        '--bg-secondary': '#1a3328',
        '--accent': '#22c55e',
        '--accent2': '#10b981',
        '--accent-glow': '#4ade80',
        '--text-primary': '#f0fdf4',
        '--text-secondary': '#86efac',
    },
}

def build_theme_css(theme_name):
    """Generate CSS variable override block for a given theme."""
    theme = THEMES.get(theme_name)
    if not theme:
        return ''  # default theme already in :root
    lines = [':root {']
    for var, val in theme.items():
        lines.append(f'  {var}: {val};')
    lines.append('}')
    return '\n'.join(lines)


def escape(text):
    """HTML escape"""
    return html_module.escape(str(text))


# ---------------------------------------------------------------------------
# Original 8 layout renderers
# ---------------------------------------------------------------------------

def render_title_slide(slide, metadata):
    """封面页: 大标题 + 副标题 + 日期"""
    title = escape(slide.get('title', metadata.get('title', '')))
    subtitle = escape(slide.get('subtitle', metadata.get('subtitle', '')))
    date = escape(metadata.get('date', ''))

    parts = []
    parts.append('<section class="slide" style="justify-content:center;align-items:center;text-align:center;">')
    parts.append('  <div data-animate="up" style="position:relative;">')
    parts.append(f'    <div style="font-size:72px;font-weight:800;line-height:1.3;" class="glow-text">{title}</div>')
    if subtitle:
        parts.append(f'    <div style="font-size:40px;font-weight:700;margin-top:16px;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">{subtitle}</div>')
    parts.append('  </div>')
    if date:
        parts.append(f'  <div data-animate="up" style="font-size:20px;color:var(--text-secondary);margin-top:60px;">{date}</div>')
    parts.append('  <div style="position:absolute;bottom:0;left:0;right:0;height:6px;background:linear-gradient(90deg,var(--accent),var(--accent2),var(--accent));"></div>')
    parts.append('</section>')
    return '\n'.join(parts)


def render_agenda_slide(slide):
    """目录页: 编号圆圈 + 标题 + 描述的卡片"""
    title = escape(slide.get('title', '汇报提纲'))
    items = slide.get('items', [])

    parts = []
    parts.append('<section class="slide">')
    parts.append(f'  <div class="slide-title" data-animate="blind">{title}</div>')
    parts.append('  <div style="display:flex;gap:20px;margin-top:40px;flex:1;align-items:stretch;">')

    for i, item in enumerate(items):
        delay = f'{(i + 1) * 0.1:.1f}s'
        if isinstance(item, dict):
            num = escape(item.get('num', f'{i+1:02d}'))
            card_title = escape(item.get('title', ''))
            desc = escape(item.get('desc', ''))
        else:
            num = f'{i+1:02d}'
            card_title = escape(str(item))
            desc = ''

        parts.append(f'    <div class="glass-card agenda-card" data-animate="fly-bottom" style="transition-delay:{delay};">')
        parts.append(f'      <div class="num">{num}</div>')
        parts.append(f'      <div class="card-title">{card_title}</div>')
        if desc:
            parts.append(f'      <div class="card-desc">{desc}</div>')
        parts.append('    </div>')

    parts.append('  </div>')
    parts.append('</section>')
    return '\n'.join(parts)


def render_chapter_slide(slide):
    """章节分隔页: 大字居中 + 装饰线"""
    num = escape(slide.get('num', ''))
    title = escape(slide.get('title', ''))

    parts = []
    parts.append('<section class="slide chapter-page">')
    if num:
        parts.append(f'  <div class="chapter-num" data-animate="scale">{num}</div>')
    parts.append(f'  <div class="chapter-title" data-animate="up">{title}</div>')
    parts.append('  <div class="chapter-line" data-animate="up"></div>')
    parts.append('</section>')
    return '\n'.join(parts)


def render_content_slide(slide):
    """要点页: 标题 + 副标题 + 蓝色圆点列表"""
    title = escape(slide.get('title', ''))
    subtitle = slide.get('subtitle', '')
    bullets = slide.get('bullets', [])

    parts = []
    parts.append('<section class="slide">')
    parts.append(f'  <div class="slide-title" data-animate="blind">{title}</div>')
    if subtitle:
        parts.append(f'  <div class="slide-subtitle" data-animate="up">{escape(subtitle)}</div>')
    parts.append('  <ul class="bullet-list" data-animate="up">')
    for bullet in bullets:
        parts.append(f'    <li>{escape(bullet)}</li>')
    parts.append('  </ul>')
    parts.append('</section>')
    return '\n'.join(parts)


def _color_class(color):
    """Map color string to CSS class suffix"""
    color = (color or '').lower()
    if color in ('red', 'danger'):
        return 'red'
    if color in ('blue', 'primary', 'accent'):
        return 'blue'
    if color in ('green', 'success'):
        return 'green'
    return 'default'


def render_two_column_slide(slide):
    """左右对比页: 玻璃态卡片 + 图标列表"""
    title = escape(slide.get('title', ''))
    subtitle = slide.get('subtitle', '')
    left = slide.get('left', {})
    right = slide.get('right', {})

    def render_column(col, animate_dir, col_color):
        cc = _color_class(col_color)
        icon_cls = f'vs-icon vs-icon-{cc}'
        col_cls = f'compare-col col-{cc}'
        heading = escape(col.get('heading', ''))
        items = col.get('items', [])

        col_parts = []
        col_parts.append(f'    <div class="glass-card {col_cls}" data-animate="{animate_dir}" style="flex:1;padding:36px 40px;">')
        col_parts.append(f'      <h3 style="text-align:center;margin-bottom:24px;">{heading}</h3>')

        for j, item in enumerate(items):
            delay = f'{(j + 1) * 0.1 + 0.2:.1f}s'
            if isinstance(item, dict):
                icon = escape(item.get('icon', ''))
                label = escape(item.get('label', ''))
                desc = escape(item.get('desc', ''))
            else:
                icon = ''
                label = escape(str(item))
                desc = ''

            col_parts.append(f'      <div class="vs-item" data-animate="{animate_dir}" style="transition-delay:{delay};">')
            if icon:
                col_parts.append(f'        <span class="{icon_cls}">{icon}</span>')
            col_parts.append(f'        <div><div class="vs-label">{label}</div>')
            if desc:
                col_parts.append(f'        <div class="vs-desc">{desc}</div>')
            col_parts.append('        </div>')
            col_parts.append('      </div>')

        col_parts.append('    </div>')
        return '\n'.join(col_parts)

    parts = []
    parts.append('<section class="slide">')
    parts.append(f'  <div class="slide-title" data-animate="blind">{title}</div>')
    if subtitle:
        parts.append(f'  <div class="slide-subtitle" data-animate="up">{escape(subtitle)}</div>')
    parts.append('  <div style="display:flex;gap:40px;flex:1;margin-top:20px;">')

    left_color = left.get('color', 'red')
    right_color = right.get('color', 'blue')
    parts.append(render_column(left, 'fly-left', left_color))
    parts.append(render_column(right, 'fly-right', right_color))

    parts.append('  </div>')
    parts.append('</section>')
    return '\n'.join(parts)


def render_table_slide(slide):
    """表格页: 深色表头 + 交替行"""
    title = escape(slide.get('title', ''))
    subtitle = slide.get('subtitle', '')
    headers = slide.get('headers', [])
    rows = slide.get('rows', [])

    parts = []
    parts.append('<section class="slide">')
    parts.append(f'  <div class="slide-title" data-animate="blind">{title}</div>')
    if subtitle:
        parts.append(f'  <div class="slide-subtitle" data-animate="up">{escape(subtitle)}</div>')
    parts.append('  <div class="glass-card" data-animate="up" style="flex:1;overflow:auto;">')
    parts.append('    <table>')
    parts.append('      <thead><tr>')
    for h in headers:
        parts.append(f'        <th>{escape(h)}</th>')
    parts.append('      </tr></thead>')
    parts.append('      <tbody>')
    for row in rows:
        parts.append('        <tr>')
        for cell in row:
            parts.append(f'          <td>{escape(cell)}</td>')
        parts.append('        </tr>')
    parts.append('      </tbody>')
    parts.append('    </table>')
    parts.append('  </div>')
    parts.append('</section>')
    return '\n'.join(parts)


def render_quote_slide(slide):
    """引言页: 大字居中 + 标签"""
    text = escape(slide.get('text', ''))
    label = escape(slide.get('label', ''))

    parts = []
    parts.append('<section class="slide" style="justify-content:center;align-items:center;text-align:center;">')
    parts.append(f'  <div class="quote-text" data-animate="scale">{text}</div>')
    if label:
        parts.append(f'  <div class="quote-label" data-animate="up">{label}</div>')
    parts.append('  <div class="glow-line" style="width:200px;margin-top:40px;" data-animate="up"></div>')
    parts.append('</section>')
    return '\n'.join(parts)


def render_thank_you_slide(slide, metadata):
    """结束页"""
    title = escape(slide.get('title', '谢谢'))
    subtitle = escape(metadata.get('title', ''))

    parts = []
    parts.append('<section class="slide" style="justify-content:center;align-items:center;text-align:center;">')
    parts.append(f'  <div data-animate="scale" style="font-size:96px;font-weight:800;" class="glow-text">{title}</div>')
    if subtitle:
        parts.append(f'  <div data-animate="up" style="font-size:28px;color:var(--text-secondary);margin-top:32px;">{subtitle}</div>')
    parts.append('  <div style="position:absolute;bottom:60px;left:50%;transform:translateX(-50%);width:200px;height:4px;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:2px;"></div>')
    parts.append('</section>')
    return '\n'.join(parts)


# ---------------------------------------------------------------------------
# New 6 SVG/card layout renderers
# ---------------------------------------------------------------------------

def render_flow_chart_slide(slide):
    """横向流程图: 节点 + 箭头连线 + 可选流动光点动画"""
    title = escape(slide.get('title', ''))
    subtitle = slide.get('subtitle', '')
    nodes = slide.get('nodes', [])
    show_anim = slide.get('show_flow_animation', False)

    # Clamp to 2-8 nodes
    nodes = nodes[:8]
    if len(nodes) < 2:
        nodes = nodes + [{'label': '...', 'color': 'blue'}] * (2 - len(nodes))

    n = len(nodes)
    svg_w = 1720
    svg_h = 400
    node_w = 160
    node_h = 70
    # evenly distribute nodes
    gap = svg_w / (n + 1)

    parts = []
    parts.append('<section class="slide">')
    parts.append(f'  <div class="slide-title" data-animate="blind">{title}</div>')
    if subtitle:
        parts.append(f'  <div class="slide-subtitle" data-animate="up">{escape(subtitle)}</div>')
    parts.append(f'  <div data-animate="up" style="flex:1;display:flex;align-items:center;justify-content:center;">')
    parts.append(f'    <svg viewBox="0 0 {svg_w} {svg_h}" style="width:100%;max-height:100%;" xmlns="http://www.w3.org/2000/svg">')

    # Define arrow marker
    parts.append('      <defs>')
    parts.append('        <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">')
    parts.append('          <polygon points="0 0, 10 3.5, 0 7" fill="var(--text-secondary)" opacity="0.6"/>')
    parts.append('        </marker>')
    parts.append('      </defs>')

    cy = svg_h / 2
    positions = []
    for i in range(n):
        cx = gap * (i + 1)
        positions.append(cx)

    # Draw connecting arrows
    for i in range(n - 1):
        x1 = positions[i] + node_w / 2
        x2 = positions[i + 1] - node_w / 2
        parts.append(f'      <line x1="{x1}" y1="{cy}" x2="{x2}" y2="{cy}" stroke="var(--text-secondary)" stroke-opacity="0.4" stroke-width="2" marker-end="url(#arrowhead)"/>')

        if show_anim:
            # Animated flowing dot along the arrow
            parts.append(f'      <circle r="4" fill="var(--accent)" opacity="0.9">')
            parts.append(f'        <animateMotion dur="{1.5 + i * 0.3}s" repeatCount="indefinite">')
            parts.append(f'          <mpath href="#flow-path-{i}"/>')
            parts.append(f'        </animateMotion>')
            parts.append(f'      </circle>')
            parts.append(f'      <path id="flow-path-{i}" d="M{x1},{cy} L{x2},{cy}" fill="none" stroke="none"/>')

    # Draw nodes
    for i, node in enumerate(nodes):
        cx = positions[i]
        color_name = node.get('color', 'blue')
        main_c = get_color(color_name, 'main')
        bg_c = get_color(color_name, 'bg')
        label = escape(node.get('label', ''))
        rx = node_w / 2
        ry = node_h / 2

        parts.append(f'      <rect x="{cx - rx}" y="{cy - ry}" width="{node_w}" height="{node_h}" rx="12" fill="{bg_c}" stroke="{main_c}" stroke-width="2"/>')
        parts.append(f'      <text x="{cx}" y="{cy}" text-anchor="middle" dominant-baseline="central" fill="{main_c}" font-size="18" font-weight="700">{label}</text>')

    parts.append('    </svg>')
    parts.append('  </div>')
    parts.append('</section>')
    return '\n'.join(parts)


def render_arch_diagram_slide(slide):
    """层级架构图: 从上到下的层级 + 层间向下箭头"""
    title = escape(slide.get('title', ''))
    subtitle = slide.get('subtitle', '')
    layers = slide.get('layers', [])
    show_anim = slide.get('show_flow_animation', False)

    layers = layers[:5]
    if len(layers) < 2:
        layers = layers + [{'label': '...', 'desc': '', 'color': 'blue'}] * (2 - len(layers))

    n = len(layers)
    svg_w = 1720
    layer_h = 80
    gap_h = 50
    total_h = n * layer_h + (n - 1) * gap_h
    svg_h = total_h + 60
    rect_w = 800

    parts = []
    parts.append('<section class="slide">')
    parts.append(f'  <div class="slide-title" data-animate="blind">{title}</div>')
    if subtitle:
        parts.append(f'  <div class="slide-subtitle" data-animate="up">{escape(subtitle)}</div>')
    parts.append(f'  <div data-animate="up" style="flex:1;display:flex;align-items:center;justify-content:center;">')
    parts.append(f'    <svg viewBox="0 0 {svg_w} {svg_h}" style="width:100%;max-height:100%;" xmlns="http://www.w3.org/2000/svg">')

    parts.append('      <defs>')
    parts.append('        <marker id="arch-arrow" markerWidth="10" markerHeight="7" refX="5" refY="3.5" orient="auto">')
    parts.append('          <polygon points="0 0, 10 3.5, 0 7" fill="var(--text-secondary)" opacity="0.5"/>')
    parts.append('        </marker>')
    parts.append('      </defs>')

    cx = svg_w / 2
    for i, layer in enumerate(layers):
        color_name = layer.get('color', 'blue')
        main_c = get_color(color_name, 'main')
        bg_c = get_color(color_name, 'bg')
        label = escape(layer.get('label', ''))
        desc = escape(layer.get('desc', ''))
        y = 30 + i * (layer_h + gap_h)

        parts.append(f'      <rect x="{cx - rect_w/2}" y="{y}" width="{rect_w}" height="{layer_h}" rx="14" fill="{bg_c}" stroke="{main_c}" stroke-width="2"/>')
        if desc:
            parts.append(f'      <text x="{cx}" y="{y + layer_h/2 - 10}" text-anchor="middle" dominant-baseline="central" fill="{main_c}" font-size="22" font-weight="700">{label}</text>')
            parts.append(f'      <text x="{cx}" y="{y + layer_h/2 + 14}" text-anchor="middle" dominant-baseline="central" fill="var(--text-secondary)" font-size="14">{desc}</text>')
        else:
            parts.append(f'      <text x="{cx}" y="{y + layer_h/2}" text-anchor="middle" dominant-baseline="central" fill="{main_c}" font-size="22" font-weight="700">{label}</text>')

        # Arrow to next layer
        if i < n - 1:
            arrow_y1 = y + layer_h + 4
            arrow_y2 = y + layer_h + gap_h - 4
            parts.append(f'      <line x1="{cx}" y1="{arrow_y1}" x2="{cx}" y2="{arrow_y2}" stroke="var(--text-secondary)" stroke-opacity="0.4" stroke-width="2" marker-end="url(#arch-arrow)"/>')

            if show_anim:
                path_id = f'arch-flow-{i}'
                parts.append(f'      <path id="{path_id}" d="M{cx},{arrow_y1} L{cx},{arrow_y2}" fill="none" stroke="none"/>')
                parts.append(f'      <circle r="4" fill="{main_c}" opacity="0.8">')
                parts.append(f'        <animateMotion dur="{1.2 + i * 0.2}s" repeatCount="indefinite">')
                parts.append(f'          <mpath href="#{path_id}"/>')
                parts.append(f'        </animateMotion>')
                parts.append(f'      </circle>')

    parts.append('    </svg>')
    parts.append('  </div>')
    parts.append('</section>')
    return '\n'.join(parts)


def render_concentric_slide(slide):
    """同心圆层级图: rings 从内到外 + 可选右侧 details 卡片"""
    title = escape(slide.get('title', ''))
    subtitle = slide.get('subtitle', '')
    rings = slide.get('rings', [])
    details = slide.get('details', [])

    rings = rings[:6]
    if len(rings) < 2:
        rings = rings + [{'label': '...', 'color': 'blue'}] * (2 - len(rings))

    n = len(rings)
    has_details = len(details) > 0

    parts = []
    parts.append('<section class="slide">')
    parts.append(f'  <div class="slide-title" data-animate="blind">{title}</div>')
    if subtitle:
        parts.append(f'  <div class="slide-subtitle" data-animate="up">{escape(subtitle)}</div>')

    if has_details:
        parts.append('  <div data-animate="up" style="flex:1;display:flex;gap:40px;align-items:center;">')
        svg_container_style = 'flex:1;display:flex;align-items:center;justify-content:center;'
    else:
        parts.append('  <div data-animate="up" style="flex:1;display:flex;align-items:center;justify-content:center;">')
        svg_container_style = ''

    svg_size = 600
    cx_svg = svg_size / 2
    cy_svg = svg_size / 2
    max_r = svg_size / 2 - 30
    min_r = 50
    step = (max_r - min_r) / n

    if has_details:
        parts.append(f'    <div style="{svg_container_style}">')

    parts.append(f'    <svg viewBox="0 0 {svg_size} {svg_size}" style="width:{svg_size}px;max-width:100%;max-height:100%;" xmlns="http://www.w3.org/2000/svg">')

    # Draw rings from outermost to innermost so inner rings draw on top
    for idx in range(n - 1, -1, -1):
        ring = rings[idx]
        color_name = ring.get('color', 'blue')
        main_c = get_color(color_name, 'main')
        bg_c = get_color(color_name, 'bg')
        label = escape(ring.get('label', ''))
        r = min_r + step * idx + step / 2

        circumference = 2 * 3.14159 * r
        # Stroke-dashoffset animation for concentric rings
        parts.append(f'      <circle cx="{cx_svg}" cy="{cy_svg}" r="{r:.1f}" fill="none" stroke="{main_c}" stroke-width="2" stroke-opacity="0.4"'
                     f' stroke-dasharray="{circumference:.1f}" stroke-dashoffset="{circumference:.1f}">')
        parts.append(f'        <animate attributeName="stroke-dashoffset" from="{circumference:.1f}" to="0" dur="{1.0 + idx * 0.3}s" fill="freeze" begin="0.5s"/>')
        parts.append(f'      </circle>')
        parts.append(f'      <circle cx="{cx_svg}" cy="{cy_svg}" r="{r:.1f}" fill="{bg_c}" opacity="0.5"/>')

        # Label at the right side of each ring
        text_x = cx_svg + r + 8
        text_y = cy_svg
        # For outer rings, place label on the right; for inner ones, center
        if idx == 0:
            # Innermost: center text
            parts.append(f'      <text x="{cx_svg}" y="{cy_svg}" text-anchor="middle" dominant-baseline="central" fill="{main_c}" font-size="14" font-weight="700">{label}</text>')
        else:
            # Place label at top of ring arc
            label_y = cy_svg - r + 16
            parts.append(f'      <text x="{cx_svg}" y="{label_y}" text-anchor="middle" dominant-baseline="central" fill="{main_c}" font-size="12" font-weight="600">{label}</text>')

    parts.append('    </svg>')

    if has_details:
        parts.append('    </div>')
        # Right side detail cards
        parts.append('    <div style="flex:1;display:flex;flex-direction:column;gap:16px;max-height:100%;overflow-y:auto;">')
        for i, detail in enumerate(details):
            d_label = escape(detail.get('label', ''))
            d_desc = escape(detail.get('desc', ''))
            d_color = detail.get('color', 'blue')
            d_main = get_color(d_color, 'main')
            d_bg = get_color(d_color, 'bg')
            delay = f'{(i + 1) * 0.15:.2f}s'
            parts.append(f'      <div class="glass-card" data-animate="fly-right" style="transition-delay:{delay};padding:20px 24px;border-left:3px solid {d_main};">')
            parts.append(f'        <div style="font-size:16px;font-weight:700;color:{d_main};margin-bottom:6px;">{d_label}</div>')
            if d_desc:
                parts.append(f'        <div style="font-size:13px;color:var(--text-secondary);line-height:1.6;">{d_desc}</div>')
            parts.append('      </div>')
        parts.append('    </div>')

    parts.append('  </div>')
    parts.append('</section>')
    return '\n'.join(parts)


def render_timeline_slide(slide):
    """时间线: 横向排列 + 底部横线串联 + 状态着色"""
    title = escape(slide.get('title', ''))
    subtitle = slide.get('subtitle', '')
    items = slide.get('items', [])

    items = items[:8]
    n = len(items)
    if n == 0:
        n = 1
        items = [{'label': '...', 'desc': '', 'status': 'planned'}]

    svg_w = 1720
    svg_h = 500
    line_y = 240
    gap = svg_w / (n + 1)

    STATUS_COLORS = {
        'done':    {'fill': '#22c55e', 'stroke': '#22c55e', 'text': '#22c55e'},
        'active':  {'fill': '#3b82f6', 'stroke': '#3b82f6', 'text': '#3b82f6'},
        'planned': {'fill': 'none',    'stroke': '#64748b', 'text': '#94a3b8'},
    }

    parts = []
    parts.append('<section class="slide">')
    parts.append(f'  <div class="slide-title" data-animate="blind">{title}</div>')
    if subtitle:
        parts.append(f'  <div class="slide-subtitle" data-animate="up">{escape(subtitle)}</div>')
    parts.append(f'  <div data-animate="up" style="flex:1;display:flex;align-items:center;justify-content:center;">')
    parts.append(f'    <svg viewBox="0 0 {svg_w} {svg_h}" style="width:100%;max-height:100%;" xmlns="http://www.w3.org/2000/svg">')

    # Horizontal connecting line
    x_start = gap - 20
    x_end = gap * n + 20
    parts.append(f'      <line x1="{x_start}" y1="{line_y}" x2="{x_end}" y2="{line_y}" stroke="var(--text-secondary)" stroke-opacity="0.3" stroke-width="2"/>')

    for i, item in enumerate(items):
        cx = gap * (i + 1)
        label = escape(item.get('label', ''))
        desc = escape(item.get('desc', ''))
        status = item.get('status', 'planned')
        sc = STATUS_COLORS.get(status, STATUS_COLORS['planned'])

        dot_r = 12
        # Filled circle for done, outlined for planned
        if status == 'done':
            parts.append(f'      <circle cx="{cx}" cy="{line_y}" r="{dot_r}" fill="{sc["fill"]}" stroke="{sc["stroke"]}" stroke-width="2"/>')
            # checkmark
            parts.append(f'      <text x="{cx}" y="{line_y}" text-anchor="middle" dominant-baseline="central" fill="white" font-size="14" font-weight="700">✓</text>')
        elif status == 'active':
            parts.append(f'      <circle cx="{cx}" cy="{line_y}" r="{dot_r}" fill="{sc["fill"]}" stroke="{sc["stroke"]}" stroke-width="2"/>')
            # Pulsing ring animation
            parts.append(f'      <circle cx="{cx}" cy="{line_y}" r="{dot_r}" fill="none" stroke="{sc["stroke"]}" stroke-width="2" opacity="0.6">')
            parts.append(f'        <animate attributeName="r" values="{dot_r};{dot_r + 10};{dot_r}" dur="2s" repeatCount="indefinite"/>')
            parts.append(f'        <animate attributeName="opacity" values="0.6;0;0.6" dur="2s" repeatCount="indefinite"/>')
            parts.append(f'      </circle>')
        else:
            parts.append(f'      <circle cx="{cx}" cy="{line_y}" r="{dot_r}" fill="none" stroke="{sc["stroke"]}" stroke-width="2" stroke-dasharray="4 3"/>')

        # Label above
        parts.append(f'      <text x="{cx}" y="{line_y - 30}" text-anchor="middle" fill="{sc["text"]}" font-size="18" font-weight="700">{label}</text>')

        # Desc card below
        if desc:
            card_w = 180
            card_h = 60
            card_x = cx - card_w / 2
            card_y = line_y + 40
            parts.append(f'      <rect x="{card_x}" y="{card_y}" width="{card_w}" height="{card_h}" rx="10" fill="var(--glass-bg)" stroke="var(--glass-border)" stroke-width="1"/>')
            parts.append(f'      <text x="{cx}" y="{card_y + card_h/2}" text-anchor="middle" dominant-baseline="central" fill="var(--text-secondary)" font-size="14">{desc}</text>')

    parts.append('    </svg>')
    parts.append('  </div>')
    parts.append('</section>')
    return '\n'.join(parts)


def render_cards_grid_slide(slide):
    """卡片网格: 2x2 或 3xN 玻璃态卡片 + icon + title + desc"""
    title = escape(slide.get('title', ''))
    subtitle = slide.get('subtitle', '')
    columns = slide.get('columns', 2)
    cards = slide.get('cards', [])

    if columns not in (2, 3):
        columns = 2

    parts = []
    parts.append('<section class="slide">')
    parts.append(f'  <div class="slide-title" data-animate="blind">{title}</div>')
    if subtitle:
        parts.append(f'  <div class="slide-subtitle" data-animate="up">{escape(subtitle)}</div>')

    grid_gap = '24px'
    parts.append(f'  <div data-animate="up" style="flex:1;display:grid;grid-template-columns:repeat({columns},1fr);gap:{grid_gap};align-content:center;">')

    for i, card in enumerate(cards):
        icon = card.get('icon', '')
        card_title = escape(card.get('title', ''))
        card_desc = escape(card.get('desc', ''))
        delay = f'{(i + 1) * 0.1:.1f}s'

        parts.append(f'    <div class="glass-card" data-animate="fly-bottom" style="transition-delay:{delay};padding:36px 32px;text-align:center;">')
        if icon:
            parts.append(f'      <div style="font-size:48px;margin-bottom:16px;">{icon}</div>')
        parts.append(f'      <div style="font-size:22px;font-weight:700;color:var(--text-primary);margin-bottom:10px;">{card_title}</div>')
        if card_desc:
            parts.append(f'      <div style="font-size:15px;color:var(--text-secondary);line-height:1.6;">{card_desc}</div>')
        parts.append('    </div>')

    parts.append('  </div>')
    parts.append('</section>')
    return '\n'.join(parts)


def render_kpi_slide(slide):
    """大数字展示页: 数值居中 + 发光效果 + 下方标签"""
    title = escape(slide.get('title', ''))
    subtitle = slide.get('subtitle', '')
    metrics = slide.get('metrics', [])

    parts = []
    parts.append('<section class="slide">')
    parts.append(f'  <div class="slide-title" data-animate="blind">{title}</div>')
    if subtitle:
        parts.append(f'  <div class="slide-subtitle" data-animate="up">{escape(subtitle)}</div>')

    parts.append('  <div data-animate="up" style="flex:1;display:flex;align-items:center;justify-content:center;gap:60px;">')

    for i, metric in enumerate(metrics):
        value = escape(metric.get('value', ''))
        label = escape(metric.get('label', ''))
        color_name = metric.get('color', 'blue')
        main_c = get_color(color_name, 'main')
        light_c = get_color(color_name, 'light')
        delay = f'{(i + 1) * 0.15:.2f}s'

        parts.append(f'    <div data-animate="scale" style="transition-delay:{delay};text-align:center;flex:1;">')
        parts.append(f'      <div style="font-size:64px;font-weight:800;color:{main_c};text-shadow:0 0 30px {main_c}40,0 0 60px {main_c}20;line-height:1.2;">{value}</div>')
        parts.append(f'      <div style="font-size:18px;color:{light_c};margin-top:16px;font-weight:600;">{label}</div>')
        parts.append('    </div>')

    parts.append('  </div>')
    parts.append('</section>')
    return '\n'.join(parts)


# ---------------------------------------------------------------------------
# Layout renderer mapping
# ---------------------------------------------------------------------------
LAYOUT_RENDERERS = {
    'title': lambda slide, meta: render_title_slide(slide, meta),
    'agenda': lambda slide, meta: render_agenda_slide(slide),
    'chapter': lambda slide, meta: render_chapter_slide(slide),
    'content': lambda slide, meta: render_content_slide(slide),
    'two_column': lambda slide, meta: render_two_column_slide(slide),
    'table': lambda slide, meta: render_table_slide(slide),
    'quote': lambda slide, meta: render_quote_slide(slide),
    'thank_you': lambda slide, meta: render_thank_you_slide(slide, meta),
    'flow_chart': lambda slide, meta: render_flow_chart_slide(slide),
    'arch_diagram': lambda slide, meta: render_arch_diagram_slide(slide),
    'concentric': lambda slide, meta: render_concentric_slide(slide),
    'timeline': lambda slide, meta: render_timeline_slide(slide),
    'cards_grid': lambda slide, meta: render_cards_grid_slide(slide),
    'kpi': lambda slide, meta: render_kpi_slide(slide),
}


def generate_html(config, template_path=None):
    """
    Generate HTML presentation from config dict.

    Args:
        config: dict with 'metadata' and 'slides' keys
        template_path: path to base_template.html (default: bundled template)

    Returns:
        Complete HTML string
    """
    if template_path is None:
        template_path = TEMPLATE_PATH

    with open(template_path, 'r', encoding='utf-8') as f:
        template = f.read()

    metadata = config.get('metadata', {})
    slides = config.get('slides', [])

    # Build theme CSS override
    theme_name = metadata.get('theme', 'tech-dark')
    theme_css = build_theme_css(theme_name)

    # Render each slide
    slide_htmls = []
    for slide in slides:
        layout = slide.get('layout', 'content')
        renderer = LAYOUT_RENDERERS.get(layout)
        if renderer is None:
            print(f"[WARNING] Unknown layout '{layout}', skipping slide.", file=sys.stderr)
            continue
        slide_htmls.append(renderer(slide, metadata))

    slides_content = '\n\n'.join(slide_htmls)

    # Replace template placeholders
    html_output = template.replace('{{ title }}', escape(metadata.get('title', 'Presentation')))
    html_output = html_output.replace('{{ theme_vars }}', theme_css)
    html_output = html_output.replace('{{ slides_content }}', slides_content)

    return html_output


def main():
    parser = argparse.ArgumentParser(
        description='HTML 演示文稿生成器 - 从 JSON 配置生成单文件 HTML 演示文稿'
    )
    parser.add_argument('config', help='JSON 配置文件路径')
    parser.add_argument('-o', '--output', help='输出 HTML 文件路径（默认: outputs/<title>.html）')
    parser.add_argument('-t', '--template', help='自定义模板路径（默认: 内置模板）')
    args = parser.parse_args()

    # Read config
    config_path = args.config
    if not os.path.isabs(config_path):
        # Try relative to CWD
        if not os.path.exists(config_path):
            print(f"[ERROR] Config file not found: {config_path}", file=sys.stderr)
            sys.exit(1)

    with open(config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)

    # Validate basic structure
    if 'metadata' not in config:
        print("[ERROR] Config missing 'metadata' field.", file=sys.stderr)
        sys.exit(1)
    if 'slides' not in config or not config['slides']:
        print("[ERROR] Config missing 'slides' field or slides is empty.", file=sys.stderr)
        sys.exit(1)

    # Validate layouts
    valid_layouts = set(LAYOUT_RENDERERS.keys())
    for i, slide in enumerate(config['slides']):
        layout = slide.get('layout')
        if not layout:
            print(f"[ERROR] Slide {i+1} missing 'layout' field.", file=sys.stderr)
            sys.exit(1)
        if layout not in valid_layouts:
            print(f"[WARNING] Slide {i+1} has unknown layout '{layout}'. Valid layouts: {', '.join(sorted(valid_layouts))}", file=sys.stderr)

    # Determine template path
    tpl_path = args.template if args.template else TEMPLATE_PATH
    if not os.path.exists(tpl_path):
        print(f"[ERROR] Template not found: {tpl_path}", file=sys.stderr)
        sys.exit(1)

    # Generate HTML
    html_output = generate_html(config, tpl_path)

    # Determine output path
    output_path = args.output
    if not output_path:
        title = config['metadata'].get('title', 'presentation')
        # Sanitize filename
        safe_title = ''.join(c for c in title if c not in r'\/:*?"<>|')
        output_path = os.path.join('outputs', f'{safe_title}.html')

    # Ensure output directory exists
    output_dir = os.path.dirname(output_path)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html_output)

    slide_count = len(config['slides'])
    print(f"[OK] Generated {output_path} ({slide_count} slides)")


if __name__ == '__main__':
    main()

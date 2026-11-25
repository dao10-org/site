# 共道文明标识：生成 SVG（网页用）和 PNG（头像、分享图用），在本机运行：python scripts/make-logo.py
# 同一份几何数据同时画 SVG 和 PNG，保证各处标识完全一致。
#
# 寓意
#   外圆        自然与道：每个人都在自然和规律之中（人与自然）
#   三个人      平等地、等距地围成一圈，没有谁在上、谁在下（人与人）
#   头与身      每个人的圆点（灵）与弧形的身体（肉身）分开却同向，合成一个完整的人（灵魂与肉体）
#   三段弧之间的空隙  彼此独立；三段弧合起来又近似一个环：共生
#   中心圆点（朱红）  大家共同守护的底线：人权
#
# 颜色只用两种：竹绿 #3b7a4f、朱 #a8432f（与网站相同）；另有单色版。
import math
from PIL import Image, ImageDraw

GREEN, RED, PAPER = "#3b7a4f", "#a8432f", "#f8f5ee"
C = 100.0                       # 画布 200×200，圆心 (100,100)
RING_R, RING_W = 92.0, 7.0      # 外圆
CORE_R = 18.0                   # 中心圆点
ARM_RO, ARM_W, ARM_SPAN = 54.0, 17.0, 52.0   # 身体弧：外半径、最厚处、半张角（度）
HEAD_D, HEAD_R = 72.0, 12.0     # 头：离圆心距离、半径
ANGLES = [90.0, 210.0, 330.0]   # 三个人的方向（下、左上、右上）：一人在正下方托底


def arm_points(theta_deg, n=48):
    """一段两头尖、中间厚的弧形（像张开环抱的双臂），朝向圆心"""
    t = math.radians(theta_deg)
    A = math.radians(ARM_SPAN)
    outer, inner = [], []
    for i in range(n + 1):
        f = -1 + 2 * i / n                      # -1 … 1
        phi = t + f * A
        w = ARM_W * math.cos(f * math.pi / 2) ** 0.8
        w = max(w, 2.4)                          # 两端留一点圆头，缩小后不至于消失
        outer.append((C + ARM_RO * math.cos(phi), C + ARM_RO * math.sin(phi)))
        inner.append((C + (ARM_RO - w) * math.cos(phi), C + (ARM_RO - w) * math.sin(phi)))
    return outer + inner[::-1]


def head(theta_deg):
    t = math.radians(theta_deg)
    return (C + HEAD_D * math.cos(t), C + HEAD_D * math.sin(t))


def svg(people=GREEN, core=RED, ring=GREEN, bg=None):
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img" aria-label="共道文明">']
    if bg:
        parts.append(f'<rect width="200" height="200" fill="{bg}"/>')
    parts.append(f'<circle cx="100" cy="100" r="{RING_R}" fill="none" stroke="{ring}" stroke-width="{RING_W}"/>')
    for a in ANGLES:
        pts = arm_points(a)
        d = "M" + " L".join(f"{x:.2f},{y:.2f}" for x, y in pts) + "Z"
        hx, hy = head(a)
        parts.append(f'<path d="{d}" fill="{people}"/>')
        parts.append(f'<circle cx="{hx:.2f}" cy="{hy:.2f}" r="{HEAD_R}" fill="{people}"/>')
    parts.append(f'<circle cx="100" cy="100" r="{CORE_R}" fill="{core}"/>')
    parts.append("</svg>")
    return "".join(parts)


def png(size, people=GREEN, core=RED, ring=GREEN, bg=None, pad=0.0):
    """画到 size×size。pad = 四周留白占比（头像用）"""
    S = 8                                       # 超采样，边缘平滑
    W = size * S
    img = Image.new("RGBA", (W, W), bg or (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = W * (1 - 2 * pad) / 200.0
    o = W * pad
    P = lambda x, y: (o + x * k, o + y * k)
    def circle(cx, cy, r, fill):
        (x0, y0), (x1, y1) = P(cx - r, cy - r), P(cx + r, cy + r)
        d.ellipse([x0, y0, x1, y1], fill=fill)
    circle(C, C, RING_R + RING_W / 2, ring)
    circle(C, C, RING_R - RING_W / 2, bg or (0, 0, 0, 0))
    for a in ANGLES:
        d.polygon([P(x, y) for x, y in arm_points(a)], fill=people)
        circle(*head(a), HEAD_R, people)
    circle(C, C, CORE_R, core)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    out = "src/assets/img/"
    open(out + "logo.svg", "w", encoding="utf-8").write(svg())                         # 标准版：青 + 朱
    open(out + "logo-mono.svg", "w", encoding="utf-8").write(                           # 单色版：跟随文字颜色
        svg(people="currentColor", core="currentColor", ring="currentColor"))
    open(out + "favicon.svg", "w", encoding="utf-8").write(svg())                         # 浏览器标签图标
    png(32).save(out + "favicon.png")
    png(180, bg=PAPER, pad=0.06).convert("RGB").save(out + "apple-touch-icon.png")      # 手机桌面图标
    # 社交平台头像（YouTube、X 等，会被裁成圆形，所以四周多留白）
    png(800, bg=PAPER, pad=0.12).convert("RGB").save(out + "avatar-light.png")
    png(800, people=PAPER, core=RED, ring=PAPER, bg=GREEN, pad=0.12).convert("RGB").save(out + "avatar-green.png")
    png(512).save(out + "logo-512.png")
    print("ok")

# 生成社交平台分享卡片图（1200×630），在本机运行一次即可：python scripts/make-share-image.py
# 字体用 Windows 自带的 Noto Serif SC（开源 OFL 授权）。
from PIL import Image, ImageDraw, ImageFont
W, H = 1200, 630
paper, ink, muted, green, red = "#f8f5ee", "#23221f", "#77736a", "#2f6b5e", "#a8432f"
img = Image.new("RGB", (W, H), paper)
d = ImageDraw.Draw(img)
serif = "C:/Windows/Fonts/NotoSerifSC-VF.ttf"
def font(size, weight=400):
    f = ImageFont.truetype(serif, size)
    try: f.set_variation_by_axes([weight])
    except Exception: pass
    return f
d.rectangle([0, 0, W, 14], fill=green)
d.rectangle([60, 120, 68, 420], fill=red)
d.text((110, 120), "☯", font=ImageFont.truetype("C:/Windows/Fonts/seguisym.ttf", 96), fill=green)
d.text((240, 128), "共道文明", font=font(108, 700), fill=ink)
d.text((112, 300), "道的文明 · 存、展、通", font=font(52, 500), fill=green)
d.text((112, 380), "人权 · 共生 —— 当代人关于道的公共空间", font=font(36), fill=muted)
d.text((112, 520), "dao10.org", font=font(40, 600), fill=red)
img.save("src/assets/img/share.png", optimize=True)
print("ok")

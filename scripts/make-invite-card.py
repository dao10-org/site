# 生成邀请卡片图（1080×1440，适合微信私信、朋友圈），带二维码，在本机运行一次即可：
#   python scripts/make-invite-card.py
# 二维码指向 https://dao10.org/invite （短网址，见 src/_redirects）
import qrcode
from PIL import Image, ImageDraw, ImageFont
W, H = 1080, 1440
paper, card, ink, muted, green, red = "#f8f5ee", "#fffdf8", "#23221f", "#77736a", "#2f6b5e", "#a8432f"
img = Image.new("RGB", (W, H), paper)
d = ImageDraw.Draw(img)
serif = "C:/Windows/Fonts/NotoSerifSC-VF.ttf"
def font(size, weight=400):
    f = ImageFont.truetype(serif, size)
    try: f.set_variation_by_axes([weight])
    except Exception: pass
    return f
def center(y, text, f, fill):
    w = d.textlength(text, font=f)
    d.text(((W - w) / 2, y), text, font=f, fill=fill)

d.rectangle([0, 0, W, 16], fill=green)
center(90, "邀 请 函", font(44, 500), red)
sym = ImageFont.truetype("C:/Windows/Fonts/seguisym.ttf", 92)
t = "共道文明"; ft = font(104, 700)
tw = d.textlength(t, font=ft); total = 110 + tw
x0 = (W - total) / 2
logo = Image.open("src/assets/img/logo-512.png").resize((96, 96), Image.LANCZOS)
img.paste(logo, (int(x0), 180), logo)
d.text((x0 + 110, 165), t, font=ft, fill=ink)
center(310, "保存、交流当代人关于“道”的思想", font(40, 500), green)

d.rectangle([90, 400, 98, 690], fill=red)
lines = [
    "不问门派与宗教，只守人权与共生的底线",
    "可署名，也可匿名发表文章",
    "个人或团体都可建自己的道场网站",
    "版权归作者，完全免费，不收集个人信息",
]
for i, s in enumerate(lines):
    d.text((130, 405 + i * 74), s, font=font(36), fill=ink)

# 二维码
qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=3)
qr.add_data("https://dao10.org/invite")
qr.make(fit=True)
qr.box_size = 400 // (qr.modules_count + 6)  # 整数倍放大，模块大小一致，扫码更稳
q = qr.make_image(fill_color=ink, back_color=card).convert("RGB")
box = (W - 460) // 2
d.rounded_rectangle([box, 760, box + 460, 1220], radius=24, fill=card, outline="#e2dccf", width=2)
img.paste(q, ((W - q.width) // 2, 760 + (460 - q.height) // 2))
center(1250, "扫码阅读邀请函", font(34, 500), muted)
center(1310, "dao10.org/invite", font(46, 600), red)
img.save("src/assets/img/invite-card.png", optimize=True)
print("ok")

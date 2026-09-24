# Génère les icônes de l'app : python scripts/make-icons.py
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def app_icon(size, full_bleed=False):
    s4 = size * 4
    grad = Image.new('RGBA', (s4, s4))
    top, mid, bot = (86, 146, 255), (58, 84, 222), (40, 44, 150)
    gd = ImageDraw.Draw(grad)
    for y in range(s4):
        t = y / (s4 - 1)
        a, b, k = (top, mid, t / 0.6) if t < 0.6 else (mid, bot, (t - 0.6) / 0.4)
        gd.line([(0, y), (s4, y)], fill=tuple(int(a[i] + (b[i] - a[i]) * k) for i in range(3)) + (255,))
    # marge façon icônes macOS (824/1024) sauf pour l'.ico Windows
    pad = 0 if full_bleed else int(s4 * 0.0977)
    mask = Image.new('L', (s4, s4), 0)
    ImageDraw.Draw(mask).rounded_rectangle([pad, pad, s4 - pad, s4 - pad], radius=int((s4 - 2 * pad) * 0.225), fill=255)
    img = Image.new('RGBA', (s4, s4), (0, 0, 0, 0))
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    inner = s4 - 2 * pad
    bw, gap = inner * 0.078, inner * 0.06
    x0 = pad + (inner - (5 * bw + 4 * gap)) / 2
    cy = pad + inner * 0.5
    for i, (h, a) in enumerate(zip([0.30, 0.56, 0.40, 0.20, 0.10], [235, 255, 245, 215, 190])):
        x = x0 + i * (bw + gap)
        hh = inner * h
        d.rounded_rectangle([x, cy - hh / 2, x + bw, cy + hh / 2], radius=bw / 2, fill=(255, 255, 255, a))
    return img.resize((size, size), Image.LANCZOS)


def tray(size, color, rec=False):
    s8 = size * 8
    img = Image.new('RGBA', (s8, s8), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    heights = [0.34, 0.72, 0.5, 0.26]
    bw, gap = s8 * 0.13, s8 * 0.09
    total = len(heights) * bw + (len(heights) - 1) * gap
    x0 = (s8 - total) / 2 - (s8 * 0.06 if rec else 0)
    for i, h in enumerate(heights):
        x = x0 + i * (bw + gap)
        hh = s8 * h
        d.rounded_rectangle([x, s8 / 2 - hh / 2, x + bw, s8 / 2 + hh / 2], radius=bw / 2, fill=color)
    if rec:
        r = s8 * 0.17
        d.ellipse([s8 - 2 * r - s8 * 0.02, s8 * 0.02, s8 - s8 * 0.02, s8 * 0.02 + 2 * r], fill=(255, 59, 48, 255))
    return img.resize((size, size), Image.LANCZOS)


build = os.path.join(ROOT, 'build')
icons = os.path.join(ROOT, 'resources', 'icons')
os.makedirs(build, exist_ok=True)
os.makedirs(icons, exist_ok=True)
app_icon(1024).save(os.path.join(build, 'icon.png'))
app_icon(256).save(os.path.join(icons, 'app.png'))
app_icon(256, full_bleed=True).save(
    os.path.join(build, 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
)
# Windows : l'icône de l'app en couleur, lisible sur barre des tâches claire comme sombre
def tray_color(size, rec=False):
    img = app_icon(size, full_bleed=True)
    if rec:
        d = ImageDraw.Draw(img)
        r = max(3, round(size * 0.2))
        d.ellipse([size - 2 * r - 1, size - 2 * r - 1, size - 1, size - 1], fill=(255, 59, 48, 255), outline=(255, 255, 255, 255), width=max(1, size // 16))
    return img


for suffix, size in (('', 16), ('@2x', 32)):
    tray_color(size).save(os.path.join(icons, f'tray{suffix}.png'))
    tray_color(size, rec=True).save(os.path.join(icons, f'tray-rec{suffix}.png'))
# macOS : images « template » noir + alpha, en @1x et @2x
for suffix, size in (('', 18), ('@2x', 36)):
    tray(size, (0, 0, 0, 255)).save(os.path.join(icons, f'trayTemplate{suffix}.png'))
    tray(size, (0, 0, 0, 255), rec=True).save(os.path.join(icons, f'trayRecTemplate{suffix}.png'))
print('icônes générées')

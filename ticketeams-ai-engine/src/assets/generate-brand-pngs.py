# -*- coding: utf-8 -*-
"""
Ticketeams Brand Element Pre-Renderer
=====================================
Generates all brand overlay PNGs at FULL RESOLUTION with transparency.
These are saved once, then the image composer only PASTES them — never draws at runtime.

Output: src/assets/canva-cache/
  - header_bar_story.png   (1080×1920, gradient bar at story position)
  - header_bar_post.png    (1080×1350, gradient bar at post position)
  - header_bar_square.png  (1080×1080, gradient bar at square position)
  - cta_bar_story.png      (1080×1920, CTA bar at story position)
  - cta_bar_post.png       (1080×1350, CTA bar at post position)
  - cta_bar_square.png     (1080×1080, CTA bar at square position)
  - frame_story.png        (1080×1920, gradient frame)
  - frame_post.png         (1080×1350, gradient frame)
  - frame_square.png       (1080×1080, gradient frame)
  - vs_element.png         (200×200 standalone VS circle)
"""

import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# ===== BRAND COLORS =====
PINK   = (233, 30, 140)
ORANGE = (255, 107, 53)
PURPLE = (123, 45, 139)
GOLD   = (255, 215, 0)
DARK   = (13, 8, 24)

OUT_DIR = os.path.join(os.path.dirname(__file__), 'canva-cache')
os.makedirs(OUT_DIR, exist_ok=True)

FONT_LAT = os.path.join(os.path.dirname(__file__), 'fonts', 'DejaVuSans-Bold.ttf')

# ===== FORMAT CONFIGS (matching image-composer.js P dicts exactly) =====
FORMATS = {
    'story': {
        'W': 1080, 'H': 1920,
        'bar_y_pct': 0.095, 'bar_h_pct': 0.058,
        'cta_bar_y_pct': 0.66, 'cta_bar_h_pct': 0.06,
        'frame_margin': 18, 'frame_radius': 24, 'frame_thick': 6,
        'vs_sz': 100,
    },
    'post': {
        'W': 1080, 'H': 1350,
        'bar_y_pct': 0.125, 'bar_h_pct': 0.075,
        'cta_bar_y_pct': 0.75, 'cta_bar_h_pct': 0.078,
        'frame_margin': 16, 'frame_radius': 20, 'frame_thick': 5,
        'vs_sz': 90,
    },
    'square': {
        'W': 1080, 'H': 1080,
        'bar_y_pct': 0.125, 'bar_h_pct': 0.082,
        'cta_bar_y_pct': 0.75, 'cta_bar_h_pct': 0.085,
        'frame_margin': 14, 'frame_radius': 18, 'frame_thick': 4,
        'vs_sz': 75,
    },
}


def render_gradient_bar(W, H, y, height, alpha=220, darken=False):
    """Full-width gradient bar (pink→orange) with soft edge fade + highlight line.
    If darken=True, uses 82% darker colors (for CTA bar).
    Returns RGBA Image at WxH with bar at position y."""
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))

    pk = tuple(int(c * 0.82) for c in PINK) if darken else PINK
    og = tuple(int(c * 0.82) for c in ORANGE) if darken else ORANGE
    bar_alpha = 240 if darken else alpha

    bar_arr = np.zeros((height, W, 4), dtype=np.uint8)
    xs = np.linspace(0, 1, W)
    for i in range(3):
        bar_arr[:, :, i] = (pk[i] * (1 - xs) + og[i] * xs).astype(np.uint8)
    bar_arr[:, :, 3] = bar_alpha

    # Soft edge fade (6px top/bottom)
    fade = min(6, height // 4)
    for row in range(fade):
        bar_arr[row, :, 3] = int(bar_alpha * row / fade)
        bar_arr[height - 1 - row, :, 3] = int(bar_alpha * row / fade)

    bar_img = Image.fromarray(bar_arr)
    canvas.paste(bar_img, (0, y), bar_img)

    # Top highlight line for depth
    hl_alpha = 50 if darken else 60
    hl = Image.new('RGBA', (W, 1), (255, 255, 255, hl_alpha))
    hl_layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    hl_layer.paste(hl, (0, y))
    canvas = Image.alpha_composite(canvas, hl_layer)

    return canvas


def render_gradient_frame(W, H, margin, radius, thickness, alpha=200):
    """Gradient rounded-rectangle frame with outer glow.
    Returns RGBA Image at WxH with just the frame."""
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))

    # Outer glow layer (blurred pink frame behind crisp one)
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gm = margin - 3
    gd.rounded_rectangle([gm, gm, W - gm - 1, H - gm - 1],
                          radius=radius + 2, outline=PINK + (80,), width=3)
    glow = glow.filter(ImageFilter.GaussianBlur(radius=4))
    canvas = Image.alpha_composite(canvas, glow)

    # Crisp gradient frame
    frame = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    fd = ImageDraw.Draw(frame)
    for t in range(thickness):
        progress = t / max(thickness - 1, 1)
        r = int(PINK[0] * (1 - progress) + ORANGE[0] * progress)
        g = int(PINK[1] * (1 - progress) + ORANGE[1] * progress)
        b = int(PINK[2] * (1 - progress) + ORANGE[2] * progress)
        m = margin + t
        fd.rounded_rectangle(
            [m, m, W - m - 1, H - m - 1],
            radius=max(radius - t, 4),
            outline=(r, g, b, alpha),
            width=1
        )
    return Image.alpha_composite(canvas, frame)


def render_vs_element(size=200):
    """Premium VS circle — dark bg, pink outer + gold inner border, VS text.
    Returns RGBA Image at (size+30)×(size+30)."""
    pad = 15
    full_sz = size + pad * 2
    vs_img = Image.new('RGBA', (full_sz, full_sz), (0, 0, 0, 0))
    vd = ImageDraw.Draw(vs_img)

    # Outer glow — 8 layers, visible
    for i in range(8, 0, -1):
        glow_alpha = int(60 * (1 - i / 8))
        vd.ellipse([pad - i, pad - i, pad + size + i - 1, pad + size + i - 1],
                    fill=None, outline=(233, 30, 140, glow_alpha), width=2)

    # Dark filled circle with pink border
    vd.ellipse([pad, pad, pad + size - 1, pad + size - 1],
               fill=(20, 10, 30, 240), outline=(233, 30, 140, 230), width=3)

    # Inner gold border ring
    vd.ellipse([pad + 4, pad + 4, pad + size - 5, pad + size - 5],
               fill=None, outline=(255, 215, 0, 140), width=2)

    # VS text with shadow
    try:
        vs_font = ImageFont.truetype(FONT_LAT, int(size * 0.42))
    except:
        vs_font = ImageFont.load_default()

    vs_text = 'VS'
    bb = vd.textbbox((0, 0), vs_text, font=vs_font)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    tx = pad + (size - tw) // 2
    ty = pad + (size - th) // 2 - bb[1]  # Account for ascender offset

    # Shadow
    for dx, dy in [(-2, -2), (2, -2), (-2, 2), (2, 2), (0, -2), (0, 2), (-2, 0), (2, 0)]:
        vd.text((tx + dx, ty + dy), vs_text, font=vs_font, fill=(0, 0, 0, 140))
    # White text
    vd.text((tx, ty), vs_text, font=vs_font, fill=(255, 255, 255, 255))

    return vs_img


def main():
    print("=" * 60)
    print("Ticketeams Brand Element Pre-Renderer")
    print("=" * 60)

    generated = []

    for fmt_name, cfg in FORMATS.items():
        W, H = cfg['W'], cfg['H']
        print(f"\n--- {fmt_name.upper()} ({W}×{H}) ---")

        # 1. Header bar
        bar_y = int(H * cfg['bar_y_pct'])
        bar_h = int(H * cfg['bar_h_pct'])
        header = render_gradient_bar(W, H, bar_y, bar_h, alpha=220)
        fp = os.path.join(OUT_DIR, f'header_bar_{fmt_name}.png')
        header.save(fp, 'PNG')
        sz = os.path.getsize(fp)
        print(f"  header_bar_{fmt_name}.png  → {sz:,} bytes  ({W}×{H})")
        generated.append((f'header_bar_{fmt_name}.png', sz))

        # 2. CTA bar
        cta_y = int(H * cfg['cta_bar_y_pct'])
        cta_h = int(H * cfg['cta_bar_h_pct'])
        cta = render_gradient_bar(W, H, cta_y, cta_h, darken=True)
        fp = os.path.join(OUT_DIR, f'cta_bar_{fmt_name}.png')
        cta.save(fp, 'PNG')
        sz = os.path.getsize(fp)
        print(f"  cta_bar_{fmt_name}.png     → {sz:,} bytes  ({W}×{H})")
        generated.append((f'cta_bar_{fmt_name}.png', sz))

        # 3. Frame
        frame = render_gradient_frame(
            W, H,
            margin=cfg['frame_margin'],
            radius=cfg['frame_radius'],
            thickness=cfg['frame_thick'],
            alpha=200
        )
        fp = os.path.join(OUT_DIR, f'frame_{fmt_name}.png')
        frame.save(fp, 'PNG')
        sz = os.path.getsize(fp)
        print(f"  frame_{fmt_name}.png       → {sz:,} bytes  ({W}×{H})")
        generated.append((f'frame_{fmt_name}.png', sz))

    # 4. VS element (standalone, format-independent)
    # Generate at largest size (story=100) + padding
    vs = render_vs_element(size=120)
    fp = os.path.join(OUT_DIR, 'vs_element.png')
    vs.save(fp, 'PNG')
    sz = os.path.getsize(fp)
    print(f"\n  vs_element.png             → {sz:,} bytes  ({vs.size[0]}×{vs.size[1]})")
    generated.append(('vs_element.png', sz))

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    total_ok = 0
    for name, size in generated:
        status = "OK" if size >= 5000 else "SMALL"
        if status == "OK":
            total_ok += 1
        print(f"  {status:5s}  {name:30s}  {size:>10,} bytes")

    print(f"\n{total_ok}/{len(generated)} files generated successfully")
    print(f"Output: {OUT_DIR}")


if __name__ == '__main__':
    main()

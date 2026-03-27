/**
 * Ticketeams Image Composer v8 — "Real Canva Templates"
 *
 * Uses REAL Canva template PNGs exported by the brand owner.
 * The template contains the gradient bars (header + CTA) with proper
 * rounded corners, gradients, and positioning — zero code-drawn elements.
 *
 * Layer Stack:
 *  1. Nano Banana stadium background (full bleed)
 *  2. Cinematic darkening (vignette + center band)
 *  3. Canva template overlay (gradient bars come from the PNG)
 *  4. Ticketeams logo (HD, resize DOWN with LANCZOS)
 *  5. Left team logo (HD, LANCZOS)
 *  6. Right team logo (HD, SAME size as left, SAME Y)
 *  7. VS text (centered between logos)
 *  8. Headline text (pixel-perfect centered ON the header gradient bar)
 *  9. Team names (centered below logos)
 * 10. Date badge (pill shape below team names)
 * 11. CTA text (pixel-perfect centered ON the CTA gradient bar)
 * 12. Tagline + URL (bottom)
 *
 * Iron Rules:
 * 1. Background = FULL BLEED. No dead space.
 * 2. ALL gradient bars come from the Canva template PNG. NEVER code-drawn.
 * 3. ALL logos: HD source, resize DOWN with LANCZOS. NEVER upscale.
 * 4. Team names in Hebrew. Date ALWAYS Israeli format: 18.4.2026
 * 5. If logo file missing → OMIT entirely (never placeholder).
 * 6. JPEG quality=95.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getTeamLogoPath, normalizeCompetition, getCompetitionLogoPath } = require('../config/team-utils');

const ROOT = path.join(__dirname, '..', '..');
const ASSETS = path.join(ROOT, 'src', 'assets');
const CACHE_DIR = path.join(ASSETS, 'canva-cache');
const OUTPUT_DIR = path.join(ROOT, 'src', 'generated-ads');

// ============================================================
// Hebrew team name mapping
// ============================================================
const TEAM_NAMES_HE = {
  'real madrid': 'ריאל מדריד',
  'barcelona': 'ברצלונה',
  'atletico madrid': 'אתלטיקו מדריד',
  'real sociedad': 'ריאל סוסיאדד',
  'celta vigo': 'סלטה ויגו',
  'sevilla': 'סביליה',
  'arsenal': 'ארסנל',
  'chelsea': "צ'לסי",
  'liverpool': 'ליברפול',
  'manchester city': "מנצ'סטר סיטי",
  'man city': "מנצ'סטר סיטי",
  'manchester united': "מנצ'סטר יונייטד",
  'man utd': "מנצ'סטר יונייטד",
  'tottenham': 'טוטנהאם',
  'tottenham hotspur': 'טוטנהאם',
  'newcastle united': "ניוקאסל יונייטד",
  'newcastle': "ניוקאסל",
  'brighton': 'ברייטון',
  'crystal palace': 'קריסטל פאלאס',
  'nottingham forest': "נוטינגהאם פורסט",
  'aston villa': 'אסטון וילה',
  'bayern munich': 'באיירן מינכן',
  'bayern': 'באיירן מינכן',
  'borussia dortmund': 'דורטמונד',
  'dortmund': 'דורטמונד',
  'eintracht frankfurt': 'פרנקפורט',
  'frankfurt': 'פרנקפורט',
  'rb salzburg': 'זלצבורג',
  'juventus': 'יובנטוס',
  'ac milan': 'מילאן',
  'milan': 'מילאן',
  'inter milan': 'אינטר מילאן',
  'inter': 'אינטר מילאן',
  'napoli': 'נאפולי',
  'roma': 'רומא',
  'psg': "פריז סן ז'רמן",
  'paris saint-germain': "פריז סן ז'רמן",
  'benfica': 'בנפיקה',
  'porto': 'פורטו',
  'ajax': 'אייאקס',
  'celtic': 'סלטיק',
  'rangers': "ריינג'רס",
  'galatasaray': 'גלאטסאראי',
  'fenerbahce': 'פנרבחצ\'ה',
  'besiktas': 'בשיקטאש',
  'marseille': 'מרסיי',
  'fc copenhagen': 'קופנהגן',
  'as monaco': 'מונאקו',
};

function getHebrewTeamName(englishName) {
  return TEAM_NAMES_HE[englishName.toLowerCase()] || englishName;
}

// ============================================================
// Competition Hebrew names
// ============================================================
const COMPETITION_NAMES_HE = {
  'champions league': 'ליגת האלופות',
  'champions league quarter-final': 'ליגת האלופות - רבע גמר',
  'champions league semi-final': 'ליגת האלופות - חצי גמר',
  'champions league final': 'גמר ליגת האלופות',
  'premier league': 'פרמייר ליג',
  'la liga': 'לה ליגה',
  'serie a': 'סרייה א',
  'bundesliga': 'בונדסליגה',
  'europa league': 'הליגה האירופית',
  'world cup': 'גביע העולם',
};

function getHebrewCompetition(comp) {
  if (!comp) return '';
  const lower = comp.toLowerCase();
  return COMPETITION_NAMES_HE[lower] || comp;
}

// ============================================================
// Date to Israeli format: "2026-04-18" → "18.4.2026"
// ============================================================
function toIsraeliDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parseInt(parts[2], 10)}.${parseInt(parts[1], 10)}.${parts[0]}`;
  }
  return dateStr;
}

function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

// ============================================================
// Resolve template path for format
// ============================================================
function getTemplatePath(format) {
  if (format === 'story') {
    return path.join(CACHE_DIR, 'story_template.png');
  }
  // Both 'post' (1080×1350) and 'square' (1080×1080) use the square template (1080×1350)
  // Square format crops it to fit 1080×1080
  return path.join(CACHE_DIR, 'square_template.png');
}

// ============================================================
// Build the Python compositing script — TEMPLATE OVERLAY APPROACH
// ============================================================
function buildPythonScript(matchData, adCopy, format, outputPath) {
  const { homeTeam, awayTeam, competition } = matchData;
  const [W, H] = { story: [1080, 1920], post: [1080, 1350], square: [1080, 1080] }[format] || [1080, 1350];

  const bgPath = matchData.backgroundPath || path.join(ASSETS, 'templates', 'stadium_bg.jpg');
  const homeLogo = getTeamLogoPath(homeTeam);
  const awayLogo = getTeamLogoPath(awayTeam);
  const ttLogo = path.join(ASSETS, 'logos', 'ticketeams.png');
  const templatePath = getTemplatePath(format);

  const homeHe = getHebrewTeamName(homeTeam);
  const awayHe = getHebrewTeamName(awayTeam);
  const compHe = getHebrewCompetition(competition);
  const dateIL = toIsraeliDate(matchData.date);

  const compDateLine = dateIL || '';

  const fontBold = path.join(ASSETS, 'fonts', 'Aran-600.ttf');
  const fontReg = path.join(ASSETS, 'fonts', 'NotoSansHebrew-Regular.ttf');
  const fontLat = path.join(ASSETS, 'fonts', 'DejaVuSans-Bold.ttf');

  return `# -*- coding: utf-8 -*-
# Ticketeams Image Composer v8 — Real Canva Template Overlay
import sys, os
sys.stdout.reconfigure(encoding='utf-8')
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
try:
    from bidi.algorithm import get_display
except ImportError:
    def get_display(t): return t

# ===== CONFIG =====
W, H = ${W}, ${H}
FORMAT = '${format}'
OUTPUT = """${esc(outputPath)}"""
BG_PATH = """${esc(bgPath)}"""
HOME_LOGO = """${esc(homeLogo)}"""
AWAY_LOGO = """${esc(awayLogo)}"""
TT_LOGO = """${esc(ttLogo)}"""
TEMPLATE_PATH = """${esc(templatePath)}"""
HEADLINE = """${esc(adCopy.headline)}"""
CTA = """${esc(adCopy.cta)}"""
HOME_HE = """${esc(homeHe)}"""
AWAY_HE = """${esc(awayHe)}"""
COMP_DATE = """${esc(compDateLine)}"""
FONT_BOLD = """${esc(fontBold)}"""
FONT_REG = """${esc(fontReg)}"""
FONT_LAT = """${esc(fontLat)}"""

# Brand colors (for text accents only — bars come from template)
GOLD = (255, 215, 0)
DARK = (13, 8, 24)

# ===== LAYOUT CONFIG =====
# Template bar positions (measured from actual Canva template PNGs):
#   Story template (1080×1920): header Y=210-409, CTA Y=1542-1686
#   Square template (1080×1350): header Y=161-330, CTA Y=1089-1209
#   Square cropped (1080×1080): offset -135 → header Y=26-195, CTA Y=954-1074

if FORMAT == 'story':
    # Story 1080×1920: header bar Y=210-409, CTA bar Y=1542-1686
    # Logos centered vertically between header bar bottom (409) and CTA bar top (1542)
    # Midpoint = (409+1542)/2 = 975 → logo_cy_pct = 975/1920 ≈ 0.508
    P = {
        'tt_logo_w': 300, 'tt_logo_cy': 105,
        'header_center_y': 310,
        'headline_sz': 84,
        'logo_cy_pct': 0.47, 'logo_sz': 588,
        'vs_sz': 44,
        'comp_y_pct': 0.60, 'comp_sz': 39,
        'cta_center_y': 1614,
        'cta_sz': 68,
        'tagline_y_pct': 0.91, 'tagline_sz': 36,
        'url_y_pct': 0.94, 'url_sz': 22,
    }
elif FORMAT == 'post':
    # Post 1080×1350: header bar Y=161-330, CTA bar Y=1089-1209
    # Midpoint = (330+1089)/2 = 710 → logo_cy_pct = 710/1350 ≈ 0.526
    P = {
        'tt_logo_w': 280, 'tt_logo_cy': 75,
        'header_center_y': 246,
        'headline_sz': 77,
        'logo_cy_pct': 0.50, 'logo_sz': 490,
        'vs_sz': 40,
        'comp_y_pct': 0.67, 'comp_sz': 36,
        'cta_center_y': 1149,
        'cta_sz': 64,
        'tagline_y_pct': 0.92, 'tagline_sz': 34,
        'url_y_pct': 0.95, 'url_sz': 20,
    }
else:  # square 1080x1080 — asymmetric crop: 190 top, 80 bottom
    # Header bar after crop: Y=-29 to 140, CTA bar: Y=899-1019
    # Midpoint = (140+899)/2 = 520 → logo_cy_pct = 520/1080 ≈ 0.48
    SQUARE_CROP_TOP = 190
    P = {
        'tt_logo_w': 200, 'tt_logo_cy': 28,
        'header_center_y': 70,
        'headline_sz': 68,
        'logo_cy_pct': 0.44, 'logo_sz': 392,
        'vs_sz': 34,
        'comp_y_pct': 0.62, 'comp_sz': 31,
        'cta_center_y': 959,
        'cta_sz': 58,
        'tagline_y_pct': 0.955, 'tagline_sz': 25,
        'url_y_pct': 0.977, 'url_sz': 17,
    }

# ===== HELPERS =====
def load_font(fp, sz, variation=None):
    if fp and os.path.exists(fp):
        try:
            f = ImageFont.truetype(fp, sz)
            if variation:
                try: f.set_variation_by_name(variation)
                except: pass
            return f
        except: pass
    return ImageFont.load_default()

def rtl(text):
    try: return get_display(text)
    except: return text

def is_hebrew_char(ch):
    cp = ord(ch)
    return (0x0590 <= cp <= 0x05FF) or (0xFB1D <= cp <= 0xFB4F)

def segment_mixed(text):
    if not text: return []
    segs = []
    cur = text[0]
    cur_he = is_hebrew_char(text[0])
    for ch in text[1:]:
        if ch == ' ':
            cur += ch
            continue
        ch_he = is_hebrew_char(ch)
        if ch_he != cur_he:
            segs.append((cur, cur_he))
            cur = ch
            cur_he = ch_he
        else:
            cur += ch
    if cur: segs.append((cur, cur_he))
    return segs

def mixed_width(draw, text, f_he, f_lat):
    total = 0
    for seg, is_he in segment_mixed(text):
        f = f_he if is_he else f_lat
        bb = draw.textbbox((0, 0), seg, font=f)
        total += bb[2] - bb[0]
    return total

def draw_mixed(draw, x, y, text, f_he, f_lat, fill):
    cx = x
    he_bb = draw.textbbox((0, 0), 'א', font=f_he)
    he_h = he_bb[3] - he_bb[1] if he_bb else 30
    for seg, is_he in segment_mixed(text):
        f = f_he if is_he else f_lat
        bb = draw.textbbox((0, 0), seg, font=f)
        seg_h = bb[3] - bb[1]
        y_off = 0
        if not is_he and seg_h < he_h:
            y_off = (he_h - seg_h) // 2
        draw.text((cx, y + y_off), seg, font=f, fill=fill)
        cx += bb[2] - bb[0]
    return cx - x

def draw_centered_mixed(draw, y, text, f_he, f_lat, fill, shadow=False):
    t = rtl(text)
    tw = mixed_width(draw, t, f_he, f_lat)
    x = (W - tw) // 2
    if shadow:
        for dx, dy in [(-2,-2),(2,-2),(-2,2),(2,2),(0,-2),(0,2),(-2,0),(2,0)]:
            draw_mixed(draw, x+dx, y+dy, t, f_he, f_lat, (0, 0, 0, 120))
    draw_mixed(draw, x, y, t, f_he, f_lat, fill)

def text_width(draw, text, font):
    bb = draw.textbbox((0, 0), text, font=font)
    return bb[2] - bb[0]

def text_bbox_full(draw, text, font):
    bb = draw.textbbox((0, 0), text, font=font)
    return bb[2] - bb[0], bb[3] - bb[1], bb[1]

def paste_centered(canvas, img_path, cx, cy, size):
    if not img_path or not os.path.exists(img_path):
        return canvas
    img = Image.open(img_path).convert('RGBA')
    iw, ih = img.size
    ratio = size / max(iw, ih)
    nw, nh = int(iw * ratio), int(ih * ratio)
    img = img.resize((nw, nh), Image.LANCZOS)
    canvas.paste(img, (cx - nw // 2, cy - nh // 2), img)
    return canvas

def paste_logo_with_glow(canvas, img_path, cx, cy, size):
    if not img_path or not os.path.exists(img_path):
        return canvas
    img = Image.open(img_path).convert('RGBA')
    iw, ih = img.size
    ratio = size / max(iw, ih)
    nw, nh = int(iw * ratio), int(ih * ratio)
    img = img.resize((nw, nh), Image.LANCZOS)
    alpha_mask = img.split()[3]
    # Outer glow
    glow_pad = 20
    glow_size = (nw + glow_pad * 2, nh + glow_pad * 2)
    temp = Image.new('RGBA', glow_size, (0, 0, 0, 0))
    glow_fill = Image.new('RGBA', (nw, nh), (255, 255, 255, 50))
    glow_fill.putalpha(alpha_mask)
    temp.paste(glow_fill, (glow_pad, glow_pad), glow_fill)
    glow = temp.filter(ImageFilter.GaussianBlur(radius=10))
    # Drop shadow
    shadow = Image.new('RGBA', (nw + 20, nh + 20), (0, 0, 0, 0))
    shadow_fill = Image.new('RGBA', (nw, nh), (0, 0, 0, 70))
    shadow_fill.putalpha(alpha_mask)
    shadow.paste(shadow_fill, (10, 14), shadow_fill)
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=8))
    # Composite
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gx, gy = cx - glow_size[0] // 2, cy - glow_size[1] // 2
    if 0 <= gx < W and 0 <= gy < H:
        layer.paste(glow, (gx, gy), glow)
    sx, sy = cx - (nw + 20) // 2, cy - (nh + 20) // 2
    if 0 <= sx < W and 0 <= sy < H:
        layer.paste(shadow, (sx, sy), shadow)
    canvas = Image.alpha_composite(canvas, layer)
    canvas.paste(img, (cx - nw // 2, cy - nh // 2), img)
    return canvas

def draw_date_badge(canvas, draw, cx, cy, text, f_he, f_lat):
    t = rtl(text)
    tw = mixed_width(draw, t, f_he, f_lat)
    # Pixel-accurate centering: render text to temp image, find actual visual bounds
    tmp = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    tmp_d = ImageDraw.Draw(tmp)
    ref_y = H // 2
    draw_centered_mixed(tmp_d, ref_y, text, f_he, f_lat, (255, 255, 255, 255))
    tmp_arr = np.array(tmp)
    alpha_rows = tmp_arr[:, :, 3].max(axis=1)
    lit = np.where(alpha_rows > 0)[0]
    if len(lit) > 0:
        actual_top, actual_bot = int(lit[0]), int(lit[-1])
        actual_h = actual_bot - actual_top + 1
        actual_center = (actual_top + actual_bot) / 2.0
        center_off = actual_center - ref_y
    else:
        actual_h, center_off = 30, 0
    pad_x, pad_y = 65, 20
    bw, bh = tw + pad_x * 2, actual_h + pad_y * 2
    badge = Image.new('RGBA', (bw, bh), (0, 0, 0, 0))
    bd = ImageDraw.Draw(badge)
    bd.rounded_rectangle([0, 0, bw - 1, bh - 1], radius=30,
                         fill=(0, 0, 0, 128), outline=(255, 255, 255, 255), width=2)
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    layer.paste(badge, (cx - bw // 2, cy - bh // 2), badge)
    canvas = Image.alpha_composite(canvas, layer)
    draw = ImageDraw.Draw(canvas)
    text_y = int(cy - center_off)
    draw_centered_mixed(draw, text_y, text, f_he, f_lat, (255, 255, 255, 255))
    return canvas, draw

# ===== LOAD FONTS =====
f_headline = load_font(FONT_BOLD, P['headline_sz'])
f_comp = load_font(FONT_REG, P['comp_sz'])
f_cta = load_font(FONT_BOLD, P['cta_sz'])
f_tagline = load_font(FONT_BOLD, P['tagline_sz'])
f_url = load_font(FONT_LAT, P['url_sz'])
f_vs = load_font(FONT_LAT, P['vs_sz'])
fl_headline = load_font(FONT_LAT, P['headline_sz'])
fl_comp = load_font(FONT_LAT, P['comp_sz'])
fl_cta = load_font(FONT_LAT, P['cta_sz'])
fl_tagline = load_font(FONT_LAT, P['tagline_sz'])

# ================================================================
# LAYER 1: BACKGROUND — FULL BLEED (cover mode, crop to fill 100%)
# ================================================================
if os.path.exists(BG_PATH):
    bg = Image.open(BG_PATH).convert('RGBA')
    bw, bh = bg.size
    target_ratio = W / H
    bg_ratio = bw / bh
    if bg_ratio > target_ratio:
        new_w = int(bh * target_ratio)
        left = (bw - new_w) // 2
        bg = bg.crop((left, 0, left + new_w, bh))
    else:
        new_h = int(bw / target_ratio)
        top = (bh - new_h) // 2
        bg = bg.crop((0, top, bw, top + new_h))
    canvas = bg.resize((W, H), Image.LANCZOS)
else:
    arr = np.zeros((H, W, 3), dtype=np.uint8)
    for y in range(H):
        t = y / H
        arr[y, :] = [int(10*(1-t)+5*t), int(8*(1-t)+12*t), int(25*(1-t)+35*t)]
    canvas = Image.fromarray(arr).convert('RGBA')

# ================================================================
# LAYER 2: CINEMATIC DARKENING — vignette + center band + bottom
# ================================================================
ov_arr = np.zeros((H, W, 4), dtype=np.uint8)
top_end = int(H * 0.22)
for y in range(top_end):
    t = 1.0 - (y / top_end)
    ov_arr[y, :, 3] = int(110 * (t * t))
mid_start = int(H * 0.25)
mid_end = int(H * 0.55)
for y in range(mid_start, mid_end):
    t_in = (y - mid_start) / ((mid_end - mid_start) / 2)
    if t_in > 1.0: t_in = 2.0 - t_in
    ov_arr[y, :, 3] = max(ov_arr[y, 0, 3], int(70 * t_in))
bot_start = int(H * 0.55)
for y in range(bot_start, H):
    t = (y - bot_start) / (H - bot_start)
    ov_arr[y, :, 3] = max(ov_arr[y, 0, 3], int(180 * (t * t)))
overlay = Image.fromarray(ov_arr)
global_dark = Image.new('RGBA', (W, H), (0, 0, 0, 25))
canvas = Image.alpha_composite(canvas, global_dark)
canvas = Image.alpha_composite(canvas, overlay)

# ================================================================
# LAYER 3: CANVA TEMPLATE OVERLAY — REAL gradient bars from PNG
# ================================================================
if os.path.exists(TEMPLATE_PATH):
    tpl = Image.open(TEMPLATE_PATH).convert('RGBA')
    tpl_w, tpl_h = tpl.size
    if FORMAT == 'square' and tpl_h != H:
        # Asymmetric crop: 190 from top, 80 from bottom → 1080px
        crop_top = SQUARE_CROP_TOP
        tpl = tpl.crop((0, crop_top, tpl_w, crop_top + H))
    elif tpl.size != (W, H):
        tpl = tpl.resize((W, H), Image.LANCZOS)
    canvas = Image.alpha_composite(canvas, tpl)
    print('TEMPLATE_SRC=canva_png')
else:
    print('TEMPLATE_SRC=MISSING')

# ================================================================
# LAYER 4: TICKETEAMS LOGO — HD, resize DOWN with LANCZOS
# ================================================================
canvas = paste_centered(canvas, TT_LOGO, W // 2, P['tt_logo_cy'], P['tt_logo_w'])

# ================================================================
# LAYER 5+6: TEAM LOGOS — HD, SAME size, SAME Y position
# ================================================================
home_x = int(W * 0.25)
away_x = int(W * 0.75)
logo_cy = int(H * P['logo_cy_pct'])
canvas = paste_logo_with_glow(canvas, HOME_LOGO, home_x, logo_cy, P['logo_sz'])
canvas = paste_logo_with_glow(canvas, AWAY_LOGO, away_x, logo_cy, P['logo_sz'])

# ================================================================
# LAYER 7: VS TEXT — centered between logos (simple white text)
# ================================================================
draw = ImageDraw.Draw(canvas)
vs_text = 'VS'
vs_bb = draw.textbbox((0, 0), vs_text, font=f_vs)
vs_tw, vs_th = vs_bb[2] - vs_bb[0], vs_bb[3] - vs_bb[1]
vs_x = (W - vs_tw) // 2
vs_y = logo_cy - vs_th // 2 - vs_bb[1]
draw.text((vs_x, vs_y), vs_text, font=f_vs, fill=(255, 255, 255, 255))

# ================================================================
# LAYER 8: HEADLINE — pixel-perfect centered ON the header gradient bar
# ================================================================
# Pixel-perfect centering: render to temp, find actual visual center, offset
tmp_hl = Image.new('RGBA', (W, H), (0, 0, 0, 0))
tmp_hl_d = ImageDraw.Draw(tmp_hl)
ref_y_hl = H // 2
draw_centered_mixed(tmp_hl_d, ref_y_hl, HEADLINE, f_headline, fl_headline, (255, 255, 255, 255))
tmp_hl_arr = np.array(tmp_hl)
hl_alpha = tmp_hl_arr[:, :, 3].max(axis=1)
hl_lit = np.where(hl_alpha > 0)[0]
if len(hl_lit) > 0:
    hl_vis_center = (int(hl_lit[0]) + int(hl_lit[-1])) / 2.0
    hl_offset = hl_vis_center - ref_y_hl
    # Also check horizontal: enforce 40px margin
    hl_alpha_cols = tmp_hl_arr[:, :, 3].max(axis=0)
    hl_cols_lit = np.where(hl_alpha_cols > 0)[0]
    hl_left = int(hl_cols_lit[0]) if len(hl_cols_lit) > 0 else 40
    hl_right = int(hl_cols_lit[-1]) if len(hl_cols_lit) > 0 else W - 40
    if hl_left < 40 or hl_right > W - 40:
        print(f'WARN: headline exceeds 40px margin (L={hl_left}, R={W - hl_right})')
    hl_final_y = int(P['header_center_y'] - hl_offset)
else:
    hl_final_y = P['header_center_y']
draw_centered_mixed(draw, hl_final_y, HEADLINE, f_headline, fl_headline, (255, 255, 255, 255))

# ================================================================
# LAYER 9: (removed — team names redundant when logos visible)
# ================================================================

# ================================================================
# LAYER 10: COMPETITION + DATE — pill badge (below logos)
# ================================================================
if COMP_DATE:
    comp_cy = int(H * P['comp_y_pct']) + 10
    canvas, draw = draw_date_badge(canvas, draw, W // 2, comp_cy, COMP_DATE, f_comp, fl_comp)

# ================================================================
# LAYER 11: CTA TEXT — pixel-perfect centered ON the CTA gradient bar
# ================================================================
# Bulletproof centering: render to temp, crop actual pixels, paste centered
tmp_cta = Image.new('RGBA', (W, H), (0, 0, 0, 0))
tmp_cta_d = ImageDraw.Draw(tmp_cta)
draw_centered_mixed(tmp_cta_d, 0, CTA, f_cta, fl_cta, (255, 255, 255, 255))
tmp_cta_arr = np.array(tmp_cta)
cta_rows = tmp_cta_arr[:, :, 3].max(axis=1)
cta_cols = tmp_cta_arr[:, :, 3].max(axis=0)
cta_r_lit = np.where(cta_rows > 0)[0]
cta_c_lit = np.where(cta_cols > 0)[0]
if len(cta_r_lit) > 0 and len(cta_c_lit) > 0:
    ct_top, ct_bot = int(cta_r_lit[0]), int(cta_r_lit[-1])
    ct_left, ct_right = int(cta_c_lit[0]), int(cta_c_lit[-1])
    ct_h = ct_bot - ct_top + 1
    ct_w = ct_right - ct_left + 1
    cta_crop = tmp_cta.crop((ct_left, ct_top, ct_right + 1, ct_bot + 1))
    paste_x = (W - ct_w) // 2
    paste_y = P['cta_center_y'] - ct_h // 2
    cta_layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    cta_layer.paste(cta_crop, (paste_x, paste_y), cta_crop)
    canvas = Image.alpha_composite(canvas, cta_layer)
    draw = ImageDraw.Draw(canvas)
else:
    draw_centered_mixed(draw, P['cta_center_y'], CTA, f_cta, fl_cta, (255, 255, 255, 255))

# ================================================================
# LAYER 12: TAGLINE + URL
# ================================================================
# Render tagline as single string with Hebrew font (no mixed-segment splitting)
tagline_y = int(H * P['tagline_y_pct'])
tag_disp = rtl('כרטיסים בלבד, ללא חבילות')
tag_bb = draw.textbbox((0, 0), tag_disp, font=f_tagline)
tag_w = tag_bb[2] - tag_bb[0]
draw.text(((W - tag_w) // 2, tagline_y), tag_disp, font=f_tagline, fill=(255, 255, 255, 220))

url_y = int(H * P['url_y_pct'])
url_text = 'ticketeams.co.il'
uw = text_width(draw, url_text, f_url)
draw.text(((W - uw) // 2, url_y), url_text, font=f_url, fill=(255, 255, 255, 160))

# ================================================================
# SAVE
# ================================================================
os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
final = canvas.convert('RGB').filter(ImageFilter.UnsharpMask(radius=1.5, percent=80, threshold=0))
final.save(OUTPUT, quality=95)
print('OK:' + OUTPUT)
`;
}

// ============================================================
// Node.js wrapper functions
// ============================================================

async function composeImage(matchData, adCopy, format, outputPath) {
  const script = buildPythonScript(matchData, adCopy, format, outputPath);
  const sp = `/tmp/tc_${Date.now()}_${Math.random().toString(36).slice(2)}.py`;
  fs.writeFileSync(sp, script, 'utf8');
  try {
    const out = execSync(`python3 "${sp}"`, { timeout: 30000, encoding: 'utf8' });
    if (!out.includes('OK:')) throw new Error(`Python: ${out}`);
    return outputPath;
  } catch (e) {
    throw new Error(`compose error (${format}): ${e.message}`);
  } finally {
    try { fs.unlinkSync(sp); } catch { /* cleanup */ }
  }
}

async function composeAllFormats(matchData, adCopy, matchKey) {
  const results = {};
  const outDir = path.join(OUTPUT_DIR, matchKey);
  fs.mkdirSync(outDir, { recursive: true });
  for (const format of ['post', 'story', 'square']) {
    const fn = `${matchKey}_${adCopy.style}_${format}.jpg`;
    const op = path.join(outDir, fn);
    try {
      await composeImage(matchData, adCopy, format, op);
      results[format] = op;
      console.log(`  ✓ ${adCopy.style} / ${format}`);
    } catch (e) {
      console.error(`  ✗ ${adCopy.style} / ${format}: ${e.message}`);
      results[format] = null;
    }
  }
  return results;
}

async function saveComposedImages(matchData, adCopies, matchKey) {
  console.log(`\nImage Composer v8 — ${matchKey}`);
  const all = {};
  for (const copy of adCopies) {
    all[copy.style] = await composeAllFormats(matchData, copy, matchKey);
  }
  const flat = Object.values(all).flatMap(r => Object.values(r));
  console.log(`\n${flat.filter(Boolean).length}/${flat.length} images generated`);
  return all;
}

// ============================================================
// Creative Free Mode — Minimal overlay on cinematic AI image
// Only: TT logo, CTA bar, tagline, URL. No template, no team logos.
// ============================================================

function buildCreativeFreePythonScript(bgPath, adCopy, format, outputPath) {
  const [W, H] = { story: [1080, 1920], post: [1080, 1350], square: [1080, 1080] }[format] || [1080, 1350];
  const ttLogo = path.join(ASSETS, 'logos', 'ticketeams.png');
  const fontBold = path.join(ASSETS, 'fonts', 'Aran-600.ttf');
  const fontReg = path.join(ASSETS, 'fonts', 'NotoSansHebrew-Regular.ttf');
  const fontLat = path.join(ASSETS, 'fonts', 'DejaVuSans-Bold.ttf');

  return `# -*- coding: utf-8 -*-
# Ticketeams Creative Free Mode — Minimal Overlay
import sys, os
sys.stdout.reconfigure(encoding='utf-8')
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
try:
    from bidi.algorithm import get_display
except ImportError:
    def get_display(t): return t

W, H = ${W}, ${H}
FORMAT = '${format}'
OUTPUT = """${esc(outputPath)}"""
BG_PATH = """${esc(bgPath)}"""
TT_LOGO = """${esc(ttLogo)}"""
CTA = """${esc(adCopy.cta)}"""
FONT_BOLD = """${esc(fontBold)}"""
FONT_REG = """${esc(fontReg)}"""
FONT_LAT = """${esc(fontLat)}"""

def load_font(fp, sz, variation=None):
    if fp and os.path.exists(fp):
        try:
            f = ImageFont.truetype(fp, sz)
            if variation:
                try: f.set_variation_by_name(variation)
                except: pass
            return f
        except: pass
    return ImageFont.load_default()

def rtl(text):
    try: return get_display(text)
    except: return text

def is_hebrew_char(ch):
    cp = ord(ch)
    return (0x0590 <= cp <= 0x05FF) or (0xFB1D <= cp <= 0xFB4F)

def segment_mixed(text):
    if not text: return []
    segs = []
    cur = text[0]
    cur_he = is_hebrew_char(text[0])
    for ch in text[1:]:
        if ch == ' ':
            cur += ch
            continue
        ch_he = is_hebrew_char(ch)
        if ch_he != cur_he:
            segs.append((cur, cur_he))
            cur = ch
            cur_he = ch_he
        else:
            cur += ch
    if cur: segs.append((cur, cur_he))
    return segs

def mixed_width(draw, text, f_he, f_lat):
    total = 0
    for seg, is_he in segment_mixed(text):
        f = f_he if is_he else f_lat
        bb = draw.textbbox((0, 0), seg, font=f)
        total += bb[2] - bb[0]
    return total

def draw_mixed(draw, x, y, text, f_he, f_lat, fill):
    cx = x
    he_bb = draw.textbbox((0, 0), 'א', font=f_he)
    he_h = he_bb[3] - he_bb[1] if he_bb else 30
    for seg, is_he in segment_mixed(text):
        f = f_he if is_he else f_lat
        bb = draw.textbbox((0, 0), seg, font=f)
        seg_h = bb[3] - bb[1]
        y_off = 0
        if not is_he and seg_h < he_h:
            y_off = (he_h - seg_h) // 2
        draw.text((cx, y + y_off), seg, font=f, fill=fill)
        cx += bb[2] - bb[0]

def draw_centered_mixed(draw, y, text, f_he, f_lat, fill, shadow=False):
    t = rtl(text)
    tw = mixed_width(draw, t, f_he, f_lat)
    x = (W - tw) // 2
    if shadow:
        for dx, dy in [(-2,-2),(2,-2),(-2,2),(2,2),(0,-2),(0,2),(-2,0),(2,0)]:
            draw_mixed(draw, x+dx, y+dy, t, f_he, f_lat, (0, 0, 0, 120))
    draw_mixed(draw, x, y, t, f_he, f_lat, fill)

def text_width(draw, text, font):
    bb = draw.textbbox((0, 0), text, font=font)
    return bb[2] - bb[0]

def text_bbox_full(draw, text, font):
    bb = draw.textbbox((0, 0), text, font=font)
    return bb[2] - bb[0], bb[3] - bb[1], bb[1]

def paste_centered(canvas, img_path, cx, cy, size):
    if not img_path or not os.path.exists(img_path):
        return canvas
    img = Image.open(img_path).convert('RGBA')
    iw, ih = img.size
    ratio = size / max(iw, ih)
    nw, nh = int(iw * ratio), int(ih * ratio)
    img = img.resize((nw, nh), Image.LANCZOS)
    canvas.paste(img, (cx - nw // 2, cy - nh // 2), img)
    return canvas

# Layout params per format (matched to approved template sizes)
if FORMAT == 'story':
    TT_W, TT_CY = 300, 105
    CTA_SZ, CTA_CY = 68, 1700
    TAG_Y, TAG_SZ = 0.91, 36
    URL_Y, URL_SZ = 0.94, 22
elif FORMAT == 'post':
    TT_W, TT_CY = 280, 75
    CTA_SZ, CTA_CY = 64, 1200
    TAG_Y, TAG_SZ = 0.92, 34
    URL_Y, URL_SZ = 0.95, 20
else:
    TT_W, TT_CY = 200, 50
    CTA_SZ, CTA_CY = 58, 870
    TAG_Y, TAG_SZ = 0.93, 25
    URL_Y, URL_SZ = 0.96, 17

f_cta = load_font(FONT_BOLD, CTA_SZ)
f_tagline = load_font(FONT_BOLD, TAG_SZ)
f_url = load_font(FONT_LAT, URL_SZ)
fl_cta = load_font(FONT_LAT, CTA_SZ)
fl_tagline = load_font(FONT_LAT, TAG_SZ)

# === LAYER 1: Background — full bleed ===
if os.path.exists(BG_PATH):
    bg = Image.open(BG_PATH).convert('RGBA')
    bw, bh = bg.size
    target_ratio = W / H
    bg_ratio = bw / bh
    if bg_ratio > target_ratio:
        new_w = int(bh * target_ratio)
        left = (bw - new_w) // 2
        bg = bg.crop((left, 0, left + new_w, bh))
    else:
        new_h = int(bw / target_ratio)
        top = (bh - new_h) // 2
        bg = bg.crop((0, top, bw, top + new_h))
    canvas = bg.resize((W, H), Image.LANCZOS)
else:
    canvas = Image.new('RGBA', (W, H), (13, 8, 24, 255))

# === LAYER 2: Top gradient for logo area ===
top_grad = np.zeros((H, W, 4), dtype=np.uint8)
top_zone = int(H * 0.15)
for y in range(top_zone):
    t = 1.0 - (y / top_zone)
    top_grad[y, :, 3] = int(160 * (t * t))
canvas = Image.alpha_composite(canvas, Image.fromarray(top_grad))

# === LAYER 3: Bottom gradient for CTA area ===
bot_grad = np.zeros((H, W, 4), dtype=np.uint8)
bot_start = int(H * 0.70)
for y in range(bot_start, H):
    t = (y - bot_start) / (H - bot_start)
    bot_grad[y, :, 3] = int(200 * (t * t))
canvas = Image.alpha_composite(canvas, Image.fromarray(bot_grad))

# === LAYER 4: Ticketeams logo ===
canvas = paste_centered(canvas, TT_LOGO, W // 2, TT_CY, TT_W)

# === LAYER 5: CTA text with glow background ===
draw = ImageDraw.Draw(canvas)
cta_text = rtl(CTA)
cta_w, cta_h, cta_y_off = text_bbox_full(draw, cta_text, f_cta)

# Semi-transparent CTA pill
cta_pad_x, cta_pad_y = 60, 16
pill_w, pill_h = cta_w + cta_pad_x * 2, cta_h + cta_pad_y * 2
pill = Image.new('RGBA', (pill_w, pill_h), (0, 0, 0, 0))
pd = ImageDraw.Draw(pill)
# Pink-orange gradient pill
for row in range(pill_h):
    t = row / pill_h
    r = int(233 * (1 - t) + 255 * t)
    g = int(30 * (1 - t) + 107 * t)
    b = int(140 * (1 - t) + 53 * t)
    pd.line([(0, row), (pill_w, row)], fill=(r, g, b, 220))
# Round the corners
mask = Image.new('L', (pill_w, pill_h), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, pill_w - 1, pill_h - 1], radius=pill_h // 2, fill=255)
pill.putalpha(mask)

pill_layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
pill_x = W // 2 - pill_w // 2
pill_y = CTA_CY - pill_h // 2
pill_layer.paste(pill, (pill_x, pill_y), pill)
canvas = Image.alpha_composite(canvas, pill_layer)
# Pixel-perfect CTA centering: render to temp, crop, paste centered on pill
tmp_cta = Image.new('RGBA', (W, H), (0, 0, 0, 0))
tmp_cta_d = ImageDraw.Draw(tmp_cta)
draw_centered_mixed(tmp_cta_d, 0, CTA, f_cta, fl_cta, (255, 255, 255, 255))
tmp_arr = np.array(tmp_cta)
cr = tmp_arr[:, :, 3].max(axis=1)
cc = tmp_arr[:, :, 3].max(axis=0)
cr_lit = np.where(cr > 0)[0]
cc_lit = np.where(cc > 0)[0]
if len(cr_lit) > 0 and len(cc_lit) > 0:
    ct, cb = int(cr_lit[0]), int(cr_lit[-1])
    cl, crr = int(cc_lit[0]), int(cc_lit[-1])
    ch, cw = cb - ct + 1, crr - cl + 1
    crop = tmp_cta.crop((cl, ct, crr + 1, cb + 1))
    px = (W - cw) // 2
    py = CTA_CY - ch // 2
    cta_layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    cta_layer.paste(crop, (px, py), crop)
    canvas = Image.alpha_composite(canvas, cta_layer)
else:
    draw = ImageDraw.Draw(canvas)
    draw_centered_mixed(draw, CTA_CY, CTA, f_cta, fl_cta, (255, 255, 255, 255))
draw = ImageDraw.Draw(canvas)

# === LAYER 6: Tagline + URL (single-line Hebrew font, no mixed splitting) ===
tagline_y = int(H * TAG_Y)
tag_disp = rtl('כרטיסים בלבד, ללא חבילות')
tag_bb = draw.textbbox((0, 0), tag_disp, font=f_tagline)
tag_w = tag_bb[2] - tag_bb[0]
draw.text(((W - tag_w) // 2, tagline_y), tag_disp, font=f_tagline, fill=(255, 255, 255, 220))

url_y = int(H * URL_Y)
url_text = 'ticketeams.co.il'
uw = text_width(draw, url_text, f_url)
draw.text(((W - uw) // 2, url_y), url_text, font=f_url, fill=(255, 255, 255, 160))

# === SAVE (with sharpening) ===
os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
final = canvas.convert('RGB').filter(ImageFilter.UnsharpMask(radius=1.5, percent=80, threshold=0))
final.save(OUTPUT, quality=95)
print('OK:' + OUTPUT)
`;
}

async function composeCreativeFree(bgPath, adCopy, format, outputPath) {
  const script = buildCreativeFreePythonScript(bgPath, adCopy, format, outputPath);
  const sp = `/tmp/tc_cf_${Date.now()}_${Math.random().toString(36).slice(2)}.py`;
  fs.writeFileSync(sp, script, 'utf8');
  try {
    const out = execSync(`python3 "${sp}"`, { timeout: 30000, encoding: 'utf8' });
    if (!out.includes('OK:')) throw new Error(`Python: ${out}`);
    return outputPath;
  } catch (e) {
    throw new Error(`creative free compose error (${format}): ${e.message}`);
  } finally {
    try { fs.unlinkSync(sp); } catch { /* cleanup */ }
  }
}

async function composeCreativeFreeAllFormats(bgPath, adCopy, matchKey) {
  const results = {};
  const outDir = path.join(OUTPUT_DIR, matchKey);
  fs.mkdirSync(outDir, { recursive: true });
  for (const format of ['post', 'story', 'square']) {
    const fn = `${matchKey}_creative_free_${adCopy.style}_${format}.jpg`;
    const op = path.join(outDir, fn);
    try {
      await composeCreativeFree(bgPath, adCopy, format, op);
      results[format] = op;
      console.log(`  ✓ creative_free / ${adCopy.style} / ${format}`);
    } catch (e) {
      console.error(`  ✗ creative_free / ${adCopy.style} / ${format}: ${e.message}`);
      results[format] = null;
    }
  }
  return results;
}

module.exports = { composeImage, composeAllFormats, saveComposedImages, composeCreativeFree, composeCreativeFreeAllFormats };

#!/usr/bin/env python3
# =============================================================================
# assets/pack/src/make_pack.py — the recipe that turns the licence-checked originals into the embedded asset pack
# (CONTRACT §16.1). It is an offline tool: nothing in the app or the build runs it. tools/build.mjs only reads its
# outputs (assets/pack/*.webp|*.png + MANIFEST.json) and checks every file against the manifest's sha256.
#
#   python3 -I assets/pack/src/make_pack.py --acg <dir>[,<dir>…] --met <dir> --raw <dir> --out assets/pack [--dry]
#                                           [--credits docs/ASSET-CREDITS.md]
#     --acg   ambientCG 1K JPG originals named <AssetId>_1K_<Color|NormalGL|Roughness>.jpg (CC0 1.0)
#     --met   The Met Open Access originals named met_<objectID>_<n>_*.jpg (CC0)
#     --raw   the downloader's ready files: bluenoise_64_rgba.png, hdri_sky_*_512x256_rgbE.png
#     --dry   print the size table only
#   Needs Python 3 with numpy and Pillow (WebP). Output is deterministic for a given Pillow / libwebp version.
#
# What it does
#   colour   linear-light Lanczos resize, lossy WebP; the quality is searched per map (error relative to the map's own
#            contrast), because flat, dark maps (clay, glaze, paper, timber) turn blocky at a fixed quality
#   normal   OpenGL convention (Y+), resized as vectors and renormalised, never through an sRGB conversion. Stored as an
#            "xy" greyscale image — left half = X, right half = Y (Z is rebuilt at run time by G.pack) — because lossy
#            WebP always subsamples chroma (4:2:0), which destroys the X/Y difference of an RGB normal map
#            (measured: gravel 256 px RGB q94 = 11.7° mean error at 49 KB; xy q70 = 3.1° at 51 KB)
#   rough    greyscale 256 px
#   giwa     the Korean roof tile set is GENERATED here: a procedural barrel profile (수키와 ribs, 암키와 pans, course
#            steps) gives normal / roughness / occlusion; ambientCG RoofingTiles013A only gives the fired-clay surface
#   art      the museum photograph is cropped to the object (photographic backdrop and colour charts removed — the
#            artwork itself is never retouched), resized, lossy WebP
#   sky      the mantissa / exponent pixels of the downloader, re-wrapped as lossless WebP (bit-identical, 30 % smaller)
#   alpha    Color + Opacity merged into one RGBA card; the leaf colour is bled into the transparent texels
# =============================================================================
import argparse, hashlib, io, json, math, os, sys

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
SEED = 20261114

# ---------------------------------------------------------------- colour helpers
def s2l(u8):
    c = np.asarray(u8, dtype=np.float32) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)

def l2s(lin):
    lin = np.clip(lin, 0.0, 1.0)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055).astype(np.float32)

def to_u8(a):
    return np.clip(np.round(a * 255.0), 0, 255).astype(np.uint8)

def resize_f(a, w, h):
    """Lanczos resize of a float array (H, W, C) or (H, W)."""
    if a.ndim == 2:
        return np.asarray(Image.fromarray(np.ascontiguousarray(a, dtype=np.float32), mode='F').resize((w, h), Image.LANCZOS))
    return np.stack([np.asarray(Image.fromarray(np.ascontiguousarray(a[..., i], dtype=np.float32), mode='F').resize((w, h), Image.LANCZOS)) for i in range(a.shape[-1])], -1)

def webp_bytes(img, q, lossless=False):
    bio = io.BytesIO()
    if lossless:
        img.save(bio, 'WEBP', lossless=True, quality=100, method=6, exact=True)
    else:
        img.save(bio, 'WEBP', quality=int(q), method=6)
    return bio.getvalue()

def avg_srgb(img_rgb):
    """mean colour in linear light, returned as sRGB 0..255 integers (placeholder texel + tint normalisation)"""
    lin = s2l(np.asarray(img_rgb.convert('RGB'))).reshape(-1, 3).mean(0)
    return [int(v) for v in to_u8(l2s(lin))]

def wrap_blur(a, sigma):
    """gaussian blur with wrap-around (tileable)"""
    if sigma <= 0:
        return a
    r = max(1, int(math.ceil(sigma * 3)))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); k /= k.sum()
    out = np.zeros_like(a)
    for i, w in enumerate(k):
        out += w * np.roll(a, i - r, axis=1)
    a2 = np.zeros_like(a)
    for i, w in enumerate(k):
        a2 += w * np.roll(out, i - r, axis=0)
    return a2

# ---------------------------------------------------------------- quality search
def _fit(encode, measure, limit, cap, qmin, qmax):
    """smallest quality whose error is under `limit`; when that is larger than `cap` bytes, the best quality that fits"""
    best = None
    lo, hi = qmin, qmax
    while lo <= hi:
        q = (lo + hi) // 2
        b = encode(q)
        if measure(b) <= limit:
            best = (b, q); hi = q - 1
        else:
            lo = q + 1
    if best is None:
        best = (encode(qmax), qmax)
    if cap and len(best[0]) > cap:
        lo, hi, fit = qmin, best[1] - 1, None
        while lo <= hi:
            q = (lo + hi) // 2
            b = encode(q)
            if len(b) <= cap:
                fit = (b, q); lo = q + 1
            else:
                hi = q - 1
        best = fit or (encode(qmin), qmin)
    return best[0], best[1], measure(best[0])

def encode_colour(img, cap=0, target_rel=0.30, max_rmse=3.2, qmin=50, qmax=96):
    """the error target is relative to the map's own fine contrast (flat, dark maps turn blocky at a fixed quality)"""
    rgb = img.convert('RGB')
    ref = np.asarray(rgb, dtype=np.float32)
    small = np.asarray(rgb.resize((max(1, img.width // 16), max(1, img.height // 16)), Image.BOX).resize(img.size, Image.BILINEAR), dtype=np.float32)
    std = float(np.sqrt(((ref - small) ** 2).mean()))
    limit = min(max_rmse, max(0.6, target_rel * std))
    rmse = lambda b: float(np.sqrt(((np.asarray(Image.open(io.BytesIO(b)).convert('RGB'), dtype=np.float32) - ref) ** 2).mean()))
    b, q, e = _fit(lambda q: webp_bytes(rgb, q), rmse, limit, cap, qmin, qmax)
    return b, q, e, std

def xy_image(v):
    u = to_u8(v * 0.5 + 0.5)
    return Image.fromarray(np.concatenate([u[..., 0], u[..., 1]], axis=1), 'L')

def xy_decode(img, w):
    g = np.asarray(img.convert('L'), dtype=np.float32) / 255.0 * 2 - 1
    x, y = g[:, :w], g[:, w:]
    z = np.sqrt(np.clip(1 - x * x - y * y, 0.0, 1.0))
    v = np.stack([x, y, z], -1)
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-6)

def ang_err(a, b):
    d = np.clip((a * b).sum(-1), -1, 1)
    return float(np.degrees(np.arccos(d)).mean())

def encode_normal(v, cap=0, target_deg=2.4, qmin=40, qmax=94):
    """v: unit vectors (H, W, 3). Mean angular error under the target (relative for nearly flat maps)."""
    w = v.shape[1]
    flat = np.zeros_like(v); flat[..., 2] = 1
    relief = ang_err(v, flat)                    # how far the map is from flat, degrees
    limit = min(target_deg, max(1.0, 0.4 * relief))
    img = xy_image(v)
    err = lambda b: ang_err(v, xy_decode(Image.open(io.BytesIO(b)), w))
    b, q, e = _fit(lambda q: webp_bytes(img, q), err, limit, cap, qmin, qmax)
    return b, q, e, relief

def encode_grey(img, q=58, cap=0):
    g = img.convert('L')
    b = webp_bytes(g, q)
    while cap and len(b) > cap and q > 30:
        q -= 6; b = webp_bytes(g, q)
    return b, q

# ---------------------------------------------------------------- ambientCG sources
class Acg:
    def __init__(self, dirs):
        self.dirs = dirs
    def path(self, aid, m):
        for d in self.dirs:
            p = os.path.join(d, f'{aid}_1K_{m}.jpg')
            if os.path.exists(p):
                return p
        raise FileNotFoundError(f'{aid} {m}: not in {self.dirs} (fetch it: see docs/ASSET-CREDITS.md)')
    def colour(self, aid, size):
        im = Image.open(self.path(aid, 'Color')).convert('RGB')
        w, h = im.size
        W, H = size, int(round(size * h / w))
        return Image.fromarray(to_u8(l2s(resize_f(s2l(np.asarray(im)), W, H))), 'RGB')
    def normal(self, aid, size):
        im = Image.open(self.path(aid, 'NormalGL')).convert('RGB')
        w, h = im.size
        W, H = size, int(round(size * h / w))
        v = resize_f(np.asarray(im, dtype=np.float32) / 255.0 * 2 - 1, W, H)
        return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-6)
    def rough(self, aid, size):
        im = Image.open(self.path(aid, 'Roughness')).convert('L')
        w, h = im.size
        return im.resize((size, int(round(size * h / w))), Image.LANCZOS)

def alpha_card(acg, aid, size):
    """Color + Opacity -> RGBA card. The leaf colour is bled into the transparent texels (multi-scale fill), so
    mip-mapping and bilinear filtering never pull the photograph's black or cream backdrop into the leaf edges."""
    c = Image.open(acg.path(aid, 'Color')).convert('RGB')
    o = Image.open(acg.path(aid, 'Opacity')).convert('L')
    rgb = s2l(np.asarray(c)); al = np.asarray(o, dtype=np.float32) / 255.0
    solid = (al > 0.55).astype(np.float32)
    acc = rgb * solid[..., None]; wsum = solid.copy()
    filled = solid > 0
    out = rgb.copy()
    for sigma in (1.5, 3, 6, 12, 24, 48, 96):
        bw = wrap_blur(wsum, sigma)
        bc = np.stack([wrap_blur(np.ascontiguousarray(acc[..., i]), sigma) for i in range(3)], -1)
        ok = (bw > 0.02) & ~filled
        out[ok] = bc[ok] / bw[ok][:, None]
        filled |= ok
    if (~filled).any():
        out[~filled] = (acc.reshape(-1, 3).sum(0) / max(float(wsum.sum()), 1.0))
    w, h = c.size
    W, H = size, int(round(size * h / w))
    rgb_s = to_u8(l2s(resize_f(out, W, H)))
    al_s = to_u8(np.clip(resize_f(al, W, H), 0, 1))
    return Image.fromarray(np.dstack([rgb_s, al_s]), 'RGBA')

def webp_rgba(img, q):
    bio = io.BytesIO()
    img.save(bio, 'WEBP', quality=int(q), method=6, exact=True, alpha_quality=92)
    return bio.getvalue()

# set, ambientCG id, colour px, colour cap KB, normal px, normal cap KB, Korean label, what it is used for
# (roughness: 256 px, fixed quality). The caps keep the pack inside its 3.0 MB budget (CONTRACT §16.0): the large natural
# surfaces get the most bytes, flat interior papers the least.
SETS = [
    ('thatch_choga', 'ThatchedRoof001A', 512, 40, 256, 20, '초가지붕 짚', '초가 지붕'),
    ('lime_plaster_wall', 'Plaster003', 512, 56, 256, 16, '회벽 (석회 미장)', '한옥 흰 벽'),
    ('hwangto_clay_wall', 'Clay002', 512, 8, 256, 10, '황토벽', '흙벽·부뚜막'),
    ('timber_beam_dark', 'Wood036', 512, 36, 256, 8, '오래된 기둥·보 (짙은 나무)', '실내 기둥·대들보'),
    ('wood_planks_dark', 'Planks023A', 512, 30, 384, 12, '오래된 널빤지', '곳간·헛간 널벽'),
    ('maru_floor', 'WoodFloor041', 512, 40, 384, 8, '우물마루 바닥', '대청마루'),
    ('hanji_paper', 'Paper001', 512, 14, 256, 5, '한지', '창호지·벽지'),
    ('jangpan_floor_paper', 'Paper006', 512, 20, 256, 2, '장판지', '온돌방 바닥'),
    ('straw_mat', 'Tatami001', 512, 40, 256, 18, '돗자리·멍석', '바닥 깔개'),
    ('woven_basket', 'Wicker008A', 512, 28, 256, 12, '바구니 엮음', '소쿠리·채반'),
    ('hemp_linen', 'Fabric062', 384, 36, 256, 8, '삼베', '보자기·덮개 천'),
    ('onggi_glaze', 'GlazedTerracotta001', 512, 24, 384, 4, '옹기 유약', '항아리·장독'),
    ('field_soil', 'Ground048', 512, 62, 256, 26, '밭 흙', '텃밭·숲 바닥'),
    ('yard_dirt_path', 'Ground069', 512, 62, 256, 20, '마당 흙길', '마당·오솔길'),
    ('gravel', 'Gravel022', 512, 62, 256, 40, '자갈', '자갈 마당·물가'),
    ('grass', 'Grass004', 512, 62, 192, 14, '잔디', '풀밭'),
    ('granite_stone', 'Rock043S', 512, 62, 256, 30, '화강암', '바위·기단·석등'),
    ('stone_wall_doldam', 'Rocks001', 512, 62, 384, 48, '돌담', '돌담·석축'),
    ('pine_bark', 'Bark014', 512, 62, 256, 16, '소나무 껍질', '나무 줄기'),
    # added in phase 8 (the brief: a second wood, flagstone, rope, bamboo)
    ('pine_timber', 'Wood048', 512, 40, 384, 16, '소나무 목재 (밝은 나뭇결)', '기둥·보·문틀 (바깥)'),
    ('pine_planks', 'Planks021', 512, 36, 384, 12, '소나무 널빤지', '마루·데크·울타리'),
    ('flagstone', 'Rocks025', 512, 62, 256, 18, '박석 (납작돌 포장)', '광장·디딤돌 길'),
    ('straw_rope', 'Rope001', 512, 18, 256, 14, '새끼줄', '금줄·초가 고삿'),
    ('bamboo', 'Bamboo001C', 512, 24, 256, 6, '대나무', '대울타리·발'),
]
GIWA = ('giwa_roof_tile', 'RoofingTiles013A', 512, 26, 512, 12, '기와 (골기와)', '기와지붕')
ROUGH_PX, ROUGH_Q, ROUGH_CAP = 256, 58, 7

# ---------------------------------------------------------------- giwa: procedural barrel profile + photographed clay surface
def tile_noise(size, cells, rng):
    """smooth tileable value noise"""
    g = rng.random((cells, cells)).astype(np.float32)
    idx = (np.arange(size) + 0.5) / size * cells
    i0 = np.floor(idx).astype(int) % cells; i1 = (i0 + 1) % cells
    t = idx - np.floor(idx); t = t * t * (3 - 2 * t)
    a = g[i0][:, i0] * (1 - t)[None, :] + g[i0][:, i1] * t[None, :]
    b = g[i1][:, i0] * (1 - t)[None, :] + g[i1][:, i1] * t[None, :]
    return a * (1 - t)[:, None] + b * t[:, None]

def tile_fbm(size, octaves, rng):
    out = np.zeros((size, size), np.float32); amp = 1.0; tot = 0.0
    for c in octaves:
        out += tile_noise(size, c, rng) * amp; tot += amp; amp *= 0.55
    return out / tot

def make_giwa(acg, S=512, tile_m=2.4, ribs=8, courses=8):
    """returns (colour RGB image, normal vectors, roughness L image). One tile = 2.4 m x 2.4 m: 8 rib pitches of
    0.30 m across U, 8 tile courses of 0.30 m along V (V runs up the slope, so image-down = towards the eave)."""
    rng = np.random.default_rng(SEED)
    px = tile_m / S                                   # metres per texel
    pitch = tile_m / ribs
    xs = (np.arange(S) + 0.5) / S
    X, Y = np.meshgrid(xs, xs)                        # Y: 0 = top of the image (ridge side), 1 = bottom (eave side)
    p = X * ribs
    ri = np.floor(p).astype(int)                      # rib (cover tile) column
    dx = p - ri - 0.5                                 # -0.5 .. 0.5 across one pitch, rib centre at 0
    wr = 0.235                                        # half width of the cover tile in pitches (7 cm)
    in_rib = np.abs(dx) < wr
    s = np.clip(np.abs(dx) / wr, 0, 1)
    hr, dp = 0.068, 0.020                             # rib height / pan sag (m)
    rib_h = hr * np.sqrt(np.maximum(1 - s * s, 0.0))
    t = np.clip((np.abs(dx) - wr) / (0.5 - wr), 0, 1)  # 0 at the rib edge .. 1 in the middle of the pan
    pan_h = -dp * (1 - (1 - t) ** 2)
    pj = np.floor(p + 0.5).astype(int) % ribs         # pan (concave tile) column
    # course steps: every tile lies on the next lower one, so it rises towards its lower end and drops at the joint
    ph_r = rng.random(ribs).astype(np.float32) * 0.5
    ph_p = (rng.random(ribs).astype(np.float32) * 0.5 + 0.5)
    q_r = Y * courses + ph_r[ri % ribs]
    q_p = Y * courses + ph_p[pj]
    t_r = q_r - np.floor(q_r); t_p = q_p - np.floor(q_p)
    c_r = np.floor(q_r).astype(int) % courses; c_p = np.floor(q_p).astype(int) % courses
    step_r = 0.011 * t_r + 0.004 * np.clip((t_r - 0.86) / 0.14, 0, 1)   # a slightly raised lip at the lower end
    step_p = 0.009 * t_p
    h = np.where(in_rib, rib_h + step_r, pan_h + step_p).astype(np.float32)
    h = wrap_blur(h, 0.8)
    # fired-clay micro relief + a few chips
    micro = (tile_fbm(S, [64, 128, 256], rng) - 0.5) * 0.0011
    h += micro
    # ------------------------------------------------ normal (OpenGL: +X right, +Y = +V = image up)
    dhdx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * px)
    dhdj = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / (2 * px)   # towards the bottom of the image = -V
    n = np.stack([-dhdx, dhdj, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    # ------------------------------------------------ occlusion from the height field (lower than the surroundings)
    occ = np.clip((wrap_blur(h, 5.0) - h) / 0.022, 0, 1) * 0.6 + np.clip((wrap_blur(h, 12.0) - h) / 0.04, 0, 1) * 0.4
    joint_r = np.where(in_rib, np.clip(1 - t_r / 0.07, 0, 1), 0.0)      # the shadowed line right below a cover joint
    joint_p = np.where(in_rib, 0.0, np.clip(1 - t_p / 0.05, 0, 1))
    occ = np.clip(occ + 0.55 * wrap_blur((joint_r + 0.7 * joint_p).astype(np.float32), 0.9), 0, 1)
    # ------------------------------------------------ colour: photographed clay surface x per-tile tone x occlusion
    photo = s2l(np.asarray(acg.colour('RoofingTiles013A', S)))
    # the photograph has three one-off marks (a chipped tile, two stains) that would repeat on every roof: each is
    # replaced by a clean neighbouring patch of the same photograph (feathered)
    for (x0, y0, x1, y1, ox, oy) in ((212, 262, 290, 400, 150, -120), (190, 114, 218, 142, 60, 40), (316, 396, 346, 426, -70, -50)):
        yy, xx = np.mgrid[y0:y1, x0:x1]
        fx = np.minimum(xx - x0, x1 - 1 - xx) / 8.0; fy = np.minimum(yy - y0, y1 - 1 - yy) / 8.0
        m = np.clip(np.minimum(fx, fy), 0, 1)[..., None]
        photo[y0:y1, x0:x1] = photo[y0:y1, x0:x1] * (1 - m) + photo[(yy + oy) % S, (xx + ox) % S] * m
    lum = photo.mean(-1)
    grain = lum / max(float(lum.mean()), 1e-6)
    grain = 1 + (grain - wrap_blur(grain.astype(np.float32), 24.0)) * 1.6        # keep the mottling, drop its own tile layout
    tone_r = (0.92 + 0.18 * rng.random((ribs, courses))).astype(np.float32)
    tone_p = (0.84 + 0.18 * rng.random((ribs, courses))).astype(np.float32)
    tone = np.where(in_rib, tone_r[ri % ribs, c_r], tone_p[pj, c_p])
    hue_r = rng.random((ribs, courses)).astype(np.float32); hue_p = rng.random((ribs, courses)).astype(np.float32)
    hue = np.where(in_rib, hue_r[ri % ribs, c_r], hue_p[pj, c_p])       # 0 = bluish grey, 1 = warm grey
    base = np.array([0.070, 0.074, 0.083], np.float32)                 # charcoal grey fired clay (linear)
    warm = np.array([0.083, 0.078, 0.072], np.float32)
    col = base[None, None, :] * (1 - hue[..., None] * 0.55) + warm[None, None, :] * (hue[..., None] * 0.55)
    top = np.where(in_rib, np.sqrt(np.maximum(1 - s * s, 0)), 0.0)      # worn, dusty crown of the cover tiles
    col = col * (tone * grain * (1 + 0.18 * top) * (1 - 0.68 * occ))[..., None]
    # weathering: pale mineral bloom, grey-green lichen in the damp pans, dark run-off streaks
    bloom = np.clip((tile_fbm(S, [3, 7, 15, 40], rng) - 0.56) / 0.2, 0, 1)
    col = col * (1 + 0.55 * bloom[..., None]) + np.array([0.012, 0.012, 0.011], np.float32) * bloom[..., None]
    lich = np.clip((tile_fbm(S, [5, 11, 27, 60], rng) - 0.60) / 0.12, 0, 1) * np.where(in_rib, 0.25, 1.0)
    lich_col = np.array([0.105, 0.125, 0.082], np.float32)
    col = col * (1 - 0.55 * lich[..., None]) + lich_col[None, None, :] * (0.55 * lich[..., None]) * (1 - 0.4 * occ[..., None])
    streak = tile_fbm(S, [48, 96], rng)
    streak = wrap_blur(np.ascontiguousarray(streak), 0.0)
    streak_v = np.zeros_like(streak)
    for k in range(-9, 10):                                            # smear along V (water runs down the slope)
        streak_v += np.roll(streak, k * 3, axis=0)
    streak_v /= 19.0
    col *= (1 - 0.35 * np.clip((0.5 - streak_v) / 0.08, 0, 1) * np.where(in_rib, 0.3, 1.0))[..., None]
    colour = Image.fromarray(to_u8(l2s(col)), 'RGB')
    # ------------------------------------------------ roughness
    r = 0.86 - 0.16 * top + 0.10 * occ + 0.10 * lich - 0.05 * (grain - 1) * 4
    r += (tile_fbm(S, [32, 80], rng) - 0.5) * 0.08
    rough = Image.fromarray(to_u8(np.clip(r, 0.45, 1.0)), 'L').resize((256, 256), Image.LANCZOS)
    return colour, n.astype(np.float32), rough

# ---------------------------------------------------------------- artworks (The Met Open Access, CC0)
# id, objectID, file prefix, crop box in the original (x0, y0, x1, y1) or None, long side, Korean title
ART = [
    ('chaekgeori_screen', 73134, 'met_73134_0_', (50, 43, 3949, 1547), 2048, '책거리 병풍 (책과 문방구)'),
    ('birds_flowers_screen', 44760, 'met_44760_0_', (14, 22, 3791, 2107), 1920, '화조도 병풍 (꽃과 새)'),
    ('still_life_screen', 646996, 'met_646996_0_', (4, 4, 3957, 1828), 2048, '기명절지도 병풍 (그릇과 꽃)'),
    ('rooster_hen_minhwa', 40073, 'met_40073_0_', (22, 2, 840, 1998), 1152, '금계도 (황금 수탉과 암탉)'),
    ('tiger_scroll', 40069, 'met_40069_0_', (634, 0, 2403, 4000), 1152, '호랑이'),
    ('dragon_carp_minhwa', 853892, 'met_853892_0_', (125, 137, 2417, 3700), 1152, '용과 잉어'),
    ('deer_pines', 78286, 'met_78286_0_', (40, 0, 894, 2000), 1152, '소나무 아래 사슴 (송록도)'),
    ('wild_geese_landscape', 39888, 'met_39888_0_', (10, 2, 1669, 3721), 1152, '모래톱에 내려앉는 기러기 (평사낙안)'),
    ('plum_branch', 40445, 'met_40445_0_', (2, 2, 2592, 3998), 1152, '매화 가지'),
    ('bamboo_wind', 50486, 'met_50486_0_', (32, 2, 1686, 3880), 1152, '바람에 흔들리는 대나무 (풍죽도)'),
    ('portrait_yun_dongseom', 656430, 'met_656430_0_', (232, 0, 2291, 3880), 1152, '윤동섬 초상'),
    ('officials_gathering', 74448, 'met_74448_0_', (28, 2, 2319, 3879), 1152, '관리들의 모임 그림 (계회도)'),
]
# the official record of each object (The Met Open Access CSV, read 2026-11): artist with its prefix, culture, period
MET = {
    73134: dict(title="Books and Scholars' Possessions", artist='Unidentified artist', culture='Korea', period='', date='early 20th century', medium='Ten-panel folding screen; ink and color on silk', accession='2005.385'),
    44760: dict(title='Birds and Flowers', artist='Unidentified artist', culture='Korea', period='Joseon dynasty (1392–1910)', date='late 19th–early 20th century', medium='Ten-panel folding screen; ink and color on silk', accession='1993.255'),
    646996: dict(title='Still life with bronze vessels and flowering plants', artist='Attributed to Jang Seung-eop (pen name: Owon), Korean, 1843–1897', culture='Korea', period='Joseon dynasty (1392–1910)', date='1894', medium='Ten-panel folding screen; ink on paper', accession='2014.247'),
    40073: dict(title='Golden Rooster and Hen', artist='Unidentified artist', culture='Korea', period='Joseon dynasty (1392–1910)', date='19th century', medium='Hanging scroll; ink and color on paper', accession='19.103.2'),
    40069: dict(title='Tiger', artist='In the style of Muqi (Chinese, active ca. 1250–80)', culture='Korea or possibly Japan', period='', date='16th or 17th century', medium='Hanging scroll; ink on silk', accession='12.123.1'),
    853892: dict(title='Dragon and carp', artist='Unidentified artist, Korean', culture='Korea', period='Joseon dynasty (1392–1910)', date='late 19th century', medium='Framed painting; ink and color on paper', accession='2024.89.3'),
    78286: dict(title='Deer amid Pine Trees', artist='Unidentified artist', culture='Korea', period='Joseon dynasty (1392–1910)', date='19th century', medium='Pair of hanging scrolls; ink and color on silk', accession='2013.29a, b'),
    39888: dict(title='Wild geese descending to sandbar', artist='Unidentified artist', culture='Korea', period='Joseon dynasty (1392–1910)', date='late 15th–early 16th century', medium='Hanging scroll; ink on silk', accession='1992.337'),
    40445: dict(title='Plum Branch', artist='Yi Yu-won (Korean, 1814–1888)', culture='Korea', period='Joseon dynasty (1392–1910)', date='dated 1888', medium='Hanging scroll; ink on paper', accession='1990.230'),
    50486: dict(title='Bamboo in the Wind', artist='Yi Jeong (artist name: Taneun), Korean, 1541–1626', culture='Korea', period='Joseon dynasty (1392–1910)', date='early 17th century', medium='Hanging scroll; ink on silk with gold on colophon', accession='2015.300.299'),
    656430: dict(title='Portrait of Yun Dongseom (1710–1795)', artist='Unidentified artist (Korean, late 18th–early 19th century)', culture='Korea', period='Joseon dynasty (1392–1910)', date='ca. 1790–1805', medium='Hanging scroll; ink and color on silk', accession='2014.605'),
    74448: dict(title='Gathering of government officials', artist='Unidentified artist', culture='Korea', period='Joseon dynasty (1392–1910)', date='ca. 1551', medium='Hanging scroll; ink and color on silk', accession='2008.55'),
}
MET_EVIDENCE = 'The Met Open Access: isPublicDomain = true in the official object CSV; "images of artworks it believes to be in the public domain … unrestricted use … Creative Commons Zero (CC0)" (metmuseum.org/policies/image-resources)'
ACG_EVIDENCE = '"All ambientCG assets are provided under the Creative Commons CC0 1.0 Universal License." (docs.ambientcg.com/license)'

def encode_art(img, budget):
    """highest quality that fits the byte budget (never below q58)"""
    lo, hi, best = 58, 90, None
    while lo <= hi:
        q = (lo + hi) // 2
        b = webp_bytes(img, q)
        if len(b) <= budget:
            best = (b, q); lo = q + 1
        else:
            hi = q - 1
    if best is None:
        best = (webp_bytes(img, 58), 58)
    return best

def find_one(d, prefix):
    hits = sorted(f for f in os.listdir(d) if f.startswith(prefix))
    if not hits:
        raise FileNotFoundError(prefix + '* in ' + d)
    return os.path.join(d, hits[0])

# ---------------------------------------------------------------- sky (Poly Haven, CC0): mantissa | exponent halves
def sky_stats(img):
    a = np.asarray(img.convert('RGB'), dtype=np.float32)
    H, W2, _ = a.shape
    W = W2 // 2
    hdr = (a[:, :W] + 0.5) / 256.0 * np.power(2.0, a[:, W:, 0] - 128.0)[..., None]
    L = 0.2126 * hdr[..., 0] + 0.7152 * hdr[..., 1] + 0.0722 * hdr[..., 2]
    thr = np.quantile(L, 0.9995)
    ys, xs = np.where(L >= thr); w = L[ys, xs]
    cy = float((ys * w).sum() / w.sum()); cx = float((xs * w).sum() / w.sum())
    u = (cx + 0.5) / W; v = 1 - (cy + 0.5) / H
    lat = (v - 0.5) * math.pi; lon = (u - 0.5) * 2 * math.pi
    d = [math.cos(lat) * math.cos(lon), math.sin(lat), math.cos(lat) * math.sin(lon)]   # three.js equirectangular lookup
    return W, H, dict(peak=round(float(hdr.max()), 1), mean=round(float(L.mean()), 3),
                      sunDir=[round(x, 4) for x in d], sunElevation=round(math.degrees(lat), 1))

# ---------------------------------------------------------------- docs/ASSET-CREDITS.md (written from the manifest)
def write_credits(manifest, path):
    F = manifest['files']
    kb = lambda n: f'{n / 1000:.0f} KB'
    def by(prefix):
        return [e for e in F if e['name'].startswith(prefix)]
    L = []
    L.append('# 사용한 자료 — 출처와 라이선스 (ASSET CREDITS)')
    L.append('')
    L.append('> 이 문서는 `assets/pack/src/make_pack.py --credits` 가 `assets/pack/MANIFEST.json` 에서 만든다. 표를 고치려면 스크립트나 매니페스트를 고치고 다시 만든다.')
    L.append('')
    L.append(f"체험관 화면에 들어가는 사진 재질·옛 그림·하늘 사진은 모두 **{len(F)}개 파일, {manifest['bytes'] / 1e6:.2f} MB** 이고, 한 개의 HTML 파일 안에 함께 담긴다 (CONTRACT §16.1). "
             '실행 중에 다른 사이트에서 불러오는 것은 하나도 없다.')
    L.append('')
    L.append('쉬운 말 풀이')
    L.append('')
    L.append('- **CC0 / 퍼블릭 도메인**: 만든 사람이 권리를 모두 내려놓았거나 보호 기간이 끝나서, 누구나 허락 없이 자유롭게 쓸 수 있다는 뜻이다. 출처를 적을 의무는 없지만 이 문서에 모두 적어 둔다.')
    L.append('- **재질 세트(PBR)**: 벽·나무·흙이 빛을 받았을 때 진짜처럼 보이게 하는 그림 세 장 — 색(c), 굴곡(n, 노멀), 거칠기(r).')
    L.append('- **매니페스트**: 들어 있는 파일의 목록표. 파일마다 이름·크기·지문(sha256)·출처·라이선스가 적혀 있다.')
    L.append('')
    L.append('## 1. 새 자료를 넣을 때 지킬 규칙')
    L.append('')
    L.append('1. **CC0 또는 퍼블릭 도메인만** 넣는다. "비상업적 이용만", "출처 표시 필수(CC BY)" 같은 조건이 붙은 자료, 라이선스를 확인할 수 없는 자료는 넣지 않는다.')
    L.append('2. 파일마다 **출처 주소, 라이선스, 근거(라이선스를 확인한 문장이나 공식 목록)** 를 `assets/pack/MANIFEST.json` 에 적는다. 이 문서의 표는 거기서 만들어진다.')
    L.append('3. **매니페스트에 없는 그림 파일이 `assets/pack/` 에 있으면 빌드가 멈춘다.** 지문(sha256)이 다르거나 전체가 3.0 MB 를 넘어도 멈춘다 (`tools/build.mjs`).')
    L.append('4. 실행 중에 바깥 주소를 불러오지 않는다 (핫링크 금지). 모든 자료는 HTML 안에 담는다.')
    L.append('5. 구하지 못한 이름 있는 작품을 **만들어 낸(생성) 그림으로 대신하지 않는다.** 없으면 없다고 적는다 (아래 6번).')
    L.append('6. 그림(문화재)은 사진 배경과 색상표만 잘라 내고, **작품 자체는 고치지 않는다.**')
    L.append('')
    L.append('다시 만드는 방법 (원본은 저장소에 넣지 않는다 — 아래 표의 출처에서 받는다)')
    L.append('')
    L.append('```')
    L.append('python3 -I assets/pack/src/make_pack.py --acg <ambientCG 1K JPG 폴더> --met <The Met 원본 폴더> --raw <하늘 PNG·블루 노이즈 폴더> --out assets/pack --credits docs/ASSET-CREDITS.md')
    L.append('```')
    L.append('')
    L.append('- ambientCG 원본 이름: `<자료 ID>_1K_Color.jpg`, `_NormalGL.jpg`, `_Roughness.jpg` (나뭇잎 카드는 `_Opacity.jpg` 도) — https://ambientcg.com/a/<자료 ID> 의 1K-JPG 묶음.')
    L.append('- The Met 원본: `https://storage.googleapis.com/gcs-public-data--met/<objectID>/0.jpg` 를 `met_<objectID>_0_….jpg` 로 저장.')
    L.append('')
    L.append('## 2. 재질 세트 — ambientCG (CC0 1.0)')
    L.append('')
    L.append('근거: "All ambientCG assets are provided under the Creative Commons CC0 1.0 Universal License." (https://docs.ambientcg.com/license/)')
    L.append('')
    L.append('| 이름 (`mat/<이름>/c·n·r`) | 쓰임 | 출처 | 라이선스 | 근거 | 크기 (색 / 굴곡 / 거칠기) |')
    L.append('|---|---|---|---|---|---|')
    sets = []
    for e in by('mat/'):
        sname = e['name'].split('/')[1]
        if sname not in sets:
            sets.append(sname)
    for sname in sets:
        c = next(e for e in F if e['name'] == f'mat/{sname}/c'); n = next(e for e in F if e['name'] == f'mat/{sname}/n'); r = next(e for e in F if e['name'] == f'mat/{sname}/r')
        label = c['title'].split(' — ')[0]
        aid = c['source'].rsplit('/', 1)[1]
        ev = 'ambientCG 라이선스 문서 (위)'
        if sname == 'giwa_roof_tile':
            ev += ' · 골기와의 둥근 골과 겹침은 사진이 아니라 `make_pack.py` 가 계산해 만든 무늬'
        L.append(f"| `{sname}` — {label} | {c.get('use', '')} | [{aid}]({c['source']}) | CC0 1.0 | {ev} | {c['w']}px {kb(c['bytes'])} / {n['w']}px {kb(n['bytes'])} / {r['w']}px {kb(r['bytes'])} |")
    L.append('')
    L.append('가공: 1K 원본을 줄여 WebP 로 저장했다. 굴곡(노멀) 그림은 OpenGL 방식(Y+) 그대로이고 색 변환을 거치지 않는다. 손실 압축이 두 방향 값을 뭉개지 않도록 왼쪽 절반 = X, 오른쪽 절반 = Y 인 흑백 그림으로 저장하고(`enc: "xy"`), 실행할 때 `G.pack` 이 다시 합친다.')
    L.append('')
    L.append('## 3. 옛 그림 — 메트로폴리탄 미술관 오픈 액세스 (CC0)')
    L.append('')
    L.append('근거: 미술관의 공식 공개 목록(Open Access CSV)에서 `isPublicDomain = true` 인 작품만 골랐다. 미술관 정책: "images of artworks it believes to be in the public domain … unrestricted use … Creative Commons Zero (CC0)" (https://www.metmuseum.org/policies/image-resources).')
    L.append('')
    L.append('| 이름 (`art/<이름>`) | 작품 (원제) | 작가 · 시대 | 쓰임 | 출처 | 라이선스 | 근거 | 크기 |')
    L.append('|---|---|---|---|---|---|---|---|')
    for e in by('art/'):
        when = ', '.join(x for x in (e.get('period'), e.get('date')) if x)
        L.append(f"| `{e['name'].split('/')[1]}` | {e.get('titleKo', '')} ({e['title']}) | {e.get('artist', '')} · {e.get('culture', '')}, {when} · {e.get('medium', '')} | 한옥 안 병풍·족자·전시판 | [The Met {e['source'].rsplit('/', 1)[1]}]({e['source']}) | CC0 (The Met Open Access) | 공식 목록 isPublicDomain = true | {e['w']}×{e['h']} {kb(e['bytes'])} |")
    L.append('')
    L.append('- 작가 표기는 미술관 기록 그대로다: "Unidentified artist" = 작가 미상, "Attributed to" = ~의 작품으로 전함, "In the style of" = ~의 화풍. 호랑이 그림은 미술관이 "한국 또는 일본"으로 적고 있다.')
    L.append('- 한글 제목은 뜻을 풀어 쓴 것이고 공식 명칭이 아니다.')
    L.append('- 가공: 촬영 배경(검은 바탕)과 색상표를 잘라 내고 크기를 줄였다 (자른 범위는 매니페스트의 `crop`). 작품의 색과 모양은 손대지 않았다.')
    L.append('')
    L.append('## 4. 하늘 사진(HDRI) — Poly Haven (CC0)')
    L.append('')
    L.append('| 이름 | 쓰임 | 출처 | 라이선스 | 근거 | 크기 |')
    L.append('|---|---|---|---|---|---|')
    for e in by('sky/'):
        L.append(f"| `{e['name']}` — {e['title']} | 하늘 빛과 구름 (주변 반사) | [{e['source'].rsplit('/', 1)[1]}]({e['source']}) | CC0 1.0 | \"Our assets are all licensed as CC0\" (https://polyhaven.com/license) | {e['w']}×{e['h']} {kb(e['bytes'])} |")
    L.append('')
    L.append('가공: 밝기 범위가 넓은 사진(HDR)을 512×256 으로 줄이고, 왼쪽 절반에 색 값·오른쪽 절반에 밝기 지수를 넣어 무손실 WebP 로 저장했다 (`enc: "rgbe-split"`). 해의 방향(`sunDir`)과 가장 밝은 값(`peak`)도 매니페스트에 있다.')
    L.append('')
    L.append('## 5. 나뭇잎 카드 · 노이즈')
    L.append('')
    L.append('| 이름 | 쓰임 | 출처 | 라이선스 | 근거 | 크기 |')
    L.append('|---|---|---|---|---|---|')
    for e in by('alpha/'):
        L.append(f"| `{e['name']}` — {e['title']} | 나무·풀의 잎 | [{e['source'].rsplit('/', 1)[1]}]({e['source']}) | CC0 1.0 | ambientCG 라이선스 문서 (2번) | {e['w']}×{e['h']} {kb(e['bytes'])} |")
    for e in by('noise/'):
        L.append(f"| `{e['name']}` — {e['title']} | 그림자·안개를 부드럽게 흩뜨리는 무늬 | [free-blue-noise-textures]({e['source']}) | CC0 1.0 | README: \"Copyright 2016-2017 Christoph Peters. Licensed under CC0 1.0 Universal\" | {e['w']}×{e['h']} {kb(e['bytes'])} |")
    L.append('')
    L.append('가공(나뭇잎): 색 그림과 투명도 그림을 한 장(RGBA)으로 합치고, 잎 가장자리에 사진 바탕색(검정·크림색)이 묻어나지 않도록 잎 색을 투명한 곳까지 번지게 했다.')
    L.append('')
    L.append('## 6. 구하지 못한 것 (대신 만든 그림은 없다)')
    L.append('')
    L.append('- 김홍도·신윤복의 풍속화, 일월오봉도, 까치호랑이(작호도): 소장 기관 사이트(국립중앙박물관, 공유마당 등)에 이 작업 환경에서 접속할 수 없어 받지 못했다. **생성한 그림으로 대신하지 않았다.** 넣으려면 운영자가 공공누리 제1유형 또는 퍼블릭 도메인 파일을 직접 구해 위 규칙대로 등록한다.')
    L.append('- 한국 전통 기물의 CC0 3D 모형: 찾지 못했다. 건물·항아리·소품의 모양은 모두 코드로 만든다.')
    L.append('- 글꼴 Pretendard (SIL Open Font License 1.1) 와 three.js (MIT) 는 이 묶음이 아니라 빌드가 따로 담는다 (README 참고).')
    L.append('')
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(L))

# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--acg', required=True); ap.add_argument('--met', required=True); ap.add_argument('--raw', required=True)
    ap.add_argument('--out', required=True); ap.add_argument('--dry', action='store_true')
    ap.add_argument('--art-budget', type=int, default=0, help='total bytes for the 12 artworks (0 = the built-in split)')
    ap.add_argument('--credits', default='', help='also write the Korean credits document (docs/ASSET-CREDITS.md)')
    a = ap.parse_args()
    acg = Acg([d for d in a.acg.split(',') if d])
    files = []          # manifest entries
    blobs = {}          # file name -> bytes

    def add(name, file, kind, w, h, data, license_, source, title, credit, **extra):
        e = dict(name=name, file=file, kind=kind, w=int(w), h=int(h), bytes=len(data), sha256=hashlib.sha256(data).hexdigest(),
                 license=license_, source=source, title=title, credit=credit)
        e.update({k: v for k, v in extra.items() if v is not None})
        files.append(e); blobs[file] = data

    # ---- PBR sets
    for set_, aid, cpx, ccap, npx, ncap, ko, use in [GIWA] + SETS:
        src = f'https://ambientcg.com/a/{aid}'
        credit = f'ambientCG — {aid} (CC0 1.0)'
        if set_ == 'giwa_roof_tile':
            cimg, nvec, rimg = make_giwa(acg)
            credit = 'ambientCG — RoofingTiles013A (CC0 1.0): 구운 흙 표면 사진 · 골기와 굴곡은 이 프로젝트가 직접 만든 절차적 무늬 (assets/pack/src/make_pack.py)'
        else:
            cimg, nvec, rimg = acg.colour(aid, cpx), acg.normal(aid, npx), acg.rough(aid, ROUGH_PX)
        cb, cq, crm, cstd = encode_colour(cimg, ccap * 1000)
        nb, nq, nerr, relief = encode_normal(nvec, ncap * 1000)
        rb, rq = encode_grey(rimg, ROUGH_Q, ROUGH_CAP * 1000)
        ravg = int(round(float(np.asarray(rimg, dtype=np.float32).mean())))
        add(f'mat/{set_}/c', f'mat_{set_}_c.webp', 'color', cimg.width, cimg.height, cb, 'CC0-1.0', src, f'{ko} — 색', credit, avg=avg_srgb(cimg), use=use, evidence=ACG_EVIDENCE, q=cq)
        add(f'mat/{set_}/n', f'mat_{set_}_n.webp', 'normal', nvec.shape[1], nvec.shape[0], nb, 'CC0-1.0', src, f'{ko} — 굴곡(노멀)', credit, enc='xy', use=use, q=nq, err=round(nerr, 2))
        add(f'mat/{set_}/r', f'mat_{set_}_r.webp', 'rough', rimg.width, rimg.height, rb, 'CC0-1.0', src, f'{ko} — 거칠기', credit, avg=ravg, use=use, q=rq)
        print(f'{set_:22s} c {cimg.width}x{cimg.height} q{cq} {len(cb):6d} (rmse {crm:.2f}/std {cstd:.1f}) | n {nvec.shape[1]} q{nq} {len(nb):6d} ({nerr:.2f}°/relief {relief:.1f}°) | r q{rq} {len(rb):5d} avg {ravg}', flush=True)

    # ---- artworks
    split = {'chaekgeori_screen': 170, 'birds_flowers_screen': 215, 'still_life_screen': 130, 'rooster_hen_minhwa': 62, 'tiger_scroll': 48,
             'dragon_carp_minhwa': 78, 'deer_pines': 56, 'wild_geese_landscape': 40, 'plum_branch': 44, 'bamboo_wind': 46,
             'portrait_yun_dongseom': 62, 'officials_gathering': 52}
    scale = (a.art_budget / (sum(split.values()) * 1000.0)) if a.art_budget else 1.0
    for aid, oid, prefix, box, long_side, ko in ART:
        im = Image.open(find_one(a.met, prefix)).convert('RGB')
        if box:
            im = im.crop(box)
        w, h = im.size
        k = long_side / max(w, h)
        W, H = int(round(w * k)), int(round(h * k))
        img = Image.fromarray(to_u8(l2s(resize_f(s2l(np.asarray(im)), W, H))), 'RGB')
        b, q = encode_art(img, int(split[aid] * 1000 * scale))
        m = MET[oid]
        when = ', '.join(x for x in (m['period'], m['date']) if x)
        credit = f"{m['artist']} · {m['culture']}, {when} · {m['medium']} · The Metropolitan Museum of Art, Open Access (CC0) · accession {m['accession']}"
        add(f'art/{aid}', f'art_{aid}.webp', 'art', W, H, b, 'CC0 (The Met Open Access)', f'https://www.metmuseum.org/art/collection/search/{oid}',
            m['title'], credit, titleKo=ko, artist=m['artist'], date=m['date'], culture=m['culture'], period=m['period'] or None, medium=m['medium'],
            image=f'https://storage.googleapis.com/gcs-public-data--met/{oid}/0.jpg', crop=list(box) if box else None, evidence=MET_EVIDENCE, q=q)
        print(f'art/{aid:24s} {W}x{H} q{q} {len(b):6d}', flush=True)

    # ---- sky (kept bit-identical; lossless WebP container)
    for sid, ph, ko in (('clear_noon', 'kloofendal_48d_partly_cloudy_puresky', '맑은 낮 하늘 (구름 조금)'), ('overcast', 'kloofendal_overcast_puresky', '흐린 하늘')):
        src_png = os.path.join(a.raw, f'hdri_sky_{sid}_512x256_rgbE.png')
        if not os.path.exists(src_png):
            src_png = os.path.join(a.out, f'sky_{sid}.webp')      # the pack's own lossless copy holds the same pixels
        im = Image.open(src_png).convert('RGB')
        b = webp_bytes(im, 100, lossless=True)
        back = np.asarray(Image.open(io.BytesIO(b)).convert('RGB'))
        assert np.array_equal(back, np.asarray(im)), 'lossless WebP is not bit-identical'
        W, H, st = sky_stats(im)
        add(f'sky/{sid}', f'sky_{sid}.webp', 'sky', W, H, b, 'CC0-1.0', f'https://polyhaven.com/a/{ph}', ko, f'Poly Haven — {ph} (CC0)',
            enc='rgbe-split', alias=[f'sky/sky_{sid}'], evidence='"Our assets are all licensed as CC0" (polyhaven.com/license); open-hdri-1k train.csv lists the asset as CC0-1.0',
            note='left half = RGB mantissa, right half = exponent + 128 (grey); value = (rgb + 0.5) / 256 * 2^(E - 128); lossless', **st)
        print(f'sky/{sid:12s} {W}x{H} {len(b):6d} {st}', flush=True)

    # ---- foliage alpha cards (colour + opacity, edges bled) and blue noise
    for cid, aid, ko in (('pine_branch', 'LeafSet019', '침엽수 가지'), ('pine_needle', 'PineNeedles001', '솔잎'), ('maple_leaf', 'LeafSet027', '단풍잎'),
                         ('oak_leaf', 'LeafSet016', '참나무 잎'), ('zelkova_leaf', 'LeafSet005', '느티나무 잎 (톱니 잎과 잔가지)'), ('grass_blade', 'Foliage006', '풀잎')):
        fn = f'alpha_{cid}_cards.webp'
        im = alpha_card(acg, aid, 512)
        data = webp_rgba(im, 80)
        add(f'alpha/{cid}', fn, 'alpha', im.width, im.height, data, 'CC0-1.0', f'https://ambientcg.com/a/{aid}', f'{ko} 카드 (색 + 투명도)', f'ambientCG — {aid} (CC0 1.0)',
            alias=[f'alpha/{cid}_cards'], evidence=ACG_EVIDENCE)
        print(f'alpha/{cid:12s} {im.width}x{im.height} {len(data):6d}', flush=True)
    noise_src = os.path.join(a.raw, 'bluenoise_64_rgba.png')
    data = open(noise_src if os.path.exists(noise_src) else os.path.join(a.out, 'bluenoise_64_rgba.png'), 'rb').read()
    add('noise/blue64', 'bluenoise_64_rgba.png', 'noise', 64, 64, data, 'CC0-1.0', 'https://github.com/Calinou/free-blue-noise-textures',
        '블루 노이즈 64×64', 'Christoph Peters — free blue noise textures (CC0 1.0)', evidence='README: "Copyright 2016-2017 Christoph Peters. Licensed under CC0 1.0 Universal"',
        image='https://raw.githubusercontent.com/Calinou/free-blue-noise-textures/master/64_64/LDR_RGBA_0.png')

    total = sum(e['bytes'] for e in files)
    by = {}
    for e in files:
        by[e['kind']] = by.get(e['kind'], 0) + e['bytes']
    print('TOTAL', total, 'bytes in', len(files), 'files', by)
    if a.dry:
        return
    os.makedirs(a.out, exist_ok=True)
    for fn, data in blobs.items():
        with open(os.path.join(a.out, fn), 'wb') as f:
            f.write(data)
    manifest = dict(version=1, generator='assets/pack/src/make_pack.py', bytes=total, files=files)
    with open(os.path.join(a.out, 'MANIFEST.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print('wrote', len(blobs), 'files +', os.path.join(a.out, 'MANIFEST.json'))
    if a.credits:
        write_credits(manifest, a.credits)
        print('wrote', a.credits)

if __name__ == '__main__':
    main()

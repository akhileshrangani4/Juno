#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10", "numpy>=1.26"]
# ///
"""Generates every app icon and launch-screen image from the two logo masters in assets/logo.

Masters (made with an image model, kept unedited):
  juno-icon-1024.png              full-bleed square icon on navy, RGB
  juno-mark-transparent-1024.png  the chick and bars alone on transparency, RGBA

Fixes applied to the masters before anything is derived from them:
  icon  The model's navy is close to #0F1B3D but not exact, with a little noise and a
        slightly lighter bottom edge. Background pixels near the measured navy are set to
        exactly #0F1B3D and edge pixels between background and artwork are shifted by the
        same amount, so the icon, Android background and launch screen are one colour.
        Metadata is dropped and the result is saved without an alpha channel.
  mark  Near-zero alpha is cleared, near-opaque alpha (250-254 noise inside the shapes)
        becomes fully opaque, and semi-transparent edge pixels take their colour from the
        nearest opaque pixels so no light or dark fringe shows on navy. The dark outline,
        eyes and beak are painted exactly #0F1B3D, so on the navy launch screen the outline
        merges into the background the way the gap does in the icon.

Outputs (assets/images):
  icon.png                     1024 icon for iOS and the default app icon
  splash-icon.png              the mark trimmed and centred on a square, for the launch screen
  android-icon-foreground.png  the mark inside the 66% safe zone of a transparent 1024 canvas
  android-icon-monochrome.png  the same placement in one colour, with the navy outline,
                               eyes and beak cut out so the chick still reads
  favicon.png                  48x48 web favicon from the icon

Run: uv run scripts/generate-icons.py   (or python3 with pillow and numpy installed)
"""
from pathlib import Path

import numpy as np
from PIL import Image

NAVY = np.array([0x0F, 0x1B, 0x3D])
ROOT = Path(__file__).resolve().parent.parent
MASTERS = ROOT / "assets" / "logo"
OUT = ROOT / "assets" / "images"

SNAP = 12
BLEND = 48
ALPHA_FLOOR = 8
ALPHA_CEIL = 248
SAFE_ZONE = 0.66
INK_LOW = 70
INK_HIGH = 120


def clean_icon(path):
    image = Image.open(path)
    if image.size != (1024, 1024):
        raise SystemExit(f"{path.name} must be 1024x1024, got {image.size}")
    rgb = np.asarray(image.convert("RGB")).astype(float)
    band = np.concatenate([rgb[:16].reshape(-1, 3), rgb[-16:].reshape(-1, 3),
                           rgb[:, :16].reshape(-1, 3), rgb[:, -16:].reshape(-1, 3)])
    measured = np.median(band, axis=0)
    deviation = np.abs(rgb - measured).max(axis=2)
    weight = np.clip((BLEND - deviation) / (BLEND - SNAP), 0, 1)[..., None]
    rgb = rgb + (NAVY - measured) * weight
    rgb[deviation <= SNAP] = NAVY
    print(f"icon: measured navy #{''.join(f'{round(c):02X}' for c in measured)}, "
          f"set {int((deviation <= SNAP).sum())} pixels to #0F1B3D")
    return Image.fromarray(np.clip(np.rint(rgb), 0, 255).astype(np.uint8), "RGB")


def ink_weight(rgb):
    return np.clip((INK_HIGH - rgb.max(axis=2)) / (INK_HIGH - INK_LOW), 0, 1)


def bleed(rgb, known, steps=12):
    rgb = rgb * known[..., None]
    known = known.astype(float)
    for _ in range(steps):
        total = np.zeros_like(rgb)
        count = np.zeros(known.shape)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                total += np.roll(rgb, (dy, dx), axis=(0, 1))
                count += np.roll(known, (dy, dx), axis=(0, 1))
        fill = (known == 0) & (count > 0)
        rgb[fill] = total[fill] / count[fill][:, None]
        known[fill] = 1
    return rgb


def clean_mark(path):
    image = Image.open(path)
    if image.size != (1024, 1024) or image.mode != "RGBA":
        raise SystemExit(f"{path.name} must be a 1024x1024 RGBA image, got {image.size} {image.mode}")
    pixels = np.asarray(image).astype(float)
    alpha = pixels[..., 3]
    alpha[alpha <= ALPHA_FLOOR] = 0
    alpha[alpha >= ALPHA_CEIL] = 255
    rgb = bleed(pixels[..., :3], alpha == 255)
    ink = ink_weight(rgb)[..., None]
    rgb = rgb * (1 - ink) + NAVY * ink
    rgb[alpha == 0] = 0
    mark = Image.fromarray(np.dstack([rgb, alpha]).round().astype(np.uint8), "RGBA")
    return mark.crop(mark.getbbox())


def on_canvas(mark, size, fraction):
    scale = size * fraction / max(mark.size)
    scaled = mark.resize((round(mark.width * scale), round(mark.height * scale)), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(scaled, ((size - scaled.width) // 2, (size - scaled.height) // 2))
    return canvas


def monochrome(mark):
    pixels = np.asarray(mark).astype(float)
    alpha = pixels[..., 3] * (1 - ink_weight(pixels[..., :3]))
    white = np.full(alpha.shape + (3,), 255.0)
    return Image.fromarray(np.dstack([white, alpha]).round().astype(np.uint8), "RGBA")


def main():
    icon = clean_icon(MASTERS / "juno-icon-1024.png")
    mark = clean_mark(MASTERS / "juno-mark-transparent-1024.png")
    OUT.mkdir(parents=True, exist_ok=True)
    icon.save(OUT / "icon.png", optimize=True)
    icon.resize((48, 48), Image.LANCZOS).save(OUT / "favicon.png", optimize=True)
    side = max(mark.size) + 32
    on_canvas(mark, side, max(mark.size) / side).save(OUT / "splash-icon.png", optimize=True)
    foreground = on_canvas(mark, 1024, SAFE_ZONE)
    foreground.save(OUT / "android-icon-foreground.png", optimize=True)
    monochrome(foreground).save(OUT / "android-icon-monochrome.png", optimize=True)
    for name in ["icon.png", "favicon.png", "splash-icon.png", "android-icon-foreground.png",
                 "android-icon-monochrome.png"]:
        image = Image.open(OUT / name)
        print(f"{name}: {image.size[0]}x{image.size[1]} {image.mode}")


if __name__ == "__main__":
    main()

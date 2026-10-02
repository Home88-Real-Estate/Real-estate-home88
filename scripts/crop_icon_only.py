#!/usr/bin/env python3
"""Crop the "Γιατί HOME88" feature images down to the 3D icon only.

The source PNGs are laid out as: 3D icon (top) -> baked-in title ->
baked-in description. The website already renders the title and the
description as HTML, so this script keeps only the icon and writes the
result to a separate output folder; the originals are never touched.

How the crop line is chosen (first match wins):
  1. CROP_BOTTOM_PX[filename]  - explicit per-file override, in pixels.
  2. Auto-detect               - scan the alpha channel from the top, take the
                                 first block of content (the icon and its soft
                                 shadow) and cut just below it, inside the
                                 transparent gap that separates it from the title.
  3. --crop-percent            - fallback for images without a clear gap
                                 (e.g. no transparency): cut that share off the bottom.

A fixed percentage is deliberately not the default: the icons end at
different heights, and a flat 45% cut clips the bottom of some of them.

Usage (from the repo root):
    pip install pillow
    python3 scripts/crop_icon_only.py
    python3 scripts/crop_icon_only.py --preview /tmp/why-icons-preview.png
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, UnidentifiedImageError

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = REPO_ROOT / "apps/web/public/images/why"
DEFAULT_OUTPUT = REPO_ROOT / "apps/web/public/images/why-icons"

SUPPORTED = {".png", ".jpg", ".jpeg", ".webp"}

# Alpha at or above this counts as visible content. Lower values are only the
# faint anti-aliasing halo around the artwork.
ALPHA_THRESHOLD = 8
# A transparent run at least this tall separates the icon from the title.
MIN_GAP_PX = 15
# Transparent space kept below the icon's shadow (never more than half the gap).
BOTTOM_MARGIN_PX = 12

# Optional explicit crop lines (new bottom edge in px). Empty by default:
# auto-detection handles the current assets.
CROP_BOTTOM_PX: dict[str, int] = {}


def detect_icon_bottom(img: Image.Image) -> int | None:
    """Return the crop line just below the first content block, or None."""
    if "A" not in img.getbands():
        return None
    alpha = img.getchannel("A")
    width, height = img.size
    # Max alpha of each row: crop to one row and read its extrema.
    row_max = [alpha.crop((0, y, width, y + 1)).getextrema()[1] for y in range(height)]

    y = 0
    while y < height and row_max[y] < ALPHA_THRESHOLD:  # leading transparency
        y += 1
    while y < height:
        while y < height and row_max[y] >= ALPHA_THRESHOLD:  # content block
            y += 1
        icon_end = y
        while y < height and row_max[y] < ALPHA_THRESHOLD:  # transparent gap
            y += 1
        gap = y - icon_end
        if gap >= MIN_GAP_PX:
            return icon_end + min(BOTTOM_MARGIN_PX, gap // 2)
        if y >= height:
            return None
    return None


def has_content_at(img: Image.Image, line: int) -> bool:
    """True if the rows around the crop line contain visible pixels.

    Sanity check: a correct cut runs through the transparent gap, so a hit
    here means the line went through artwork or text instead.
    """
    if "A" not in img.getbands():
        return False
    alpha = img.getchannel("A")
    band = alpha.crop((0, max(line - 1, 0), img.width, min(line + 2, img.height)))
    return band.getextrema()[1] >= ALPHA_THRESHOLD


def crop_icon_only(
    input_folder: Path,
    output_folder: Path,
    crop_percent: float = 0.45,
) -> list[tuple[Path, Path]]:
    """Crop every supported image in input_folder into output_folder."""
    if input_folder.resolve() == output_folder.resolve():
        raise ValueError("Output folder must differ from the input folder.")
    output_folder.mkdir(parents=True, exist_ok=True)

    written: list[tuple[Path, Path]] = []
    for src in sorted(input_folder.iterdir()):
        if not src.is_file() or src.suffix.lower() not in SUPPORTED:
            print(f"skip     {src.name} (unsupported)")
            continue
        try:
            with Image.open(src) as img:
                img.load()
                width, height = img.size

                if src.name in CROP_BOTTOM_PX:
                    bottom, how = CROP_BOTTOM_PX[src.name], "per-file"
                elif (bottom := detect_icon_bottom(img)) is not None:
                    how = "auto"
                else:
                    bottom, how = int(height * (1 - crop_percent)), "percent"

                if not 0 < bottom <= height:
                    print(f"error    {src.name}: crop line {bottom} outside 1..{height}")
                    continue
                if has_content_at(img, bottom):
                    print(f"warning  {src.name}: crop line {bottom} cuts through visible content")

                cropped = img.crop((0, 0, width, bottom))
                dst = output_folder / src.name
                ext = dst.suffix.lower()
                if ext == ".png":
                    cropped.save(dst, optimize=True)
                elif ext == ".webp":
                    cropped.save(dst, lossless=True)
                else:
                    cropped.save(dst, quality=95)
                mode = cropped.mode
        except (UnidentifiedImageError, OSError) as exc:
            print(f"error    {src.name}: {exc}")
            continue

        # Re-open the written file and confirm geometry and alpha survived.
        with Image.open(dst) as check:
            check.load()
            assert check.size == (width, bottom), f"{dst.name}: unexpected size {check.size}"
            assert check.mode == mode, f"{dst.name}: mode changed {mode} -> {check.mode}"
        removed = 1 - bottom / height
        print(
            f"cropped  {src.name}: {width}x{height} -> {width}x{bottom} "
            f"(removed {removed:.0%} from bottom, {how}, {mode})"
        )
        written.append((src, dst))
    return written


def save_preview(pairs: list[tuple[Path, Path]], preview_path: Path) -> None:
    """Write an ORIGINAL (top row) vs CROPPED (bottom row) contact sheet."""
    originals = [Image.open(s) for s, _ in pairs]
    crops = [Image.open(d) for _, d in pairs]
    col_w = max(im.width for im in originals) + 20
    row_h = max(im.height for im in originals) + 20
    sheet = Image.new("RGB", (col_w * len(pairs), row_h * 2), "white")
    for i, (orig, crop) in enumerate(zip(originals, crops)):
        sheet.paste(orig, (i * col_w + 10, 10), orig if orig.mode == "RGBA" else None)
        sheet.paste(crop, (i * col_w + 10, row_h + 10), crop if crop.mode == "RGBA" else None)
    preview_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(preview_path)
    for im in originals + crops:
        im.close()
    print(f"preview  {preview_path}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--crop-percent",
        type=float,
        default=0.45,
        help="Fallback share of the height to cut from the bottom when no icon gap is detected.",
    )
    parser.add_argument("--preview", type=Path, help="Optional path for a before/after contact sheet.")
    args = parser.parse_args()

    if not args.input.is_dir():
        print(f"Input folder not found: {args.input}", file=sys.stderr)
        return 1
    pairs = crop_icon_only(args.input, args.output, args.crop_percent)
    if args.preview and pairs:
        save_preview(pairs, args.preview)
    return 0 if pairs else 1


if __name__ == "__main__":
    sys.exit(main())

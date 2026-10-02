#!/usr/bin/env python3
"""Crop the baked-in description text off the "Γιατί HOME88" feature images.

The source PNGs are laid out as: 3D graphic (top) -> title (middle) ->
description (bottom). This script keeps the graphic and the title and drops
the description, writing the results to a separate output folder so the
originals are never touched.

Each source image places its text at a slightly different height, so the
crop line is configured per file (CROP_BOTTOM_PX). Files not listed there
fall back to --crop-percent.

Usage (from the repo root):
    pip install pillow
    python3 scripts/crop_feature_images.py
    python3 scripts/crop_feature_images.py --preview /tmp/why-preview.png
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, UnidentifiedImageError

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = REPO_ROOT / "apps/web/public/images/why"
DEFAULT_OUTPUT = REPO_ROOT / "apps/web/public/images/why-clean"

SUPPORTED = {".png", ".jpg", ".jpeg"}

# New bottom edge (in px) for each source file: the bottom of the title plus
# 16px of breathing room, measured from the actual assets. The description
# block starts below each of these values.
#   file                              title ends  description starts
#   01_topiki_lysi.png                442         494
#   02_epaggelmatiki_parousiasi.png   488         519
#   03_prosopiki_exypiretisi.png      452         482
#   04_diktyo_synergias.png           474         503
CROP_BOTTOM_PX: dict[str, int] = {
    "01_topiki_lysi.png": 458,
    "02_epaggelmatiki_parousiasi.png": 504,
    "03_prosopiki_exypiretisi.png": 468,
    "04_diktyo_synergias.png": 490,
}


def crop_bottom_text(
    input_folder: Path,
    output_folder: Path,
    crop_percent: float = 0.20,
) -> list[tuple[Path, Path]]:
    """Crop every supported image in input_folder into output_folder.

    Returns the (source, output) pairs that were written.
    """
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
                bottom = CROP_BOTTOM_PX.get(src.name)
                if bottom is None:
                    bottom = int(height * (1 - crop_percent))
                    how = f"bottom {crop_percent:.0%}"
                else:
                    how = f"per-file {bottom}px"
                if not 0 < bottom <= height:
                    print(f"error    {src.name}: crop line {bottom} outside 1..{height}")
                    continue

                cropped = img.crop((0, 0, width, bottom))
                dst = output_folder / src.name
                save_kwargs = {"optimize": True} if dst.suffix.lower() == ".png" else {"quality": 95}
                cropped.save(dst, **save_kwargs)
        except (UnidentifiedImageError, OSError) as exc:
            print(f"error    {src.name}: {exc}")
            continue

        # Verify the written file actually opens with the expected geometry.
        with Image.open(dst) as check:
            check.load()
            assert check.size == (width, bottom), f"{dst.name}: unexpected size {check.size}"
            assert check.mode == cropped.mode, f"{dst.name}: mode changed to {check.mode}"
        print(f"cropped  {src.name}: {width}x{height} -> {width}x{bottom} ({how}, {cropped.mode})")
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
        default=0.20,
        help="Fallback share of the height to cut from the bottom for files not in CROP_BOTTOM_PX.",
    )
    parser.add_argument("--preview", type=Path, help="Optional path for a before/after contact sheet.")
    args = parser.parse_args()

    if not args.input.is_dir():
        print(f"Input folder not found: {args.input}", file=sys.stderr)
        return 1
    pairs = crop_bottom_text(args.input, args.output, args.crop_percent)
    if args.preview and pairs:
        save_preview(pairs, args.preview)
    return 0 if pairs else 1


if __name__ == "__main__":
    sys.exit(main())

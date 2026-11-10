#!/usr/bin/env python3
"""Rebuild the bundled font subsets (V3-C).

Dependencies are intentionally NOT part of the project; install in a temporary
venv (fonttools[woff] + brotli):

    python3 -m venv /tmp/fontvenv
    /tmp/fontvenv/bin/pip install "fonttools[woff]" brotli
    /tmp/fontvenv/bin/python scripts/build-font-subset.py \
        --source NotoSansSC-VF.ttf --chars public/fonts/subset-chars.txt \
        --out public/fonts/NotoSansSC-Cunlian-subset.woff2 \
        --instance wght=400 --family "Noto Sans SC Cunlian" \
        --postscript NotoSansSC-Cunlian

    /tmp/fontvenv/bin/python scripts/build-font-subset.py \
        --source NotoSansMath-Regular.ttf --text "⌀±·×°" \
        --out public/fonts/NotoSansMath-Cunlian-symbols.woff2

Then update public/fonts/SOURCE.md and re-verify the actual exported PDF.
"""
import argparse
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--chars")
    parser.add_argument("--text")
    parser.add_argument("--out", required=True)
    parser.add_argument("--instance", help="e.g. wght=400")
    parser.add_argument("--family")
    parser.add_argument("--postscript")
    args = parser.parse_args()

    text = args.text
    if args.chars:
        text = Path(args.chars).read_text(encoding="utf-8")
    if not text:
        raise SystemExit("需要 --chars 或 --text")
    text = "".join(dict.fromkeys(text))

    font = TTFont(args.source)
    if args.instance:
        axis, value = args.instance.split("=", 1)
        font = instantiateVariableFont(font, {axis: float(value)}, inplace=False)
    if args.family:
        rename = {1: args.family, 4: args.family, 16: args.family}
        if args.postscript:
            rename[6] = args.postscript
        for record in font["name"].names:
            if record.nameID in rename:
                record.string = rename[record.nameID].encode(
                    record.getEncoding(), errors="replace"
                )

    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    options.recalc_bounds = True
    options.drop_tables += ["FFTM"]
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(text=text)
    subsetter.subset(font)
    font.flavor = "woff2"
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    font.save(out)
    check = TTFont(out)
    print(
        f"{out}: {out.stat().st_size} bytes, {check['maxp'].numGlyphs} glyphs, "
        f"{len(text)} characters"
    )


if __name__ == "__main__":
    main()

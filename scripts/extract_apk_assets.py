#!/usr/bin/env python3
"""
Extracts authentic Warhammer Paint APK fonts (Anton & Bitter) and converts
Android VectorDrawables (ic_*.xml) into standard web SVGs, including external
<gradient> drawable references (such as the Warhammer Pro rainbow brush stroke).
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_PUBLIC_DIR = Path(
    os.environ.get("WARHAMMER_PUBLIC_DIR", str(BASE_DIR / "public"))
)
DEFAULT_JADX_RES = (
    Path(os.environ["JADX_RES_DIR"])
    if os.environ.get("JADX_RES_DIR")
    else BASE_DIR / "apk_analysis" / "jadx_out" / "resources" / "res"
)

ANDROID_NS = "{http://schemas.android.com/apk/res/android}"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Extract APK fonts and convert Android VectorDrawables (ic_*.xml) "
            "into web SVGs under public/."
        )
    )
    parser.add_argument(
        "--jadx-res",
        type=Path,
        default=DEFAULT_JADX_RES,
        help=(
            "Path to decompiled jadx res/ directory "
            "(defaults to JADX_RES_DIR env var or <repo>/apk_analysis/jadx_out/resources/res)."
        ),
    )
    parser.add_argument(
        "--public-dir",
        type=Path,
        default=DEFAULT_PUBLIC_DIR,
        help=(
            "Destination Angular public/ directory "
            "(defaults to WARHAMMER_PUBLIC_DIR env var or <repo>/public)."
        ),
    )
    return parser


def argb_to_svg_color(color_str: str):
    """Converts Android #AARRGGBB or #RRGGBB hex string to (hex_rgb, opacity)."""
    if not color_str or not color_str.startswith("#"):
        return color_str, None
    h = color_str.lstrip("#")
    if len(h) == 8:
        a = int(h[0:2], 16) / 255.0
        rgb = f"#{h[2:8]}"
        return rgb, (f"{a:.3f}" if a < 0.999 else None)
    return f"#{h}", None


def parse_gradient_xml(grad_path: Path, grad_id: str) -> str:
    tree = ET.parse(grad_path)
    root = tree.getroot()
    start_x = root.attrib.get(f"{ANDROID_NS}startX", "0")
    start_y = root.attrib.get(f"{ANDROID_NS}startY", "0")
    end_x = root.attrib.get(f"{ANDROID_NS}endX", "100")
    end_y = root.attrib.get(f"{ANDROID_NS}endY", "0")

    stops = []
    for item in root.findall("item"):
        color_raw = item.attrib.get(f"{ANDROID_NS}color", "#000000")
        offset = item.attrib.get(f"{ANDROID_NS}offset", "0")
        rgb, opacity = argb_to_svg_color(color_raw)
        op_attr = f' stop-opacity="{opacity}"' if opacity else ""
        stops.append(f'      <stop offset="{offset}" stop-color="{rgb}"{op_attr}/>')

    stops_str = "\n".join(stops)
    return (
        f'    <linearGradient id="{grad_id}" gradientUnits="userSpaceOnUse" '
        f'x1="{start_x}" y1="{start_y}" x2="{end_x}" y2="{end_y}">\n'
        f"{stops_str}\n"
        f"    </linearGradient>"
    )


def convert_vector_to_svg(xml_path: Path, drawable_dir: Path) -> str:
    tree = ET.parse(xml_path)
    root = tree.getroot()
    if root.tag != "vector":
        return ""

    vw = root.attrib.get(f"{ANDROID_NS}viewportWidth", "24")
    vh = root.attrib.get(f"{ANDROID_NS}viewportHeight", "24")
    w = root.attrib.get(f"{ANDROID_NS}width", vw).replace("dp", "")
    h = root.attrib.get(f"{ANDROID_NS}height", vh).replace("dp", "")

    defs = []
    paths_svg = []
    grad_counter = 0

    def process_node(node, indent="  "):
        nonlocal grad_counter
        for child in node:
            if child.tag == "group":
                tx = child.attrib.get(f"{ANDROID_NS}translateX", "0")
                ty = child.attrib.get(f"{ANDROID_NS}translateY", "0")
                sx = child.attrib.get(f"{ANDROID_NS}scaleX", "1")
                sy = child.attrib.get(f"{ANDROID_NS}scaleY", "1")
                transforms = []
                if tx != "0" or ty != "0":
                    transforms.append(f"translate({tx}, {ty})")
                if sx != "1" or sy != "1":
                    transforms.append(f"scale({sx}, {sy})")
                t_attr = f' transform="{" ".join(transforms)}"' if transforms else ""
                paths_svg.append(f"{indent}<g{t_attr}>")
                process_node(child, indent + "  ")
                paths_svg.append(f"{indent}</g>")
            elif child.tag == "path":
                d = child.attrib.get(f"{ANDROID_NS}pathData", "")
                if not d:
                    continue
                fill_raw = child.attrib.get(f"{ANDROID_NS}fillColor", "none")
                stroke_raw = child.attrib.get(f"{ANDROID_NS}strokeColor")
                stroke_width = child.attrib.get(f"{ANDROID_NS}strokeWidth")
                fill_type = child.attrib.get(f"{ANDROID_NS}fillType")
                fill_alpha = child.attrib.get(f"{ANDROID_NS}fillAlpha")

                attrs = [f'd="{d}"']

                if fill_raw.startswith("@drawable/"):
                    ref_name = fill_raw.split("/", 1)[1]
                    ref_file = drawable_dir / f"{ref_name}.xml"
                    if ref_file.exists():
                        grad_counter += 1
                        gid = f"grad_{grad_counter}"
                        defs.append(parse_gradient_xml(ref_file, gid))
                        attrs.append(f'fill="url(#{gid})"')
                    else:
                        attrs.append('fill="currentColor"')
                else:
                    rgb, op = argb_to_svg_color(fill_raw)
                    attrs.append(f'fill="{rgb}"')
                    if op and not fill_alpha:
                        attrs.append(f'fill-opacity="{op}"')

                if fill_alpha:
                    attrs.append(f'fill-opacity="{fill_alpha}"')
                if fill_type and fill_type.lower() == "evenodd":
                    attrs.append('fill-rule="evenodd"')
                if stroke_raw:
                    s_rgb, s_op = argb_to_svg_color(stroke_raw)
                    attrs.append(f'stroke="{s_rgb}"')
                    if s_op:
                        attrs.append(f'stroke-opacity="{s_op}"')
                if stroke_width:
                    attrs.append(f'stroke-width="{stroke_width}"')

                paths_svg.append(f'{indent}<path {" ".join(attrs)}/>')

    process_node(root)

    defs_block = ""
    if defs:
        defs_block = "  <defs>\n" + "\n".join(defs) + "\n  </defs>\n"

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vw} {vh}" width="{w}" height="{h}">\n'
        f"{defs_block}"
        + "\n".join(paths_svg)
        + "\n</svg>\n"
    )


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    jadx_res: Path = args.jadx_res
    webapp_public: Path = args.public_dir

    if not jadx_res.is_dir():
        print(
            f"ERROR: jadx res directory not found: {jadx_res}. "
            "Pass --jadx-res or set JADX_RES_DIR.",
            file=sys.stderr,
        )
        return 1

    fonts_out = webapp_public / "fonts"
    icons_out = webapp_public / "icons"
    fonts_out.mkdir(parents=True, exist_ok=True)
    icons_out.mkdir(parents=True, exist_ok=True)

    # 1. Copy APK fonts
    font_src = jadx_res / "font"
    copied_fonts = 0
    if font_src.is_dir():
        for f in sorted(font_src.glob("*.*")):
            shutil.copy2(f, fonts_out / f.name)
            copied_fonts += 1

    # 2. Convert ic_*.xml drawables to SVG
    drawable_dir = jadx_res / "drawable"
    converted_icons = 0
    if drawable_dir.is_dir():
        for xml_file in sorted(drawable_dir.glob("ic_*.xml")):
            try:
                svg_content = convert_vector_to_svg(xml_file, drawable_dir)
                if svg_content:
                    out_file = icons_out / f"{xml_file.stem}.svg"
                    out_file.write_text(svg_content, encoding="utf-8")
                    converted_icons += 1
            except Exception as e:
                print(f"Warning: skipped {xml_file.name}: {e}")

    print(
        f"[DONE] Copied {copied_fonts} APK fonts to {fonts_out} and converted "
        f"{converted_icons} APK vector icons to {icons_out}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

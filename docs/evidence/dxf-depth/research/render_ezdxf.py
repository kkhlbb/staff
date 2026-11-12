"""用 ezdxf.addons.drawing 渲染 2000 样本：模型空间 + 图纸空间（含视口）。

为什么要有这份脚本：QCAD 3.33.1 的无头渲染会重算标注、也不画 `*Paper_Space` 视口里的
模型内容（见 ../README.md §10），所以「图能看」这件事必须换一个真会画 DIMENSION 和
视口的渲染器来证明。ezdxf 的 drawing addon 就是这样一个渲染器：它按匿名块画标注几何
（`*D1/*D2/*D3`），并按 VIEWPORT 的 `10/20`（视口中心）、`40/41`（视口尺寸）、
`12/22`（视图中心）、`45`（模型视高）把模型内容变换、裁剪进视口。

脚本不只出图，还给出三条可核对的量化证据：
  1. 去掉 DIMENSION 再渲一次 → 像素差分 > 0 证明「标注线/箭头/数字」真的被画进位图；
  2. 去掉 VIEWPORT 再渲一次 → 像素差分 > 0 证明「视口里的模型内容」真的被画进位图；
  3. 在渲染图上按纸面 mm 量 `12.050` 那条尺寸线的长度：1:1 应 ≈ 12.05mm，
     1:2 应 ≈ 6.03mm（比值 2.00），证明视口比例不是写死的。

用法（在 docs/evidence/dxf-depth 目录下运行）：
    ~/DSH/.venv-dxf-render/bin/python research/render_ezdxf.py

依赖：ezdxf 1.4.2 + matplotlib（Pillow / numpy 随 matplotlib 装）。
输出：screenshots/render-*.png
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import ezdxf
import matplotlib

matplotlib.use("Agg")

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from ezdxf import bbox as ezbbox  # noqa: E402
from ezdxf.addons.drawing.config import (  # noqa: E402
    BackgroundPolicy,
    ColorPolicy,
    Configuration,
)
from ezdxf.addons.drawing.matplotlib import qsave  # noqa: E402

HERE = Path(__file__).resolve().parent          # .../dxf-depth/research
EVID = HERE.parent                              # .../dxf-depth
SHOTS = EVID / "screenshots"

# 黑白输出：像一张打印图，最利于「看得见尺寸」这件事的判读
CONFIG = Configuration(
    background_policy=BackgroundPolicy.WHITE,
    color_policy=ColorPolicy.BLACK,
    min_lineweight=0.18,
)

INK_THRESHOLD = 240            # 灰度 < 此值算「有墨」
A3_IN = (420 / 25.4, 297 / 25.4)   # 纸面 mm -> 英寸
MM_PER_PX = 25.4 / 300             # A3 @300dpi 的纸面 mm/px


def render(layout, out: Path, size_inches, dpi: int, filter_func=None) -> Path:
    qsave(layout, str(out), config=CONFIG, dpi=dpi,
          size_inches=size_inches, filter_func=filter_func)
    return out


def ink_mask(path: Path):
    arr = np.asarray(Image.open(path).convert("L"))
    return arr.shape, arr < INK_THRESHOLD


def ink_bbox(path: Path):
    shape, mask = ink_mask(path)
    count = int(mask.sum())
    if count == 0:
        return (shape[1], shape[0]), 0, None
    ys, xs = np.where(mask)
    return (shape[1], shape[0]), count, (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))


def diff(path_a: Path, path_b: Path):
    sa, ma = ink_mask(path_a)
    sb, mb = ink_mask(path_b)
    if sa != sb:
        return -1, None
    d = ma ^ mb
    count = int(d.sum())
    if count == 0:
        return 0, None
    ys, xs = np.where(d)
    return count, (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))


def px_to_paper(shape, bbox_px):
    """像素包围盒 -> 纸面 mm 包围盒（左下原点，A3；仅对 full-layout 渲染有效）。

    shape 是 ink_bbox/ink_mask 返回的 (宽, 高)。
    """
    w, h = shape
    x0, y0, x1, y1 = bbox_px
    return (x0 * MM_PER_PX, (h - y1) * MM_PER_PX, x1 * MM_PER_PX, (h - y0) * MM_PER_PX)


def row_ink_extent_mm(png: Path, paper_y_mm: float, x_lo_mm: float, x_hi_mm: float,
                      half_band_mm: float = 1.2):
    """在纸面某一行带里量最左/最右有墨位置（mm）。用于量尺寸线的纸面长度。"""
    arr = np.asarray(Image.open(png).convert("L"))
    h, w = arr.shape
    py = int(round((297 - paper_y_mm) / MM_PER_PX))
    band = slice(max(0, py - int(half_band_mm / MM_PER_PX)), min(h, py + int(half_band_mm / MM_PER_PX) + 1))
    x0 = int(round(x_lo_mm / MM_PER_PX))
    x1 = int(round(x_hi_mm / MM_PER_PX))
    sub = arr[band, x0:x1] < INK_THRESHOLD
    cols = np.where(sub.any(axis=0))[0]
    if len(cols) == 0:
        return None
    return ((x0 + cols.min()) * MM_PER_PX, (x0 + cols.max()) * MM_PER_PX)


def describe(doc, layout_name: str) -> None:
    lay = doc.layouts.get(layout_name)
    types: dict[str, int] = {}
    for e in lay:
        types[e.dxftype()] = types.get(e.dxftype(), 0) + 1
    print(f"  layout={layout_name} paperspace={lay.is_any_paperspace} entities={types}")
    for vp in lay.query("VIEWPORT"):
        print(
            "  VIEWPORT center=(%g,%g) size=%gx%g view_center=(%g,%g) view_height=%g"
            " -> 比例 1:%g" % (
                vp.dxf.center.x, vp.dxf.center.y, vp.dxf.width, vp.dxf.height,
                vp.dxf.view_center_point.x, vp.dxf.view_center_point.y,
                vp.dxf.view_height, vp.get_scale(),
            )
        )
    for d in lay.query("DIMENSION"):
        block = d.dxf.get("geometry")
        blk = doc.blocks.get(block) if block else None
        blk_types: dict[str, int] = {}
        texts: list[str] = []
        if blk is not None:
            for e in blk:
                blk_types[e.dxftype()] = blk_types.get(e.dxftype(), 0) + 1
            texts = [e.dxf.text for e in blk if e.dxftype() == "TEXT"]
        print(
            "  DIMENSION handle=%s type=%s block=%s actual=%s text=%r block_entities=%s block_texts=%s"
            % (d.dxf.handle, d.dxf.dimtype, block,
               d.dxf.get("actual_measurement"), d.dxf.get("text"), blk_types, texts)
        )


def font_audit(doc) -> None:
    """本图文字用的 SHX 字体本机没有，记下 ezdxf 实际替换成了哪个 TTF。"""
    from ezdxf.fonts import fonts

    for st in doc.styles:
        resolved = None
        try:
            resolved = fonts.font_manager.find_best_match(family=st.dxf.font) or \
                fonts.get_font_face(st.dxf.font)
        except Exception as exc:  # noqa: BLE001  只用于打印
            resolved = f"<{exc}>"
        print(f"  STYLE {st.dxf.name!r} font={st.dxf.font!r} bigfont={st.dxf.get('bigfont')!r}"
              f" -> 渲染用 {resolved}")


def part_paper_box(doc, vp, layer: str = "轮廓"):
    """把「轮廓」层实体用視口自己的变换矩阵投到纸面，返回 (w_mm, h_mm, x0, y0, x1, y1)。"""
    m = vp.get_transformation_matrix()
    pts = []
    for e in doc.modelspace():
        if e.dxf.get("layer") != layer:
            continue
        b = ezbbox.extents([e])
        if not b.has_data:   # is_empty 在 ezdxf 里表示「面积为 0」，直线也算，不能用它判空
            continue
        for x, y in ((b.extmin.x, b.extmin.y), (b.extmax.x, b.extmax.y)):
            p = m.transform((x, y, 0))
            pts.append((p.x, p.y))
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (max(xs) - min(xs), max(ys) - min(ys), min(xs), min(ys), max(xs), max(ys))


def main() -> int:
    print("ezdxf", ezdxf.__version__, "| matplotlib", matplotlib.__version__)
    print("backend = ezdxf.addons.drawing.matplotlib.MatplotlibBackend"
          "（ezdxf 官方 drawing addon 的 matplotlib 后端，PNG 用 Agg）")
    print("config  = background=WHITE color=BLACK min_lineweight=0.18")

    s11 = EVID / "samples" / "spacer-20x32x12.05-dxf-2000-1x1.dxf"
    s12 = EVID / "samples" / "spacer-20x32x12.05-dxf-2000-1x2.dxf"
    tmp = Path(tempfile.mkdtemp(prefix="dxf-render-"))
    SHOTS.mkdir(parents=True, exist_ok=True)

    # ---------- 1) 模型空间 1:1 ----------
    doc = ezdxf.readfile(str(s11))
    doc.audit()
    msp = doc.modelspace()
    print(f"\n[1] 模型空间渲染：{s11.name}")
    print(f"  dxfversion={doc.dxfversion} codepage={doc.header.get('$DWGCODEPAGE')}")
    describe(doc, "Model")
    font_audit(doc)

    ext = ezbbox.extents(msp)
    w_mm, h_mm = ext.size.x, ext.size.y
    scale = 11.0 / max(w_mm / 25.4, h_mm / 25.4)
    size = (w_mm / 25.4 * scale, h_mm / 25.4 * scale)
    out_model = SHOTS / "render-model-2000-1x1.png"
    render(msp, out_model, size, dpi=200)
    shape_px, ink, bbox = ink_bbox(out_model)
    print(f"  模型包围盒 {w_mm:.2f}x{h_mm:.2f} mm -> {shape_px[0]}x{shape_px[1]} px，"
          f"有墨像素={ink}，墨迹包围盒={bbox}")
    print(f"  wrote {out_model.relative_to(EVID)}")

    out_nodim = tmp / "model-no-dimension.png"
    render(msp, out_nodim, size, dpi=200, filter_func=lambda e: e.dxftype() != "DIMENSION")
    n, dbox = diff(out_model, out_nodim)
    print(f"  [差分证明] 去掉 DIMENSION 后不同像素={n}，差分包围盒={dbox}"
          f"  <- 这些像素就是标注的尺寸线/箭头/数字")
    assert n > 0, "渲染器没有画出任何标注像素：标注在渲染器眼里也是空的"

    # ---------- 2) 图纸空间 Layout1（1:1 / 1:2）----------
    for tag, dxf_path in (("1x1", s11), ("1x2", s12)):
        doc2 = ezdxf.readfile(str(dxf_path))
        doc2.audit()
        lay = doc2.layouts.get("Layout1")
        vp = list(lay.query("VIEWPORT"))[0]
        print(f"\n[2] 图纸空间渲染（{tag}）：{dxf_path.name}")
        describe(doc2, "Layout1")

        pw, ph, px0, py0, px1, py1 = part_paper_box(doc2, vp)
        print(f"  按视口变换矩阵预测：轮廓层（剖视+端视图）在纸面占 {pw:.2f}x{ph:.2f} mm，"
              f"位置 x={px0:.2f}..{px1:.2f} y={py0:.2f}..{py1:.2f}")

        out = SHOTS / f"render-layout-2000-{tag}.png"
        render(lay, out, A3_IN, dpi=300)
        shape_px, ink, bbox = ink_bbox(out)
        print(f"  渲染 {shape_px[0]}x{shape_px[1]} px（A3 @300dpi），有墨像素={ink}，"
              f"墨迹包围盒(px)={bbox}")
        if bbox:
            print(f"  墨迹包围盒(纸面 mm)={tuple(round(v, 2) for v in px_to_paper(shape_px, bbox))}")
        print(f"  wrote {out.relative_to(EVID)}")

        # 差分证明：去掉 VIEWPORT -> 差出来的就是视口内的模型内容（含标注）
        out_novp = tmp / f"layout-{tag}-no-viewport.png"
        render(lay, out_novp, A3_IN, dpi=300, filter_func=lambda e: e.dxftype() != "VIEWPORT")
        n2, dbox2 = diff(out, out_novp)
        print(f"  [差分证明] 去掉 VIEWPORT 后不同像素={n2}，差分包围盒={dbox2}")
        if dbox2:
            bb = px_to_paper(shape_px, dbox2)
            print(f"            差分包围盒(纸面 mm)={tuple(round(v, 2) for v in bb)}")
        assert n2 > 0, "视口内的模型内容没有被渲染：视口参数可能有问题"

        # 像素量尺寸线：12.050 的尺寸线就在两条尺寸界线起点所在的 y 上，量它的左右端点
        dim = list(doc2.modelspace().query("DIMENSION"))[0]
        m = vp.get_transformation_matrix()
        p2 = dim.dxf.get("defpoint2")
        p3 = dim.dxf.get("defpoint3")
        dim_line_y = max(p2.y, p3.y) if (p2 is not None and p3 is not None) else dim.dxf.defpoint.y
        dim_paper_y = m.transform((dim.dxf.defpoint.x, dim_line_y, 0)).y
        got = row_ink_extent_mm(out, dim_paper_y, 190.0, 230.0)
        if got:
            print(f"  [量图] 12.050 尺寸线所在纸面高度 y={dim_paper_y:.2f} mm，"
                  f"渲染图上该行有墨 x={got[0]:.2f}..{got[1]:.2f} -> 长 {got[1]-got[0]:.2f} mm")
            globals().setdefault("_dimlen", {})[tag] = got[1] - got[0]
        else:
            print(f"  [量图] y={dim_paper_y:.2f} mm 这一行没找到墨迹（需人工看图复核）")

        # 视口区域放大裁剪（两张用同一纸面矩形，可直接比大小）
        crop = (int(30 / MM_PER_PX), int((297 - 280) / MM_PER_PX),
                int(390 / MM_PER_PX), int((297 - 72) / MM_PER_PX))
        zoom = SHOTS / f"render-layout-2000-{tag}-viewport-zoom.png"
        Image.open(out).crop(crop).save(zoom)
        print(f"  wrote {zoom.relative_to(EVID)}（纸面 x=30..390, y=72..280 的裁剪）")

    lens = globals().get("_dimlen", {})
    if "1x1" in lens and "1x2" in lens:
        print(f"\n[量图汇总] 12.050 尺寸线纸面长度：1:1={lens['1x1']:.2f} mm，"
              f"1:2={lens['1x2']:.2f} mm，比值={lens['1x1']/lens['1x2']:.2f}"
              f"（1:2 的视口比例若真的是 0.5，比值应是 2.00）")

    print("\nOK")
    return 0


if __name__ == "__main__":
    sys.exit(main())

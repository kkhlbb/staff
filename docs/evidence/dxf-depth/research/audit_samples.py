"""第三方严格校验：ezdxf 读本仓库导出的 DXF（R12/2000）+ audit。"""
import pathlib, sys
import ezdxf

base = pathlib.Path('/Users/aston/DSH/staff/docs/evidence/dxf-depth/samples')
files = sorted(base.glob('*.dxf'))

for f in files:
    print("=" * 70)
    print("FILE:", f.name, f.stat().st_size, "bytes")
    try:
        doc = ezdxf.readfile(str(f))
        print("  readfile OK  dxfversion =", doc.dxfversion)
    except Exception as e:
        print("  readfile FAILED:", type(e).__name__, e)
        continue

    for layout in doc.layouts:
        ents = list(layout)
        types = {}
        for e in ents:
            types[e.dxftype()] = types.get(e.dxftype(), 0) + 1
        print(f"  layout {layout.name}: {types}")
        for e in layout.query("VIEWPORT"):
            print("    VIEWPORT h=", e.dxf.handle,
                  "center=", e.dxf.center, "width=", e.dxf.width, "height=", e.dxf.height,
                  "view_center=", e.dxf.view_center_point, "view_height=", e.dxf.view_height,
                  "status=", e.dxf.status, "id=", e.dxf.id)
        for e in layout.query("DIMENSION"):
            print("    DIMENSION h=", e.dxf.handle,
                  "dimtype=", e.dxf.dimtype, "geometry=", e.dxf.geometry,
                  "dimstyle=", e.dxf.dimstyle, "defpoint=", e.dxf.defpoint,
                  "defpoint2=", e.dxf.defpoint2, "defpoint3=", e.dxf.defpoint3,
                  "text_mid=", e.dxf.text_midpoint, "text=", repr(e.dxf.text),
                  "actual=", e.dxf.get("actual_measurement"))

    print("  blocks:", sorted(b.name for b in doc.blocks if not b.name.startswith("*Paper")))
    print("  dimstyles:", [s.dxf.name for s in doc.dimstyles])
    for layout in doc.layouts:
        try:
            print("  layout", layout.name, "paper=", layout.page_setup_size)
        except Exception as exc:
            print("  layout", layout.name, "paper size n/a:", exc)

    auditor = doc.audit()
    print("  audit errors =", len(auditor.errors), " fixes =", len(auditor.fixes))
    for e in auditor.errors[:8]:
        print("    ERR", e.code, e.message)
    for fx in auditor.fixes[:8]:
        print("    FIX", fx.code, fx.message)

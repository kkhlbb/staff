"""第三方严格校验：ezdxf 读 @tarikjabiri/dxf 产物 + audit。"""
import sys, pathlib
import ezdxf
from ezdxf import recover

p = pathlib.Path(__file__).with_name('lib-dimension-tarikjabiri.dxf')
print("file:", p, p.stat().st_size, "bytes")
try:
    doc = ezdxf.readfile(str(p))
    print("readfile OK, dxfversion =", doc.dxfversion)
except Exception as e:
    print("readfile FAILED:", type(e).__name__, e)
    doc, auditor = recover.readfile(str(p))
    print("recover fallback used")

msp = doc.modelspace()
print("msp entities:", [(e.dxftype(), e.dxf.handle) for e in msp])
dims = list(msp.query("DIMENSION"))
print("DIMENSION count:", len(dims))
for d in dims:
    print("  dim_type =", d.dxf.dimtype, "geometry block =", d.dxf.geometry, "defpoint =", d.dxf.defpoint,
          "defpoint2 =", d.dxf.defpoint2, "text =", repr(d.dxf.text), "actual_measurement =", d.dxf.get("actual_measurement"))
print("blocks:", [b.name for b in doc.blocks])
print("dimstyles:", [s.dxf.name for s in doc.dimstyles])
print("layouts:", [l.name for l in doc.layouts])
auditor = doc.audit()
print("audit errors:", len(auditor.errors), "fixes:", len(auditor.fixes))
for e in auditor.errors[:10]:
    print("  ERR", e.code, e.message)
for f in auditor.fixes[:10]:
    print("  FIX", f.code, f.message)

import pathlib
raw = pathlib.Path('/Users/aston/DSH/staff/docs/evidence/dxf-depth/research/ref-r2000.dxf').read_bytes()
text = raw.decode('utf-8', errors='replace')
lines = text.split('\n')
pairs = [(lines[i].strip(), lines[i+1].rstrip()) for i in range(0, len(lines)-1, 2)]
print("total pairs:", len(pairs))
i = next(k for k, (c, v) in enumerate(pairs) if c == '2' and v == 'VPORT')
seg = []
for c, v in pairs[i-2:i+40]:
    seg.append(f"{c}={v}")
    if len(seg) > 2 and c == '0' and v == 'VPORT' and len(seg) > 20:
        break
print("VPORT table:", " ".join(seg))
print()
print("section list:", [v for c, v in pairs if c == '2' and v in ('HEADER','CLASSES','TABLES','BLOCKS','ENTITIES','OBJECTS')])
print("table list:", [v for c, v in pairs if c == '2' and v in ('VPORT','LTYPE','LAYER','STYLE','VIEW','UCS','APPID','DIMSTYLE','BLOCK_RECORD')])

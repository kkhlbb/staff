"""逐实体的组码对比：我的 2000 文件 vs ezdxf 重新保存的同一份内容。"""
import pathlib

def load(path):
    raw = pathlib.Path(path).read_bytes()
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError:
        text = raw.decode('gbk', errors='replace')
    lines = text.split('\r\n')
    if len(lines) < 5:
        lines = text.split('\n')
    pairs = [(lines[i].strip(), lines[i+1].strip()) for i in range(0, len(lines)-1, 2)]
    return pairs

def entities(pairs, section='ENTITIES'):
    start = next(k for k, (c, v) in enumerate(pairs) if c == '0' and v == 'SECTION' and pairs[k+1][1] == section)
    end = start
    while not (pairs[end][0] == '0' and pairs[end][1] == 'ENDSEC'):
        end += 1
    out = []
    i = start + 2
    while i < end:
        if pairs[i][0] == '0':
            s = i
            i += 1
            while i < end and pairs[i][0] != '0':
                i += 1
            out.append((pairs[s][1], pairs[s+1:i]))
            continue
        i += 1
    return out

mine = entities(load('/Users/aston/DSH/staff/docs/evidence/dxf-depth/samples/spacer-20x32x12.05-dxf-2000-1x1.dxf'))
theirs = entities(load('/Users/aston/.hermes/profiles/daedalus/cache/scratch/dxfwork/resaved-2000.dxf'))

print("mine ENTITIES:", len(mine), [t for t, _ in mine])
print("ezdxf ENTITIES:", len(theirs), [t for t, _ in theirs])

def codes(tags):
    return [c for c, _ in tags]

for (t1, tags1), (t2, tags2) in zip(mine, theirs):
    if t1 != t2:
        print("MISMATCH ORDER", t1, t2)
        break
    mine_codes = set(codes(tags1))
    their_codes = set(codes(tags2))
    missing = sorted(their_codes - mine_codes)
    extra = sorted(mine_codes - their_codes)
    if missing or extra:
        print(f"{t1}: ezdxf 有我没有 {missing} | 我有它没有 {extra}")
        print("   mine:", tags1)
        print("   ezdxf:", tags2)

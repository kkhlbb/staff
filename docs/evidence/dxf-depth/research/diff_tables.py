"""对比 TABLES / BLOCKS 段的组码差异（我的 vs ezdxf 另存的同一内容）。"""
import pathlib

def load(path):
    raw = pathlib.Path(path).read_bytes()
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError:
        text = raw.decode('gbk', errors='replace')
    lines = text.split('\r\n') if '\r\n' in text else text.split('\n')
    return [(lines[i].strip(), lines[i+1].strip()) for i in range(0, len(lines)-1, 2)]

def records(pairs, section):
    start = next(k for k, (c, v) in enumerate(pairs) if c == '0' and v == 'SECTION' and pairs[k+1][1] == section)
    end = start
    while not (pairs[end][0] == '0' and pairs[end][1] == 'ENDSEC'):
        end += 1
    out, i = [], start + 2
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

mine = load('/Users/aston/DSH/staff/docs/evidence/dxf-depth/samples/spacer-20x32x12.05-dxf-2000-1x1.dxf')
theirs = load('/Users/aston/.hermes/profiles/daedalus/cache/scratch/dxfwork/resaved-2000.dxf')

for section in ('TABLES', 'BLOCKS'):
    m = records(mine, section)
    t = records(theirs, section)
    print(f"\n===== {section}: mine {len(m)} records / ezdxf {len(t)} =====")
    mtypes = [x[0] for x in m]
    ttypes = [x[0] for x in t]
    print("mine :", mtypes[:40])
    print("ezdxf:", ttypes[:40])
    # 按类型分组比组码集合
    from collections import defaultdict
    mg, tg = defaultdict(list), defaultdict(list)
    for k, tags in m:
        mg[k].append(tags)
    for k, tags in t:
        tg[k].append(tags)
    for kind in sorted(set(mg) | set(tg)):
        if not mg[kind] or not tg[kind]:
            print(f"  {kind}: 只在 {'ezdxf' if not mg[kind] else 'mine'} 有 {len(mg[kind] or tg[kind])} 条")
            continue
        mc = {c for c, _ in mg[kind][0]}
        tc = {c for c, _ in tg[kind][0]}
        if mc != tc:
            print(f"  {kind}: ezdxf 有我没有 {sorted(tc - mc)} | 我有它没有 {sorted(mc - tc)}")
            print("     mine :", mg[kind][0][:12])
            print("     ezdxf:", tg[kind][0][:14])

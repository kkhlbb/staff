"""检查句柄唯一性：重复或缺失的 5/105 句柄都是 ODA 导入失败的主因。"""
import pathlib, collections, sys

for arg in sys.argv[1:]:
    raw = pathlib.Path(arg).read_bytes()
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError:
        text = raw.decode('gbk', errors='replace')
    lines = text.split('\r\n')
    pairs = [(lines[i].strip(), lines[i+1].strip()) for i in range(0, len(lines)-1, 2)]
    handles = []
    label = '?'
    for code, value in pairs:
        if code == '0':
            label = value
        elif code in ('5', '105'):
            handles.append((value.upper(), label))
    dup = [h for h, c in collections.Counter(h for h, _ in handles).items() if c > 1]
    print(f"{pathlib.Path(arg).name}: {len(handles)} handles, duplicates={dup[:10]}")
    # 句柄是否合法十六进制、是否从 100 连续
    bad = [h for h, _ in handles if not all(ch in '0123456789ABCDEF' for ch in h)]
    print("  non-hex handles:", bad[:5])
    ints = sorted(int(h, 16) for h, _ in handles if all(ch in '0123456789ABCDEF' for ch in h))
    if ints:
        print("  min/max:", hex(ints[0]), hex(ints[-1]), "gaps:", len(set(range(ints[0], ints[-1] + 1)) - set(ints)))

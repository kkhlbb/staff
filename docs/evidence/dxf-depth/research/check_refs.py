"""检查 DXF 里的对象引用：哪些 330/340/350/331 指向了未定义的句柄。

ODA(QCAD 的导入器) 报 "Null object Id: <object> (0)" 通常就是这种悬空引用。
"""
import pathlib, sys, collections

REF_CODES = {'330', '331', '340', '345', '347', '350', '360', '390', '480'}

def scan(path):
    raw = pathlib.Path(path).read_bytes()
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError:
        text = raw.decode('gbk', errors='replace')
    lines = text.split('\r\n')
    pairs = [(lines[i].strip(), lines[i + 1].strip()) for i in range(0, len(lines) - 1, 2)]
    defined = set()
    used = []  # (code, handle, owner_label)
    label = '?'
    for code, value in pairs:
        if code == '0':
            label = value
        elif code in ('5', '105'):
            defined.add(value.upper())
        elif code in REF_CODES:
            used.append((code, value.upper(), label))
    print(f"\n=== {path} ===")
    print("defines:", len(defined), "refs:", len(used))
    dangling = [u for u in used if u[1] not in defined and u[1] != '0']
    counter = collections.Counter((u[0], u[2]) for u in dangling)
    print("dangling:", len(dangling))
    for (code, label), count in counter.most_common(20):
        sample = [u[1] for u in dangling if u[0] == code and u[2] == label][:5]
        print(f"  code {code} in {label}: {count}  e.g. {sample}")
    # 打印 OBJECTS 段的对象清单和它们的句柄
    print("objects section handles:")
    i = pairs.index(('2', 'OBJECTS')) if ('2', 'OBJECTS') in pairs else -1
    if i >= 0:
        for k in range(i, len(pairs)):
            if pairs[k][0] == '0' and pairs[k][1] in ('ENDSEC', 'EOF'):
                break
            if pairs[k][0] == '0':
                handle = ''
                for j in range(k + 1, min(k + 4, len(pairs))):
                    if pairs[j][0] in ('5', '105'):
                        handle = pairs[j][1]
                print(f"   {pairs[k][1]} handle={handle}")

for arg in sys.argv[1:]:
    scan(arg)

"""把本仓库导出的 2000 文件用 ezdxf 读入再另存，判断问题在"内容"还是"容器结构"。"""
import pathlib
import ezdxf

src = pathlib.Path(__file__).parent.parent / 'samples' / 'spacer-20x32x12.05-dxf-2000-1x2.dxf'
out = pathlib.Path('/tmp/resaved-2000.dxf')

doc = ezdxf.readfile(str(src))
print("read ok:", doc.dxfversion)
# 确保 dimstyle 存在且实体引用一致
for dim in doc.modelspace().query('DIMENSION'):
    if dim.dxf.geometry and dim.dxf.geometry not in doc.blocks:
        print("  dim without block:", dim.dxf.handle, dim.dxf.geometry)
doc.saveas(str(out))
print("saved:", out, out.stat().st_size)

# 结构对比：段与表的清单
def skeleton(path):
    raw = pathlib.Path(path).read_bytes()
    text = raw.decode('utf-8', errors='replace')
    lines = text.split('\n')
    pairs = [(lines[i].strip(), lines[i+1].rstrip()) for i in range(0, len(lines)-1, 2)]
    sections = [v for c, v in pairs if c == '2' and v in ('HEADER','CLASSES','TABLES','BLOCKS','ENTITIES','OBJECTS')]
    tables = [v for c, v in pairs if c == '2' and v in ('VPORT','LTYPE','LAYER','STYLE','VIEW','UCS','APPID','DIMSTYLE','BLOCK_RECORD')]
    objects = [v for c, v in pairs if c == '0' and v in ('DICTIONARY','LAYOUT','XRECORD','ACDBPLACEHOLDER','ACDBDICTIONARYWDFLT','SCALE','MLINESTYLE','PLOTSETTINGS','IMAGEDEF','TABLESTYLE','IDBUFFER')]
    return sections, tables, objects

print("\nMINE   sections:", *skeleton(src)[0])
print("MINE   tables  :", skeleton(src)[1])
print("MINE   objects :", {k: skeleton(src)[2].count(k) for k in set(skeleton(src)[2])})
print("\nEZDXF  sections:", *skeleton(out)[0])
print("EZDXF  tables  :", skeleton(out)[1])
print("EZDXF  objects :", {k: skeleton(out)[2].count(k) for k in set(skeleton(out)[2])})

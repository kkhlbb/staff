"""变异工具：m27（DIMENSION 退化）/ m28（视口写死 1:1）/ restore（还原）。"""
import pathlib
import shutil
import sys

SRC = pathlib.Path('/Users/aston/DSH/staff/src/drawing/dxfExport.ts')
BAK = pathlib.Path('/tmp/dxfExport.ts.bak')

M27_OLD = """      blocks.push({ name: blockName, flag: 1, entities: annotationGraphics(data, annotation) })
      entities.push(dimensionOf(data, annotation, blockName))"""
M27_NEW = """      void blockName
      entities.push(...annotationGraphics(data, annotation))"""

M28_OLD = "    viewHeightMm: heightMm * k,"
M28_NEW = "    viewHeightMm: heightMm, // M28 变异：写死 1:1"


def backup() -> None:
    shutil.copyfile(SRC, BAK)
    print("已备份 dxfExport.ts ->", BAK)


def apply(old: str, new: str, label: str) -> None:
    text = SRC.read_text()
    if old not in text:
        raise SystemExit(f"{label} 锚点没找到，拒绝变异")
    SRC.write_text(text.replace(old, new, 1))
    print(f"{label} 变异已应用")


def restore() -> None:
    shutil.copyfile(BAK, SRC)
    same = SRC.read_bytes() == BAK.read_bytes()
    print("已恢复 dxfExport.ts；与备份一致 =", same)


if __name__ == '__main__':
    action = sys.argv[1] if len(sys.argv) > 1 else ''
    if action == 'backup':
        backup()
    elif action == 'm27':
        apply(M27_OLD, M27_NEW, 'M27')
    elif action == 'm28':
        apply(M28_OLD, M28_NEW, 'M28')
    elif action == 'restore':
        restore()
    else:
        raise SystemExit('用法: mutate.py backup|m27|m28|restore')

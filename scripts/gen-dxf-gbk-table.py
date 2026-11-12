#!/usr/bin/env python3
"""生成 DXF 文本用的 GBK 双字节表（一次性工具，输出已提交）。

DXF R12 / 2000 没有 Unicode：中文要靠 $DWGCODEPAGE=ANSI_936 + GBK 字节。
运行时不引原生模块、不联网，因此把表编译进 TS：

    python3 scripts/gen-dxf-gbk-table.py > src/drawing/dxfGbkTable.ts

覆盖范围：GBK 双字节区（0x81–0xFE 前导 / 0x40–0xFE 尾随，跳过 0x7F），
排除 Unicode 私用区（PUA）。表外字符（emoji、表外生僻字）由 dxfGbk.ts
明确报错，绝不写乱码。重新生成后 `git diff` 必须为空。

同一 Unicode 码位若有多个 GBK 编码，保留先枚举到的那一个（解码结果相同）。
"""

entries: dict[int, tuple[int, int]] = {}
for lead in range(0x81, 0xFF):
    for trail in list(range(0x40, 0x7F)) + list(range(0x80, 0xFF)):
        try:
            char = bytes([lead, trail]).decode("gbk")
        except Exception:
            continue
        if len(char) != 1:
            continue
        code = ord(char)
        if 0xE000 <= code <= 0xF8FF:  # 私用区：不同实现含义不同，不收。
            continue
        if code not in entries:
            entries[code] = (lead, trail)

ordered = sorted(entries.items())
codes = bytearray()
pairs = bytearray()
for code, (lead, trail) in ordered:
    codes += code.to_bytes(2, "little")
    pairs += bytes([lead, trail])

import base64


def b64(data: bytes) -> str:
    text = base64.b64encode(data).decode("ascii")
    return "\n".join(text[i : i + 96] for i in range(0, len(text), 96))


print("""/**
 * GBK 双字节表（生成文件，勿手改）。
 *
 * 生成：`python3 scripts/gen-dxf-gbk-table.py > src/drawing/dxfGbkTable.ts`
 * 数据：unicode 码位（Uint16LE，升序）+ 对应的 GBK 两字节，同序。
 * 用途：DXF 文本按 $DWGCODEPAGE=ANSI_936 写 GBK 字节，R12/2000 的中文标注
 * 在中文 CAD 里才不会乱码。表外字符由 dxfGbk.ts 抛错，不静默替换。
 */
export const DXF_GBK_ENTRY_COUNT = %d
export const DXF_GBK_ASCII_RANGE = [0x20, 0x7e] as const
export const DXF_GBK_CODEPOINTS_BASE64: readonly string[] = [
%s
]
export const DXF_GBK_BYTES_BASE64: readonly string[] = [
%s
]
""" % (
    len(ordered),
    "\n".join("  '%s'," % line for line in b64(bytes(codes)).split("\n")),
    "\n".join("  '%s'," % line for line in b64(bytes(pairs)).split("\n")),
))

/**
 * CJK 部首补充区（U+2E80–U+2EFF）部首 → 统一汉字映射。
 *
 * 数据来源：Unicode Character Database `CJKRadicals.txt`（CJKRadicals-18.0.0.txt，
 * 2026-02-03，https://www.unicode.org/Public/UCD/latest/ucd/CJKRadicals.txt）。
 * 该表的第三列就是“只由该部首构成的统一汉字”。
 *
 * 为什么需要这张表：Unicode NFKC 只为康熙部首区（U+2F00–U+2FDF）定义了兼容分解，
 * CJK 部首补充区（U+2E80–U+2EFF，例如 U+2ED3 ⻓、U+2EDA ⻚）NFKC 原样保留。
 * 真实任务书文本层正会出现这些码位；只用 NFKC 会漏掉“长度/页码”。
 * 这里不硬编码某几个字，而是按官方 UCD 全量覆盖整个区段。
 */
export const CJK_RADICAL_TO_IDEOGRAPH: Readonly<Record<number, string>> = {
  0x2ea6: '\u4e2c',
  0x2eb0: '\u7e9f',
  0x2ec5: '\u89c1',
  0x2ec8: '\u8ba0',
  0x2ec9: '\u8d1d',
  0x2ecb: '\u8f66',
  0x2ed0: '\u9485',
  0x2ed3: '\u957f',
  0x2ed4: '\u95e8',
  0x2ed9: '\u97e6',
  0x2eda: '\u9875',
  0x2edb: '\u98ce',
  0x2edc: '\u98de',
  0x2ee0: '\u9963',
  0x2ee2: '\u9a6c',
  0x2ee5: '\u9c7c',
  0x2ee6: '\u9e1f',
  0x2ee7: '\u5364',
  0x2ee8: '\u9ea6',
  0x2ee9: '\u9ec4',
  0x2eea: '\u9efe',
  0x2eeb: '\u6589',
  0x2eec: '\u9f50',
  0x2eed: '\u6b6f',
  0x2eee: '\u9f7f',
  0x2eef: '\u7adc',
  0x2ef0: '\u9f99',
  0x2ef2: '\u4e80',
  0x2ef3: '\u9f9f',
}


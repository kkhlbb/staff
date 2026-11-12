/**
 * DXF 文字：`%%` 控制码与 MTEXT 富文本的纯文本化。
 *
 * 只做显示所需的解码，不改文件内容。MTEXT 的字体/颜色/堆叠等格式一律丢弃，
 * 但**保留可见文字**，不吞掉句子。
 */

/** `%%c` → ⌀、`%%d` → °、`%%p` → ±、`%%%` → %。大小写都认。 */
export function decodeTextSymbols(value: string): string {
  return value
    .replace(/%%[cC]/g, '⌀')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%%/g, '%')
}

const NUL = String.fromCharCode(0)

/**
 * MTEXT 只有纯文本：`\P` 换行、`\~` 空格；`\f...;` / `\H...;` / `\C...;` 等
 * 格式串删掉；`{` `}` 只做分组，不显示；`\\` 是字面反斜杠。
 */
export function plainMtext(raw: string): string {
  let text = raw.split('\\\\').join(NUL)
  text = text.replace(/\\P/gi, '\n')
  text = text.replace(/\\~/g, ' ')
  // 堆叠分数 `\S上^下;`：用「上/下」保留可读性。
  text = text.replace(/\\S([^;]*);/g, (_match, body: string) => body.replace(/[\^#]/g, '/'))
  text = text.replace(/\\[ACcFfHhQqTtWw][^;]*;/g, '')
  text = text.replace(/\\[LlOoKk]/g, '')
  text = text.replace(/[{}]/g, '')
  text = text.split(NUL).join('\\')
  return decodeTextSymbols(text)
}

/** 尺寸标注文字：组码 42 的实测值 + 类型前缀；不读匿名块里的旧文字。 */
export function dimensionValueText(measurement: number, dimensionType: number): string {
  const base = Math.abs(dimensionType) % 16
  const prefix = base === 3 ? '⌀' : base === 4 ? 'R' : ''
  const rounded = Math.round(measurement * 1000) / 1000
  return `${prefix}${rounded.toFixed(3)}`
}

/** 按字符粗略估宽（CJK 全宽 ≈ 1em，其余 ≈ 0.55em）；只用于包围盒与点选，不用于标注值。 */
export function estimateTextWidth(text: string, height: number): number {
  let units = 0
  for (const character of text) {
    units += /[\u2e80-\uffef]/.test(character) ? 1 : 0.55
  }
  return units * height
}

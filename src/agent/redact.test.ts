/**
 * 脱敏：Windows 路径补全（盘符 / UNC / 环境变量根）与不误伤。
 *
 * 断言重点：
 * - 五类 Windows 写法都被替换成 `<path>`，不残留盘符或共享名；
 * - 非路径的冒号文本（`ABC:\x`、`12:30`、`a:b`、`http://…`）原样保留；
 * - 正文里单独出现的 `C:\` 不替换；
 * - 路径后面的正文不被吞掉（不误伤）；
 * - `sensitiveFindings` 与脱敏同一套口径：能脱掉的也必须能拦下。
 */
import { describe, expect, it } from 'vitest'
import { redactText, sensitiveFindings } from './redact'

describe('redactText：Windows 路径', () => {
  it('盘符路径（反斜杠与正斜杠）都被替换', () => {
    expect(redactText('C:\\Users\\aston\\报告.pdf')).toBe('<path>')
    expect(redactText('D:\\data\\raw\\a.csv')).toBe('<path>')
    expect(redactText('C:/Users/aston/a.txt')).toBe('<path>')
  })

  it('目录段含空格的路径整段替换（C:\\Program Files\\…）', () => {
    expect(redactText('C:\\Program Files\\Cunlian\\app.exe')).toBe('<path>')
  })

  it('UNC 共享路径被替换', () => {
    expect(redactText('\\\\server\\share\\docs\\a.pdf')).toBe('<path>')
    expect(redactText('打开 \\\\nas-01\\design\\2026\\b.dxf 后')).toBe('打开 <path> 后')
  })

  it('环境变量根被替换（大小写不敏感）', () => {
    expect(redactText('%APPDATA%\\vendor\\keys.json')).toBe('<path>')
    expect(redactText('%LOCALAPPDATA%\\Temp\\x.log')).toBe('<path>')
    expect(redactText('%appdata%\\lower\\case.json')).toBe('<path>')
    expect(redactText('%USERPROFILE%\\Documents\\a.pdf')).toBe('<path>')
    expect(redactText('%TEMP%')).toBe('<path>')
  })

  it('路径后面的正文不被吞掉', () => {
    expect(redactText('已保存到 C:\\Users\\aston\\a.txt 请查看')).toBe('已保存到 <path> 请查看')
    expect(redactText('C:\\Users\\aston\\a.txt，请查看')).toBe('<path>，请查看')
  })

  it('macOS 路径行为不变', () => {
    expect(redactText('/Users/aston/图纸/a.pdf')).toBe('<path>')
    expect(redactText('/private/var/folders/xx/T/tmp.png')).toBe('<path>')
  })
})

describe('redactText：不误伤正常文本', () => {
  it('非路径的冒号文本原样保留', () => {
    expect(redactText('ABC:\\x')).toBe('ABC:\\x')
    expect(redactText('比例 a:b，时间 12:30')).toBe('比例 a:b，时间 12:30')
    expect(redactText('见 https://example.com/a/b')).toBe('见 https://example.com/a/b')
    expect(redactText('H 52.2 ±0.02 / B1 20 ±0.01')).toBe('H 52.2 ±0.02 / B1 20 ±0.01')
  })

  it('正文里单独出现的 C:\\ 不当作路径', () => {
    expect(redactText('驱动器 C:\\ 未就绪')).toBe('驱动器 C:\\ 未就绪')
  })

  it('相对路径与普通反斜杠文本不动', () => {
    expect(redactText('docs/evidence/a.json')).toBe('docs/evidence/a.json')
    expect(redactText('换行符写成 \\n，转义写成 \\"')).toBe('换行符写成 \\n，转义写成 \\"')
  })
})

describe('sensitiveFindings：与脱敏同一套口径', () => {
  it('Windows 路径被拦下', () => {
    expect(sensitiveFindings('C:\\Users\\aston\\a.txt')).toContain('absolute path')
    expect(sensitiveFindings('\\\\server\\share\\a')).toContain('absolute path')
    expect(sensitiveFindings('%APPDATA%\\x.json')).toContain('absolute path')
    expect(sensitiveFindings('/Users/aston/a.txt')).toContain('absolute path')
  })

  it('非路径文本不被误拦', () => {
    expect(sensitiveFindings('ABC:\\x')).toEqual([])
    expect(sensitiveFindings('时间 12:30')).toEqual([])
  })
})

// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { sha256Hex } from './hash'

describe('SHA-256 文件摘要', () => {
  it('与公开测试向量一致（空串与 abc）', async () => {
    expect(await sha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('输出固定 64 位小写十六进制', async () => {
    const hash = await sha256Hex(new Uint8Array([0, 1, 2, 255]))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { inspectPdfBytes, type PdfModuleLike } from './pdfInspect'

function moduleWith(document: unknown): PdfModuleLike {
  return {
    getDocument: () => ({
      promise: Promise.resolve(document as never),
      destroy: () => Promise.resolve(),
    }),
  }
}

describe('逐页可解析的检查边界', () => {
  it('每页都取 getPage + getOperatorList：第 2 页内容流失败即 invalid_pdf', async () => {
    const getOperatorList = vi
      .fn()
      .mockResolvedValueOnce({ fnArray: [] })
      .mockRejectedValueOnce(new Error('broken content stream'))
    const getPage = vi.fn(async () => ({ getOperatorList, cleanup: () => {} }))

    await expect(
      inspectPdfBytes(
        new Uint8Array([1, 2, 3]),
        moduleWith({ numPages: 2, getPage }),
      ),
    ).rejects.toMatchObject({
      code: 'invalid_pdf',
      message: expect.stringContaining('第 2 页内容无法解析'),
    })

    expect(getPage).toHaveBeenCalledTimes(2)
    expect(getOperatorList).toHaveBeenCalledTimes(2)
  })

  it('页数超过 maxPages 时短路，只返回页数，不逐页解析', async () => {
    const getPage = vi.fn()
    const result = await inspectPdfBytes(
      new Uint8Array([1, 2, 3]),
      moduleWith({ numPages: 3, getPage }),
      { maxPages: 2 },
    )
    expect(result).toEqual({ pageCount: 3 })
    expect(getPage).not.toHaveBeenCalled()
  })

  it('直到取页时才要求密码：仍映射为 password_protected，不伪装成损坏', async () => {
    const module = moduleWith({
      numPages: 1,
      getPage: async () => {
        throw Object.assign(new Error('No password given'), {
          name: 'PasswordException',
        })
      },
    })
    await expect(
      inspectPdfBytes(new Uint8Array([1, 2, 3]), module),
    ).rejects.toMatchObject({ code: 'password_protected' })
  })
})

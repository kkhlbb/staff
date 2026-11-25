import { describe, expect, it, vi } from 'vitest'
import {
  createOpenFileRouter,
  extractCunlianArg,
  extractDxfArg,
} from '../main/launchArgs'

describe('launchArgs: Windows .cunlian 命令行参数提取与路由', () => {
  it('冷启动提取带双引号、空格与中文的 Windows .cunlian 路径并忽略 -- 标志', () => {
    const argv = [
      'C:\\Users\\demo\\AppData\\Local\\Programs\\寸链\\寸链.exe',
      '--user-data-dir=C:\\temp\\profile',
      '--allow-file-access-from-files',
      '"C:\\Users\\工程师\\桌面\\安装板 项目 01\\主安装板.cunlian"',
    ]

    expect(extractCunlianArg(argv)).toBe(
      'C:\\Users\\工程师\\桌面\\安装板 项目 01\\主安装板.cunlian',
    )
    expect(extractDxfArg(argv)).toBeNull()
  })

  it('不匹配非 .cunlian 后缀、纯扩展名、标志值中的 .cunlian 以及可执行文件自身', () => {
    expect(
      extractCunlianArg([
        'C:\\fake\\something.cunlian',
        '--open-dxf=C:\\drawings\\plate.dxf',
        '--project=C:\\projects\\ignored.cunlian',
        'C:\\drawings\\plate.dxf',
        'C:\\docs\\spec.pdf',
        '.cunlian',
        'C:\\dir\\.cunlian',
      ]),
    ).toBeNull()
  })

  it('大小写不敏感匹配 .CUNLIAN 并支持按 Windows workingDirectory 解析相对路径', () => {
    const argv = ['寸链.exe', '"子目录 1\\测试件.CUNLIAN"']
    expect(extractCunlianArg(argv, 'D:\\工程资料\\寸链项目')).toBe(
      'D:\\工程资料\\寸链项目\\子目录 1\\测试件.CUNLIAN',
    )
  })

  it('不破坏既有 --open-dxf= 提取行为', () => {
    const argv = [
      'C:\\Program Files\\寸链\\寸链.exe',
      '--open-dxf=C:\\工程图\\安装板 视图.dxf',
      'C:\\项目\\安装板.cunlian',
    ]

    expect(extractDxfArg(argv)).toBe('C:\\工程图\\安装板 视图.dxf')
    expect(extractCunlianArg(argv)).toBe('C:\\项目\\安装板.cunlian')
    expect(extractDxfArg(['寸链.exe', '--open-dxf='])).toBeNull()
  })

  it('router 将冷启动与 second-instance 分别路由到队列与与 open-file 相同的打开回调', () => {
    const queue: string[] = []
    const delivered: string[] = []
    const onDeliver = vi.fn((filePath: string) => {
      queue.push(filePath)
      delivered.push(filePath)
    })
    const router = createOpenFileRouter({ queue, onDeliver })

    const coldPath = router.enqueueColdStart([
      'C:\\Apps\\寸链.exe',
      '"C:\\用户\\机械设计\\安装板 A1.cunlian"',
    ])
    expect(coldPath).toBe('C:\\用户\\机械设计\\安装板 A1.cunlian')
    expect(queue).toEqual(['C:\\用户\\机械设计\\安装板 A1.cunlian'])
    expect(onDeliver).not.toHaveBeenCalled()

    const secondPath = router.handleSecondInstance(
      [
        'C:\\Apps\\寸链.exe',
        '--original-process-start-time=12345',
        '"D:\\二次双击 目录\\隔套 项目.cunlian"',
      ],
      'D:\\',
    )
    expect(secondPath).toBe('D:\\二次双击 目录\\隔套 项目.cunlian')
    expect(onDeliver).toHaveBeenCalledTimes(1)
    expect(delivered).toEqual(['D:\\二次双击 目录\\隔套 项目.cunlian'])
    expect(queue).toEqual([
      'C:\\用户\\机械设计\\安装板 A1.cunlian',
      'D:\\二次双击 目录\\隔套 项目.cunlian',
    ])

    // second-instance 无 .cunlian 参数时（例如用户仅重新点击快捷方式）不触发打开回调
    expect(router.handleSecondInstance(['C:\\Apps\\寸链.exe', '--open-dxf=C:\\a.dxf'])).toBeNull()
    expect(onDeliver).toHaveBeenCalledTimes(1)
  })
})

import { Menu, app, type MenuItemConstructorOptions } from 'electron'
import type { MenuAction } from '../shared/contracts'

export interface ApplicationMenuOptions {
  /** 把菜单动作发给当前窗口；renderer 侧由 A-04 接工作台命令。 */
  sendAction: (action: MenuAction) => void
}

/**
 * macOS 应用菜单。
 *
 * 文件菜单提供任务卡列出的 new/open/save/saveAs/importV2/close 六类动作，
 * 走 `menu:action` 事件而不是在主进程直接改文件，保证 dirty gate 与编辑屏障
 * 都在会话层处理。编辑/窗口/视图使用系统 role，避免自造快捷键行为。
 */
export function buildApplicationMenu(options: ApplicationMenuOptions): Menu {
  const send = (action: MenuAction) => () => {
    options.sendAction(action)
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: '寸链',
      submenu: [
        { role: 'about', label: '关于寸链' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏寸链' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        {
          label: '退出寸链',
          accelerator: 'Command+Q',
          click: () => {
            app.quit()
          },
        },
      ],
    },
    {
      label: '文件',
      submenu: [
        { label: '新建项目…', accelerator: 'Command+N', click: send('new') },
        { label: '打开项目…', accelerator: 'Command+O', click: send('open') },
        { label: '打开 DXF 看图…', click: send('openDxf') },
        { type: 'separator' },
        { label: '保存', accelerator: 'Command+S', click: send('save') },
        { label: '另存为…', accelerator: 'Command+Shift+S', click: send('saveAs') },
        { type: 'separator' },
        { label: '导入 V2 备份…', click: send('importV2') },
        { type: 'separator' },
        { label: '关闭窗口', accelerator: 'Command+W', click: send('close') },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '进入全屏幕' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '前置全部窗口' },
      ],
    },
  ]

  return Menu.buildFromTemplate(template)
}

export function installApplicationMenu(options: ApplicationMenuOptions): void {
  Menu.setApplicationMenu(process.platform === 'darwin' ? buildApplicationMenu(options) : null)
}

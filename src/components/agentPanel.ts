/** 任务侧栏折叠状态的持久化（随窗口保留）；与组件文件分开以免破坏 Fast Refresh。 */
export const AGENT_PANEL_KEY = 'cunlian.agent.sidebar.open'

export function readAgentPanelOpen(): boolean {
  try {
    const stored = window.localStorage?.getItem(AGENT_PANEL_KEY)
    return stored === null || stored === undefined ? true : stored === '1'
  } catch {
    return true
  }
}

export function writeAgentPanelOpen(open: boolean): void {
  try {
    window.localStorage?.setItem(AGENT_PANEL_KEY, open ? '1' : '0')
  } catch {
    // 存储不可用只影响下次启动的默认状态，不影响当前交互。
  }
}

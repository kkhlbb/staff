import { useEffect, useState, type JSX } from 'react'

/**
 * 桌面壳页面（A-01）。
 *
 * 只验证“生产包能离线加载本地资源、preload 桥可用、关闭屏障协议可跑”，
 * 不做工作台布局、项目会话或示例尺寸链——那属于 A-04 的 DesktopWorkspace。
 * 页面明确显示当前批次状态，避免被误当成完成的工作台。
 */
const styles = {
  page: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro SC", "PingFang SC", sans-serif',
    background: '#F5F7FA',
    color: '#172033',
    minHeight: '100vh',
    margin: 0,
    padding: '32px 40px',
    boxSizing: 'border-box' as const,
  },
  card: {
    background: '#FFFFFF',
    border: '1px solid #D9E0E9',
    borderRadius: 10,
    padding: 24,
    maxWidth: 760,
  },
  h1: { fontSize: 24, margin: '0 0 4px' },
  hint: { color: '#526075', fontSize: 14, margin: '0 0 20px' },
  row: {
    display: 'grid',
    gridTemplateColumns: '190px 1fr',
    gap: 12,
    fontSize: 14,
    padding: '6px 0',
    borderTop: '1px solid #EEF1F5',
  },
  label: { color: '#526075' },
  ok: { color: '#14633D' },
  warn: { color: '#92400E' },
  button: {
    marginTop: 20,
    background: '#3730A3',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 6,
    padding: '10px 18px',
    fontSize: 14,
    cursor: 'pointer',
  },
  code: { fontFamily: 'SF Mono, Menlo, monospace', fontSize: 13 },
}

function methodNames(): string[] {
  const api = window.cunlian
  return api === undefined ? [] : Object.keys(api).sort()
}

export function ShellApp(): JSX.Element {
  const [bridgeKeys] = useState<string[]>(methodNames)
  const [flushLog, setFlushLog] = useState('尚未收到编辑屏障请求')
  const [menuLog, setMenuLog] = useState('尚未收到菜单动作')
  const [closeLog, setCloseLog] = useState('尚未请求关闭')

  useEffect(() => {
    const api = window.cunlian
    if (api === undefined) {
      return undefined
    }
    const offFlush = api.onEditorFlush((payload) => {
      setFlushLog(`已收到 requestId=${payload.requestId}，并已回复 flushed`)
      api.respondEditorFlush({ requestId: payload.requestId, editSeq: 0 })
    })
    const offMenu = api.onMenuAction((payload) => {
      setMenuLog(`已收到菜单动作：${payload.action}`)
    })
    return () => {
      offFlush()
      offMenu()
    }
  }, [])

  const requestClose = (): void => {
    const api = window.cunlian
    if (api === undefined) {
      setCloseLog('preload 桥不可用')
      return
    }
    void api.requestClose().then((result) => {
      setCloseLog(
        result.ok
          ? '主进程已确认关闭（窗口随后销毁）'
          : `关闭被拒绝：${result.error.code}`,
      )
    })
  }

  return (
    <main style={styles.page}>
      <h1 style={styles.h1}>寸链 · 桌面壳</h1>
      <p style={styles.hint}>
        批次 A-01 只交付桌面壳与受限 IPC；工作台、项目会话和尺寸链示例由后续子卡实现。
      </p>
      <section style={styles.card}>
        <div style={styles.row}>
          <span style={styles.label}>preload 桥</span>
          <span style={bridgeKeys.length > 0 ? styles.ok : styles.warn}>
            {bridgeKeys.length > 0
              ? `window.cunlian 可用：${bridgeKeys.join(', ')}`
              : '不可用'}
          </span>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>编辑屏障</span>
          <span style={styles.code}>{flushLog}</span>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>菜单动作</span>
          <span style={styles.code}>{menuLog}</span>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>关闭请求</span>
          <span style={styles.code}>{closeLog}</span>
        </div>
        <button type="button" style={styles.button} onClick={requestClose}>
          请求关闭窗口
        </button>
      </section>
    </main>
  )
}

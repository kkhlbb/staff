/**
 * macOS Keychain 预留接口（阶段 4 才允许真实写入）。
 *
 * 阶段 2 不读取、不写入任何密钥，也不把密钥放进项目文件、日志或证据。
 * 真实实现应在主进程用 macOS Security 框架；接口保持在此，避免后续扩散。
 */
export interface KeychainStore {
  read(account: string): Promise<string | null>
  write(account: string, secret: string): Promise<void>
}

export class MacKeychainStore implements KeychainStore {
  async read(_account: string): Promise<string | null> {
    void _account
    // TODO(V4.0 阶段 4): 经主进程读取已配置密钥；阶段 2 明确返回“未配置”。
    return null
  }

  async write(_account: string, _secret: string): Promise<void> {
    void _account
    void _secret
    // TODO(V4.0 阶段 4): 写入 macOS Keychain。阶段 2 禁止落盘任何密钥。
    throw new Error('KEYCHAIN_WRITE_DEFERRED_TO_STAGE_4')
  }
}

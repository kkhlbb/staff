# Windows 代码签名与 SmartScreen 信任指南

本文说明 **寸链（Cunlian）Windows x64 安装程序** 触发 Windows SmartScreen / 浏览器下载拦截的原因、最终用户如何校验 `SHA256SUMS.txt`，以及维护者启用 Authenticode 代码签名的三种标准方案。

---

## 一、为什么未签名 `.exe` 会触发 SmartScreen 与浏览器警告

1. **Mark of the Web（MotW）**：从浏览器下载的 `.exe` 会被 Windows 写入 NTFS 备用数据流 `Zone.Identifier`（ZoneId=3），触发 Windows Defender SmartScreen 与 Edge / Chrome 安全检查。
2. **缺少 Authenticode 数字签名**：未经过受信任 CA 签名的 PE 可执行文件没有可验证的发布者身份与历史信誉，SmartScreen 会默认显示「Windows 已保护你的电脑」或「不常下载」。
3. **NSIS 启发式降噪（已在安装脚本内完成加固）**：
   - `scripts/installer/cunlian-win-x64.nsi` 已启用 `Unicode true`、`RequestExecutionLevel user`（每用户 `%LOCALAPPDATA%` 安装，不触发 UAC 管理员提权弹窗）、`ManifestDPIAware true`、`ManifestSupportedOS all`；
   - 完整嵌入 PE `VIProductVersion` / `VIFileVersion` 与 8 项 `VIAddVersionKey`（`ProductName`、`CompanyName`、`FileDescription`、`FileVersion`、`ProductVersion`、`LegalCopyright`、`OriginalFilename`、`InternalName`）；
   - 使用标准非固实 `SetCompressor zlib` 替代易被杀软启发式误报的 `/SOLID lzma` 压缩头。

> **注意**：PE 元数据与压缩算法优化可显著降低第三方杀软的启发式误报，但**彻底消除 Windows SmartScreen 拦截必须使用受信任 CA 签发的 Authenticode 代码签名证书**。

---

## 二、Windows 用户下载校验指南（`SHA256SUMS.txt`）

在运行未签名安装包之前，请务必对照 GitHub Release 附带的 `SHA256SUMS.txt` 校验文件完整性：

### CMD（命令提示符）

```cmd
certutil -hashfile cunlian-v1.0.0-windows-x64-setup.exe SHA256
```

### PowerShell

```powershell
Get-FileHash .\cunlian-v1.0.0-windows-x64-setup.exe -Algorithm SHA256
```

确认输出的 64 位十六进制哈希与 `SHA256SUMS.txt` 完全一致后：
- 若 Edge 提示「不常下载」，点击提示条右侧 `...` → **保留** → **仍然保留**；
- 若 Windows SmartScreen 弹窗拦截，点击 **更多信息** → **仍要运行**；
- 也可直接下载免安装版 `cunlian-v1.0.0-windows-x64.zip`，校验 SHA-256 后解压运行 `寸链.exe`。

---

## 三、启用 Authenticode 代码签名（三种方案）

`scripts/build-win-installer.mjs` 已内置开箱即用的 Authenticode 签名钩子：启用后会自动对 **内层 `寸链.exe`（打包进 NSIS 前）** 和 **外层 `cunlian-v<ver>-windows-x64-setup.exe`** 执行双层签名，并附加 **RFC 3161 SHA-256 时间戳**（默认 `http://timestamp.digicert.com`）。未配置签名环境变量时，脚本会打印非致命提示并正常产出未签名安装包。

### 方案一（开源免费）：GitHub Actions + SignPath.io Foundation

适用于公开开源仓库（MIT 等 OSI 许可证），SignPath Foundation 为符合条件的开源项目免费提供受信任代码签名服务。

1. 前往 [SignPath Foundation](https://signpath.org/) 提交开源项目申请（需仓库公开、MIT 许可、构建在 GitHub Actions 中可复现）。
2. 在 SignPath 控制台创建：
   - **Project**（绑定本 GitHub 仓库）；
   - **Artifact Configuration**（指定需要签名的 `cunlian-v*-windows-x64-setup.exe` 或解压包内的 `寸链.exe`）；
   - **Signing Policy**（例如 `release-signing`，配置审批策略）。
3. 在 GitHub 仓库 Settings → Secrets and variables → Actions 中添加 `SIGNPATH_API_TOKEN`（及组织 slug `SIGNPATH_ORGANIZATION_ID`）。
4. 在发布 workflow 中先上传未签名构建产物，再提交 SignPath 签名请求：

```yaml
- name: Upload unsigned Windows installer
  id: upload-unsigned
  uses: actions/upload-artifact@v4
  with:
    name: cunlian-win-x64-unsigned
    path: release/cunlian-v*-windows-x64-setup.exe

- name: Submit to SignPath Foundation
  uses: signpath/github-action-submit-signing-request@v1
  with:
    api-token: ${{ secrets.SIGNPATH_API_TOKEN }}
    organization-id: ${{ vars.SIGNPATH_ORGANIZATION_ID }}
    project-slug: cunlian
    signing-policy-slug: release-signing
    github-artifact-id: ${{ steps.upload-unsigned.outputs.artifact-id }}
    wait-for-completion: true
    output-artifact-directory: release/signed
```

> 说明：SignPath Foundation 使用组织级开源证书，首次发布后通常随着下载量快速积累 SmartScreen 信誉。

---

### 方案二（立即可信、零 SmartScreen 警告）：Microsoft Azure Trusted Signing（Artifact Signing）

Microsoft Azure Trusted Signing（约 **$9.99/月** 基础套餐）由微软直接托管短期签名证书，签出的二进制文件**立即获得 Windows Defender SmartScreen 信任，无冷启动信誉期**。

1. 在 Azure Portal 创建 **Trusted Signing Account（Artifact Signing）**，完成个人或组织身份核验（Identity Validation）。
2. 在账号下创建 **Certificate Profile**（类型选择 `Public Trust`）。
3. 为 GitHub Actions 配置 OIDC 联合凭据（或服务主体），授予该账号的 `Trusted Signing Certificate Profile Signer` 角色。
4. 在 Windows Runner 上，可通过两种方式接入：

#### 方式 A：通过 `WIN_SIGN_COMMAND` 接入 `scripts/build-win-installer.mjs`（同时签内层 `寸链.exe` 与外层安装程序）

在安装了 Windows SDK（`signtool.exe`）与 `Microsoft.Trusted.Signing.Client`（`Azure.CodeSigning.Dlib.dll`）的 Windows Runner 上：

```powershell
$env:WIN_SIGN_COMMAND = 'signtool sign /v /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib "C:\tools\Azure.CodeSigning.Dlib.dll" /dmdf "metadata.json" {file}'
node scripts/build-win-installer.mjs out/cunlian-v1.0.0-windows-x64.zip release/cunlian-v1.0.0-windows-x64-setup.exe
```

#### 方式 B：在 GitHub Actions 中使用官方 Action

```yaml
- name: Azure Login (OIDC)
  uses: azure/login@v2
  with:
    client-id: ${{ secrets.AZURE_CLIENT_ID }}
    tenant-id: ${{ secrets.AZURE_TENANT_ID }}
    subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

- name: Sign with Azure Trusted Signing
  uses: azure/trusted-signing-action@v0.5
  with:
    endpoint: https://eus.codesigning.azure.net/
    trusted-signing-account-name: ${{ vars.AZURE_SIGNING_ACCOUNT }}
    certificate-profile-name: ${{ vars.AZURE_CERT_PROFILE }}
    files-folder: release
    files-folder-filter: exe
    file-digest: SHA256
    timestamp-rfc3161: http://timestamp.acs.microsoft.com
    timestamp-digest: SHA256
```

---

### 方案三（本地 / CI PFX 证书）：`WIN_SIGN_PFX_PATH` + `WIN_SIGN_PFX_PASSWORD`

如果你已有商业 CA 签发的 `.pfx` / `.p12` 代码签名证书（或 CI 密钥库中的临时解包文件），可直接通过环境变量触发 `scripts/build-win-installer.mjs` 自动签名：

| 环境变量 | 必填 | 说明 |
|---|---|---|
| `WIN_SIGN_PFX_PATH` | 是（PFX 模式） | `.pfx` / `.p12` 证书文件路径 |
| `WIN_SIGN_PFX_PASSWORD` | 是（PFX 模式） | 证书私钥口令（严禁写入仓库） |
| `WIN_SIGN_TIMESTAMP_URL` | 否 | RFC 3161 时间戳服务器，默认 `http://timestamp.digicert.com` |
| `WIN_SIGN_TOOL` | 否 | 显式指定 `osslsigncode` 或 `signtool.exe` 路径 |
| `WIN_SIGN_URL` | 否 | 写入签名的发布者信息链接（`-i` / `/du`） |
| `WIN_SIGN_COMMAND` | 否 | 自定义签名命令（优先级高于 PFX 模式，支持 `{file}`、`{timestampUrl}`、`{description}` 占位符） |

#### macOS / Linux（使用 `osslsigncode`）

```bash
brew install osslsigncode   # macOS；Ubuntu/Debian 可用 sudo apt-get install osslsigncode

WIN_SIGN_PFX_PATH=/secure/path/cunlian.pfx \
WIN_SIGN_PFX_PASSWORD='***' \
node scripts/build-win-installer.mjs \
  release/cunlian-v1.0.0-windows-x64.zip \
  release/cunlian-v1.0.0-windows-x64-setup.exe
```

#### Windows（使用 Windows SDK `signtool`）

```powershell
$env:WIN_SIGN_PFX_PATH = "C:\secure\cunlian.pfx"
$env:WIN_SIGN_PFX_PASSWORD = "***"
node scripts/build-win-installer.mjs release\cunlian-v1.0.0-windows-x64.zip release\cunlian-v1.0.0-windows-x64-setup.exe
```

---

## 四、签名结果验证

### Windows

```powershell
Get-AuthenticodeSignature .\cunlian-v1.0.0-windows-x64-setup.exe | Format-List
signtool verify /pa /v .\cunlian-v1.0.0-windows-x64-setup.exe
```

### macOS / Linux

```bash
osslsigncode verify -in cunlian-v1.0.0-windows-x64-setup.exe
```

> **安全红线**：切勿将 `.pfx` 证书、私钥、口令或自签名测试证书提交到 Git 仓库或打包进 Release 产物；CI 中应使用加密 Secrets 并在任务结束后清理临时证书文件。

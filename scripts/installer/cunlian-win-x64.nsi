Unicode true
RequestExecutionLevel user
Name "寸链 0.5.3-beta"
OutFile "${EXECUTABLE}"
InstallDir "$LOCALAPPDATA\Programs\寸链"
SetCompressor lzma
ManifestDPIAware true
ShowInstDetails show
ShowUninstDetails show

!include "MUI2.nsh"
!include "x64.nsh"
!include "WinMessages.nsh"
!include "Sections.nsh"
!define OWNER "Software\Cunlian\WindowsX64Installer"
!define UNINSTALL "Software\Microsoft\Windows\CurrentVersion\Uninstall\Cunlian.WindowsX64"
!define EXT "Software\Classes\.cunlian"
!define PROGID "Cunlian.Project.WindowsX64"
!define CLASS "Software\Classes\${PROGID}"
!define OPEN 'Software\Classes\${PROGID}\shell\open\command'
!define OPEN_COMMAND '$\"$INSTDIR\寸链.exe$\" $\"%1$\"'
!define AGENT "$INSTDIR\resources\cunlian-agent"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\寸链.exe"
!define MUI_FINISHPAGE_RUN_TEXT "立即启动寸链"

VIProductVersion "0.5.3.0"
VIAddVersionKey /LANG=2052 "ProductName" "寸链"
VIAddVersionKey /LANG=2052 "FileDescription" "寸链 Windows x64 安装程序"
VIAddVersionKey /LANG=2052 "ProductVersion" "0.5.3-beta"
VIAddVersionKey /LANG=2052 "FileVersion" "0.5.3-beta"
VIAddVersionKey /LANG=2052 "LegalCopyright" "寸链"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE CheckDirectory
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Var PreviousDir

Function .onInit
  SetShellVarContext current
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "寸链需要 64 位 Windows。"
    Abort
  ${EndIf}
  ReadRegStr $PreviousDir HKCU "${OWNER}" "InstallDir"
  StrCmp $PreviousDir "" +2
  StrCpy $INSTDIR $PreviousDir
FunctionEnd

Function ValidateDirectory
  StrCmp $PreviousDir "" fresh
  StrCmp $PreviousDir $INSTDIR valid
  MessageBox MB_ICONSTOP "请先卸载之前的寸链，再选择新的安装目录。"
  Abort
fresh:
  !include "${GENERATED}\guard.nsh"
  Goto valid
collision:
  MessageBox MB_ICONSTOP "目标目录已有与安装文件同名的文件。请选择其他目录。"
  Abort
valid:
FunctionEnd

Function CheckDirectory
  Call ValidateDirectory
FunctionEnd

!macro RunMcp MODE
  System::Call 'kernel32::SetEnvironmentVariableW(w "ELECTRON_RUN_AS_NODE", w "1")'
  System::Call 'kernel32::SetEnvironmentVariableW(w "NODE_OPTIONS", p 0)'
  System::Call 'kernel32::SetEnvironmentVariableW(w "ELECTRON_NO_ASAR", p 0)'
  nsExec::ExecToLog '"$INSTDIR\寸链.exe" "${AGENT}\run-mcp-config.mjs" ${MODE}'
  Pop $0
  System::Call 'kernel32::SetEnvironmentVariableW(w "ELECTRON_RUN_AS_NODE", p 0)'
!macroend

Section "寸链（必需）" Core
  SectionIn RO
  Call ValidateDirectory
  SetOutPath "$INSTDIR"
  SetOverwrite on
  ClearErrors
  WriteUninstaller "$INSTDIR\uninstall.exe"
  IfErrors failed
  WriteRegStr HKCU "${OWNER}" "InstallDir" "$INSTDIR"
  IfErrors failed
  File /r "${PAYLOAD}/*"
  IfErrors failed
  SetOutPath "${AGENT}"
  File "mcp-config.mjs"
  File "run-mcp-config.mjs"
  IfErrors failed
  WriteRegStr HKCU "${UNINSTALL}" "DisplayName" "寸链"
  WriteRegStr HKCU "${UNINSTALL}" "DisplayVersion" "0.5.3-beta"
  WriteRegStr HKCU "${UNINSTALL}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL}" "DisplayIcon" "$INSTDIR\寸链.exe"
  WriteRegStr HKCU "${UNINSTALL}" "UninstallString" '$\"$INSTDIR\uninstall.exe$\"'
  WriteRegDWORD HKCU "${UNINSTALL}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL}" "NoRepair" 1

  SetOutPath "$INSTDIR"
  IfFileExists "$DESKTOP\寸链.lnk" +5
  ClearErrors
  CreateShortcut "$DESKTOP\寸链.lnk" "$INSTDIR\寸链.exe"
  IfErrors +2
  WriteRegDWORD HKCU "${OWNER}" "Desktop" 1
  IfFileExists "$SMPROGRAMS\寸链.lnk" +5
  ClearErrors
  CreateShortcut "$SMPROGRAMS\寸链.lnk" "$INSTDIR\寸链.exe"
  IfErrors +2
  WriteRegDWORD HKCU "${OWNER}" "StartMenu" 1

  ; The merged view covers existing machine registrations too. UserChoice is
  ; managed by Windows and is deliberately left alone.
  ReadRegDWORD $0 HKCU "${OWNER}" "Association"
  StrCmp $0 1 associationDone
  ClearErrors
  ReadRegStr $0 HKCR ".cunlian" ""
  IfErrors 0 associationDone
  ClearErrors
  ReadRegStr $0 HKCR "${PROGID}\shell\open\command" ""
  IfErrors 0 associationDone
  WriteRegStr HKCU "${OPEN}" "" "${OPEN_COMMAND}"
  WriteRegStr HKCU "${EXT}" "" "${PROGID}"
  WriteRegDWORD HKCU "${OWNER}" "Association" 1
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
associationDone:
  !insertmacro RunMcp local
  StrCmp $0 "0" done
failed:
  MessageBox MB_ICONSTOP "安装失败。请检查目标目录的访问权限，再重试。"
  SetErrorLevel 1
  Abort
done:
SectionEnd

Section "同步 MCP 配置并设置用户环境变量" Sync
  !insertmacro RunMcp sync
  StrCmp $0 "0" +2
  MessageBox MB_ICONEXCLAMATION "无法同步用户 MCP 配置。请检查现有配置文件。"
  ReadRegDWORD $0 HKCU "${OWNER}" "Environment"
  StrCmp $0 1 envDone
  StrCpy $1 0
envCheck:
  ClearErrors
  EnumRegValue $0 HKCU "Environment" $1
  IfErrors envWrite
  StrCmp $0 "CUNLIAN_INSTALL_DIR" envDone
  IntOp $1 $1 + 1
  Goto envCheck
envWrite:
  ClearErrors
  WriteRegStr HKCU "Environment" "CUNLIAN_INSTALL_DIR" "$INSTDIR"
  IfErrors envDone
  WriteRegDWORD HKCU "${OWNER}" "Environment" 1
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=1000
envDone:
SectionEnd

Function un.onInit
  SetShellVarContext current
  ReadRegStr $0 HKCU "${OWNER}" "InstallDir"
  StrCmp $0 $INSTDIR +3
  MessageBox MB_ICONSTOP "安装记录与当前目录不一致，无法卸载。"
  Abort
FunctionEnd

Section "Uninstall"
  SetOutPath "$TEMP"
  IfFileExists "${AGENT}\.installer-mcp-owner.json" 0 mcpDone
  !insertmacro RunMcp remove
  StrCmp $0 "0" mcpDone
  MessageBox MB_ICONSTOP "无法清理用户 MCP 配置。请检查配置文件后重试。"
  SetErrorLevel 1
  Abort
mcpDone:
  ReadRegDWORD $0 HKCU "${OWNER}" "Environment"
  StrCmp $0 1 0 envDone
  ReadRegStr $0 HKCU "Environment" "CUNLIAN_INSTALL_DIR"
  StrCmpS $0 $INSTDIR 0 envDone
  DeleteRegValue HKCU "Environment" "CUNLIAN_INSTALL_DIR"
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=1000
envDone:
  ReadRegDWORD $0 HKCU "${OWNER}" "Association"
  StrCmp $0 1 0 associationDone
  ReadRegStr $0 HKCU "${OPEN}" ""
  StrCmpS $0 "${OPEN_COMMAND}" 0 associationDone
  ReadRegStr $0 HKCU "${EXT}" ""
  StrCmpS $0 "${PROGID}" 0 +3
  DeleteRegValue HKCU "${EXT}" ""
  DeleteRegKey /ifempty HKCU "${EXT}"
  DeleteRegValue HKCU "${OPEN}" ""
  DeleteRegKey /ifempty HKCU "${OPEN}"
  DeleteRegKey /ifempty HKCU "${CLASS}\shell\open"
  DeleteRegKey /ifempty HKCU "${CLASS}\shell"
  DeleteRegKey /ifempty HKCU "${CLASS}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
associationDone:
  ReadRegDWORD $0 HKCU "${OWNER}" "Desktop"
  StrCmp $0 1 0 +2
  Delete "$DESKTOP\寸链.lnk"
  ReadRegDWORD $0 HKCU "${OWNER}" "StartMenu"
  StrCmp $0 1 0 +2
  Delete "$SMPROGRAMS\寸链.lnk"
  !include "${GENERATED}\cleanup.nsh"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL}"
  DeleteRegKey HKCU "${OWNER}"
SectionEnd

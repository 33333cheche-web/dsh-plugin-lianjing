param(
  [string]$RepoRoot = '',
  [switch]$AllUsers
)

# 莲鲸 · 在桌面放一个「双击就开」的快捷方式
#
# 快捷方式指向 open-pet.ps1：它每次运行会现找 DeepSeek Harness 的端口，
# 所以 DSH 重启、端口换了也不用重做快捷方式。
#
# 用法：install-shortcut.ps1 [-AllUsers]

$ErrorActionPreference = 'Stop'

if (-not $RepoRoot) {
  $RepoRoot = Split-Path -Parent $PSScriptRoot
}

$Launcher = Join-Path $RepoRoot 'desktop\open-pet.ps1'
$Icon = Join-Path $RepoRoot 'assets\lianjing.ico'
$PsExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

if (-not (Test-Path $Launcher)) {
  throw "找不到启动脚本：$Launcher"
}

if ($AllUsers) {
  $desktopDir = [Environment]::GetFolderPath('CommonDesktopDirectory')
} else {
  $desktopDir = [Environment]::GetFolderPath('Desktop')
}

$lnkPath = Join-Path $desktopDir '莲鲸桌宠.lnk'
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath = $PsExe
$lnk.Arguments = ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $Launcher)
$lnk.WorkingDirectory = $RepoRoot
if (Test-Path $Icon) {
  $lnk.IconLocation = $Icon
}
$lnk.Description = '启动莲鲸桌面宠物（DSH 插件）'
$lnk.WindowStyle = 7
$lnk.Save()

"已创建：$lnkPath"
"  目标：$PsExe"
"  入口：$Launcher"

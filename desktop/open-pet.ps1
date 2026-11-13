param(
  [string]$Origin = '',
  [string]$RepoRoot = ''
)

# 莲鲸 · 桌面快捷方式入口
#
# 双击桌面图标就会跑这个脚本：先找出正在运行的 DeepSeek Harness 监听的端口，
# 再把独立桌面壳拉到那个端口上。宿主的端口每次启动都可能变，所以不能把地址
# 写死在快捷方式里。
#
# 用法：open-pet.ps1 [-Origin http://127.0.0.1:12341] [-RepoRoot <插件目录>]

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

if (-not $RepoRoot) {
  $RepoRoot = Split-Path -Parent $PSScriptRoot
}
$ShellScript = Join-Path $RepoRoot 'desktop\pet-shell.ps1'
$AssetDir = Join-Path $RepoRoot 'assets'
$LogFile = Join-Path ([IO.Path]::GetTempPath()) 'lianjing-shortcut.log'

function Write-Log {
  param([string]$Text)
  try {
    $line = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + '  ' + $Text
    [IO.File]::AppendAllText($LogFile, $line + "`r`n", [Text.UTF8Encoding]::new($false))
  } catch { }
}

function Show-Tip {
  param([string]$Text)
  [void][System.Windows.Forms.MessageBox]::Show($Text, '莲鲸', 'OK', 'Information')
}

function Test-PetRoute {
  param([string]$BaseUrl)
  try {
    $req = [System.Net.HttpWebRequest]::Create("$BaseUrl/dsh-lianjing/pet.json")
    $req.Method = 'GET'
    $req.Timeout = 2000
    $req.ReadWriteTimeout = 2000
    $req.UserAgent = 'lianjing-shortcut'
    $req.Headers.Add('x-dsh-lianjing', '1')
    $resp = $req.GetResponse()
    $code = [int]$resp.StatusCode
    $resp.Close()
    return $code -eq 200
  } catch {
    return $false
  }
}

function Find-HostOrigin {
  $seen = @{}
  $candidates = @()
  foreach ($line in (netstat -ano -p TCP)) {
    if ($line -notmatch 'LISTENING') { continue }
    $cols = ($line.Trim() -split '\s+')
    if ($cols.Count -lt 5) { continue }
    $endpoint = $cols[1]
    $procId = 0
    if (-not [int]::TryParse($cols[$cols.Count - 1], [ref]$procId)) { continue }
    if ($endpoint -notmatch '^(127\.0\.0\.1|0\.0\.0\.0|\[::\]:)' ) { continue }
    $port = 0
    $portText = $endpoint.Split(':')[-1]
    if (-not [int]::TryParse($portText, [ref]$port)) { continue }
    if ($seen.ContainsKey($port)) { continue }
    $seen[$port] = $true

    $procName = ''
    $procCmd = ''
    try {
      $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction Stop
      $procName = $proc.Name
      $procCmd = $proc.CommandLine
    } catch { continue }

    $looksLikeDsh = $false
    if ($procName -match 'DeepSeek|Harness|dsh') { $looksLikeDsh = $true }
    elseif ($procName -eq 'node.exe' -and $procCmd -match 'dsh|harness') { $looksLikeDsh = $true }
    if (-not $looksLikeDsh) { continue }

    if ($endpoint -match '^(127\.0\.0\.1|\[::\]:)') {
      $candidates += [pscustomobject]@{ Port = $port; Kind = 1 }
    } else {
      $candidates += [pscustomobject]@{ Port = $port; Kind = 2 }
    }
  }

  # 先试本机回环地址，再试 0.0.0.0 绑定
  foreach ($kind in 1, 2) {
    foreach ($c in ($candidates | Where-Object { $_.Kind -eq $kind } | Sort-Object Port)) {
      $base = "http://127.0.0.1:$($c.Port)"
      if (Test-PetRoute $base) { return $base }
    }
  }
  return ''
}

function Get-RunningShell {
  # 只认「-File ...pet-shell.ps1 -Origin http...」这个真正的壳命令行。
  # 用通配符 '*-File*pet-shell.ps1*' 会把自己这种带脚本名的调试进程也算进去。
  $found = @()
  try {
    $found = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object {
      $_.CommandLine -match '-File\s+"?[^"]*desktop\\pet-shell\.ps1"?\s+-Origin\s+http' -and
      $_.ProcessId -ne $PID
    }
  } catch { }
  return @($found)
}

function Get-ShellOrigin {
  param($Process)
  $m = [regex]::Match($Process.CommandLine, '-Origin\s+(\S+)')
  if ($m.Success) { return $m.Groups[1].Value.TrimEnd('/') }
  return ''
}

function Stop-Shell {
  param($Process)
  try {
    & taskkill /PID $Process.ProcessId /T /F 2>&1 | Out-Null
    Write-Log "已结束旧壳 pid=$($Process.ProcessId)"
  } catch {
    Write-Log "结束旧壳失败 pid=$($Process.ProcessId): $($_.Exception.Message)"
  }
}

try {
  if (-not (Test-Path $ShellScript)) {
    Show-Tip "找不到桌面壳脚本：`r`n$ShellScript`r`n`r`n插件目录不完整，请重新安装。"
    exit 1
  }

  if ($Origin) {
    $Origin = $Origin.Trim().TrimEnd('/')
  }

  if (-not $Origin) {
    $Origin = Find-HostOrigin
  }

  if (-not $Origin) {
    Write-Log '没找到正在运行的 DeepSeek Harness'
    Show-Tip "没找到正在运行的 DeepSeek Harness。`r`n`r`n先打开 DeepSeek Harness，再双击这个图标；`r`n桌面壳要连宿主的接口才能取到功课数据。"
    exit 2
  }

  Write-Log "宿主端口: $Origin"

  if (-not (Test-PetRoute $Origin)) {
    Write-Log "端口上没有莲鲸接口: $Origin"
    Show-Tip "找到了 DeepSeek Harness（$Origin），但它这个配置里没加载莲鲸插件。`r`n`r`n用这条命令装上，装完重开 DSH：`r`ndsh plugin --profile desktop add link:<插件目录>"
    exit 3
  }

  $running = Get-RunningShell
  $already = @($running | Where-Object { (Get-ShellOrigin $_) -eq $Origin })
  if ($already.Count -gt 0) {
    Write-Log "壳已经在跑（pid=$((@($already) | ForEach-Object { $_.ProcessId }) -join ',')），不再开第二只"
    exit 0
  }

  # 地址对不上的是 DSH 上次开的那只（端口变了），先收掉再起新的
  foreach ($old in @($running | Where-Object { (Get-ShellOrigin $_) -ne $Origin })) {
    Write-Log "旧壳端口对不上（$(Get-ShellOrigin $old) ≠ $Origin），收掉"
    Stop-Shell $old
  }
  Start-Sleep -Milliseconds 600

  $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $argLine = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Origin {1} -AssetDir "{2}"' -f $ShellScript, $Origin, $AssetDir
  Start-Process -FilePath $psExe -ArgumentList $argLine -WindowStyle Hidden | Out-Null
  Write-Log "已拉起桌面壳：$Origin"
  Start-Sleep -Milliseconds 1200
  $running = Get-RunningShell
  Write-Log "壳进程数：$((@($running)).Count)"
  exit 0
} catch {
  Write-Log ('出错：' + $_.Exception.Message)
  Show-Tip ("启动莲鲸时出错：`r`n" + $_.Exception.Message)
  exit 4
}

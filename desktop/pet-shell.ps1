param(
  [Parameter(Mandatory = $true)][string]$Origin,
  [Parameter(Mandatory = $true)][string]$AssetDir,
  # 诊断用：个别显卡/远程桌面下分层透明窗口可能渲染异常，这个开关退回不透明窗口。
  [switch]$Opaque
)

# 莲鲸 · Windows 独立桌宠壳
#
# 纯 WPF，无第三方依赖：透明、无边框、始终置顶、可拖动，能脱离 DSH 窗口独立站着。
# 数据来自插件注册的免鉴权回环路由（只读 GET + 带 x-dsh-fojing-pet 头的 POST）。
#
# 用法：pet-shell.ps1 -Origin http://127.0.0.1:10567 -AssetDir <插件 assets 目录>

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms

$StateUrl = "$Origin/dsh-fojing-pet/pet.json"
$NextUrl  = "$Origin/dsh-fojing-pet/next"
$ReadUrl  = "$Origin/dsh-fojing-pet/read"
$ImportUrl  = "$Origin/dsh-fojing-pet/import"
$BeatUrl   = "$Origin/dsh-fojing-pet/heartbeat"
$CatalogUrl = "$Origin/dsh-fojing-pet/catalog.json"
$WorkUrl  = "$Origin/dsh-fojing-pet/work.json"
$OpenUrl   = "$Origin/dsh-fojing-pet/open"
# 敲木鱼：一次彩头 + 一段随包音效（启动时下到临时目录，之后不再联网取）
$MuyuUrl   = "$Origin/dsh-fojing-pet/muyu"
$MuyuWavUrl = "$Origin/dsh-fojing-pet/muyu.wav"
$MuyuWavPath = Join-Path ([System.IO.Path]::GetTempPath()) ('dsh-fojing-pet-muyu-' + $PID + '.wav')
# 敲木鱼那一瞬间换的立绘：宿主把 knock 加进 SPRITES，壳这边按名字取；404 就静默用回原图
$KnockSpriteUrl = "$Origin/dsh-fojing-pet/asset.png?name=knock"
$KnockSpriteTemp = Join-Path ([System.IO.Path]::GetTempPath()) ('dsh-fojing-pet-knock-' + $PID + '.png')

$PetHeight  = 210
$CardHeight = 470
# 功课页要装 6 行会话（约 600 DIP），比读经卡片高；但它仍然是「卡片」，不是整屏。
$WorkCardHeight = 620
$OpenPetHeight = 210
$WindowWidth = 448

# --- 尺寸档位 -----------------------------------------------------------------
# 整只宠物（立绘 + 飘字层 + 底部标签 + 右上角那枚光点）按同一比例缩：
# 大 = 100%（就是原来的尺寸）、中 = 80%、小 = 62%。
# 用 LayoutTransform 而不是 RenderTransform：它参与测量，Fit-WindowHeight 会自动跟着变。
# 它是绕左上角缩的 —— 所以 $petGroup 必须 HorizontalAlignment=Center、按内容定宽，
# 让缩放后的布局槽正好等于内容宽度，居中的事交给父容器，否则整只宠物会往左偏。
$SizePresets = [ordered]@{
  'large'  = 1.00
  'medium' = 0.80
  'small'  = 0.62
}
$SizeLabels = [ordered]@{ 'large' = '大'; 'medium' = '中'; 'small' = '小' }
$script:SizePreset = 'large'
$script:PetScale = 1.0
$script:SizeChips = @{}
# 桌面壳的偏好没有宿主侧存档（网页那只记在 localStorage），所以壳自己记这一个值：
# %LOCALAPPDATA%\dsh-fojing-pet\pet-shell.json，只放 sizePreset；读不到或坏了就当「大」。
$PetStatePath = ''
try {
  if ($env:LOCALAPPDATA) { $PetStatePath = Join-Path (Join-Path $env:LOCALAPPDATA 'dsh-fojing-pet') 'pet-shell.json' }
} catch { $PetStatePath = '' }

# --- 样式 -------------------------------------------------------------------
$Ink      = '#33555A'
$InkSoft  = '#485C58'
$Muted    = '#A08A68'
$Accent   = '#8CB7AF'
$AccentDk = '#456D64'
$Paper    = '#FFFAF0'
$Border   = '#E7D8BA'

function New-Thickness {
  param([string]$Value)
  $parts = @($Value -split ',' | ForEach-Object { [double]$_.Trim() })
  switch ($parts.Count) {
    1 { return (New-Object System.Windows.Thickness $parts[0]) }
    2 { return (New-Object System.Windows.Thickness $parts[0], $parts[1]) }
    default { return (New-Object System.Windows.Thickness $parts[0], $parts[1], $parts[2], $parts[3]) }
  }
}

function ConvertTo-FontWeight {
  param([string]$Weight)
  switch ($Weight) {
    'Bold' { return [System.Windows.FontWeights]::Bold }
    'SemiBold' { return [System.Windows.FontWeights]::SemiBold }
    'Light' { return [System.Windows.FontWeights]::Light }
    default { return [System.Windows.FontWeights]::Normal }
  }
}

function New-Text {
  param(
    [string]$Text = '',
    [double]$Size = 12,
    [string]$Color = $Ink,
    [string]$Family = 'Microsoft YaHei',
    [string]$Weight = 'Normal',
    [string]$Margin = '0,0,0,0',
    [string]$LineHeight = ''
  )
  $tb = New-Object System.Windows.Controls.TextBlock
  $tb.Text = $Text
  $tb.TextWrapping = 'Wrap'
  $tb.Foreground = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString($Color)))
  $tb.FontFamily = New-Object System.Windows.Media.FontFamily $Family
  $tb.FontSize = $Size
  $tb.FontWeight = ConvertTo-FontWeight $Weight
  $tb.Margin = (New-Thickness $Margin)
  if ($LineHeight) { $tb.LineHeight = [double]$LineHeight; $tb.LineStackingStrategy = 'BlockLineHeight' }
  return $tb
}

function New-Brush {
  param([string]$Hex)
  return (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString($Hex)))
}

# --- 数字与时长的中文写法 -----------------------------------------------------
# 桌面上扫一眼就够：1.47亿 / 23.4万 / 860，不摆一长串数字。
function Format-TokenCount {
  param($Value)
  $n = 0.0
  if ($null -ne $Value) { try { $n = [double]$Value } catch { $n = 0 } }
  if ($n -le 0) { return '0' }
  if ($n -ge 100000000) { return ([Math]::Round($n / 100000000, 2).ToString() + '亿') }
  if ($n -ge 10000) { return ([Math]::Round($n / 10000, 1).ToString() + '万') }
  return ([Math]::Round($n).ToString())
}

# 墙钟时长：2小时41分 / 12分 / 38秒
function Format-DurationMs {
  param($Value)
  # 注意：参数不能叫 $Ms —— PowerShell 变量名大小写不敏感，下面 $ms 会把它覆盖掉
  $ms = 0.0
  if ($null -ne $Value) { try { $ms = [double]$Value } catch { $ms = 0 } }
  if ($ms -le 0) { return '—' }
  $total = [Math]::Floor($ms / 1000)
  if ($total -lt 60) { return ('{0}秒' -f [int]$total) }
  if ($total -lt 3600) { return ('{0}分' -f [int][Math]::Floor($total / 60)) }
  if ($total -lt 86400) {
    $h = [int][Math]::Floor($total / 3600)
    $m = [int][Math]::Floor(($total % 3600) / 60)
    if ($m -le 0) { return ('{0}小时' -f $h) }
    return ('{0}小时{1}分' -f $h, $m)
  }
  return ('{0}天{1}小时' -f [int][Math]::Floor($total / 86400), [int][Math]::Floor(($total % 86400) / 3600))
}

# 距今：刚刚 / 12分钟前 / 3小时前 / 2天前
function Format-Ago {
  param($Value)
  # 同理：参数别叫 $Ms
  $ms = 0.0
  if ($null -ne $Value) { try { $ms = [double]$Value } catch { $ms = 0 } }
  if ($ms -le 0) { return '刚刚' }
  if ($ms -lt 60000) { return '刚刚' }
  if ($ms -lt 3600000) { return ('{0}分钟前' -f [int][Math]::Floor($ms / 60000)) }
  if ($ms -lt 86400000) { return ('{0}小时前' -f [int][Math]::Floor($ms / 3600000)) }
  return ('{0}天前' -f [int][Math]::Floor($ms / 86400000))
}

# 会话短名：宿主给的 short 偶尔是「session-」这种没剥干净的值，兜底从 id 里再取一次
function Get-ShortName {
  param($Session)
  $short = ''
  try { if ($Session -and $Session.short) { $short = ([string]$Session.short).Trim() } } catch { }
  if ($short -and $short -ne 'session-') { return $short }
  $id = ''
  try { if ($Session -and $Session.id) { $id = [string]$Session.id } } catch { }
  if ($id.StartsWith('session-')) { $id = $id.Substring(8) }
  if ($id.Length -gt 8) { $id = $id.Substring(0, 8) }
  if (-not $id) { return '?' }
  return $id
}

# 离下一次自动出经还有几秒（给立绘下面那个小标签算倒计时）
function Get-NextRunLeft {
  try {
    if (-not $script:State -or -not $script:State.nextRunAt) { return 0 }
    $next = [DateTimeOffset]::Parse([string]$script:State.nextRunAt)
    $left = ($next - [DateTimeOffset]::Now).TotalSeconds
    if ($left -gt 0) { return $left }
  } catch { }
  return 0
}

# 「还要等多久」用人话写：明天再读 / 7 小时 17 分后再读 / 43 分后再读 / 1 分钟内
# 不写秒：桌面上那串 437:01 会被读成四百多个小时。
function Format-RunLeft {
  param($Value)
  $left = 0.0
  try { $left = [double]$Value } catch { $left = 0 }
  if ($left -le 0) { return '' }
  if ($left -lt 60) { return '1 分钟内' }
  if ($left -lt 3600) { return ('{0} 分后再读' -f [int][Math]::Floor($left / 60)) }
  if ($left -lt 86400) {
    $hours = [int][Math]::Floor($left / 3600)
    $mins = [int][Math]::Floor(($left - $hours * 3600) / 60)
    if ($mins -le 0) { return ('{0} 小时后' -f $hours) }
    return ('{0} 小时 {1} 分后再读' -f $hours, $mins)
  }
  $days = [int][Math]::Floor($left / 86400)
  if ($days -eq 1) { return '明天再读' }
  return ('{0} 天后再读' -f $days)
}

# 经书选择用的圆角小胶囊
function New-SutraChip {
  param([string]$Title, [string]$SutraId, [bool]$Active, [string]$Tip)
  $chip = New-Object System.Windows.Controls.Border
  $chip.CornerRadius = New-Object System.Windows.CornerRadius 6
  $chip.Padding = (New-Thickness '10,3,10,4')
  $chip.Margin = (New-Thickness '0,0,5,5')
  $chip.BorderThickness = (New-Thickness '1')
  $chip.Cursor = 'Hand'
  $chip.Tag = $SutraId
  if ($Active) {
    $chip.Background = New-Brush '#8CB7AF'
    $chip.BorderBrush = New-Brush '#8CB7AF'
  } else {
    $chip.Background = New-Brush '#FFFDF7'
    $chip.BorderBrush = New-Brush '#E2D3B6'
  }
  $color = '#7A6A4E'
  if ($Active) { $color = '#FFFDF5' }
  $label = New-Text -Text $Title -Size 10.5 -Color $color -Weight 'SemiBold'
  $chip.Child = $label
  # 不挂 ToolTip：悬停气泡会挡住下一次点击（立绘上踩过一次这个坑）
  # 用 Preview（隧道）事件：卡片在 ScrollViewer 里，冒泡的 MouseLeftButtonUp 可能被它吃掉
  $chip.Add_PreviewMouseLeftButtonUp({
      # 处理器里抛错会顺着 $ErrorActionPreference=Stop 把整个壳带崩，必须自己兜住
      try {
        $id = $this.Tag
        if (-not $id) { return }
        Invoke-Next $id
      } catch {
        $txtStatus.Text = "换经书失败 · $($_.Exception.Message)"
      }
    })
  return $chip
}

function Invoke-PetApi {
  param([string]$Method = 'GET', [string]$Url, $Body = $null)
  $headers = @{ 'x-dsh-fojing-pet' = '1' }
  # POST 必须带 application/json 的 body，否则插件的 CSRF 守卫会直接 403。
  if ($Method -ne 'GET') {
    if ($null -eq $Body) { $Body = @{} }
    return Invoke-RestMethod -Method $Method -Uri $Url -Headers $headers -ContentType 'application/json' `
      -Body ($Body | ConvertTo-Json -Compress) -TimeoutSec 20
  }
  return Invoke-RestMethod -Method $Method -Uri $Url -Headers $headers -TimeoutSec 20
}

# --- 窗口 -------------------------------------------------------------------
$window = New-Object System.Windows.Window
$window.WindowStyle = 'None'
if ($Opaque) {
  $window.AllowsTransparency = $false
  $window.Background = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString('#F6F1E6'))
} else {
  $window.AllowsTransparency = $true
  $window.Background = [System.Windows.Media.Brushes]::Transparent
}
$window.Topmost = $true
$window.ShowInTaskbar = $false
# 不抢焦点：否则第一次点击只会激活窗口，被当成「没反应」。
$window.ShowActivated = $false
$window.ResizeMode = 'NoResize'
$window.Width = $WindowWidth
$window.Height = $PetHeight + 40

# 先给个占位位置，别让窗口在 (0,0) 闪一下；真正的落点在 Loaded 里按光标所在屏算。
$screen = [System.Windows.SystemParameters]::WorkArea
$window.Left = $screen.Right - $WindowWidth - 24
$window.Top  = $screen.Bottom - ($PetHeight + 40) - 16

$root = New-Object System.Windows.Controls.Grid
$window.Content = $root

$stack = New-Object System.Windows.Controls.StackPanel
$stack.VerticalAlignment = 'Bottom'
$stack.HorizontalAlignment = 'Stretch'
$root.Children.Add($stack) | Out-Null

# --- 卡片 -------------------------------------------------------------------
$cardBorder = New-Object System.Windows.Controls.Border
$cardBorder.CornerRadius = New-Object System.Windows.CornerRadius 20
$cardBorder.BorderThickness = New-Object System.Windows.Thickness 1
$cardBorder.BorderBrush = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString($Border)))
$cardBorder.Background = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString($Paper)))
$cardBorder.Margin = New-Object System.Windows.Thickness 8, 0, 8, 6
$cardBorder.Visibility = 'Collapsed'
$cardBorder.MaxHeight = $CardHeight

$cardShadow = New-Object System.Windows.Media.Effects.DropShadowEffect
$cardShadow.BlurRadius = 26
$cardShadow.Opacity = 0.26
$cardShadow.ShadowDepth = 6
$cardShadow.Direction = 270
$cardShadow.Color = [System.Windows.Media.ColorConverter]::ConvertFromString('#5A5040')
$cardBorder.Effect = $cardShadow

$scroll = New-Object System.Windows.Controls.ScrollViewer
$scroll.VerticalScrollBarVisibility = 'Auto'
$scroll.HorizontalScrollBarVisibility = 'Disabled'
$scroll.Padding = New-Object System.Windows.Thickness 18, 14, 6, 12

# 细长圆角滚动条：系统默认那条太笨重，和纸卡不搭。
$scrollBarXaml = @'
<Style xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
       xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
       TargetType="ScrollBar">
  <Setter Property="Width" Value="7"/>
  <Setter Property="Margin" Value="0,2,0,2"/>
  <Setter Property="Background" Value="Transparent"/>
  <Setter Property="Template">
    <Setter.Value>
      <ControlTemplate TargetType="ScrollBar">
        <Grid Background="Transparent">
          <Track x:Name="PART_Track" IsDirectionReversed="True">
            <Track.DecreaseRepeatButton>
              <RepeatButton Command="ScrollBar.PageUpCommand" Focusable="False">
                <RepeatButton.Template>
                  <ControlTemplate TargetType="RepeatButton">
                    <Border Background="Transparent"/>
                  </ControlTemplate>
                </RepeatButton.Template>
              </RepeatButton>
            </Track.DecreaseRepeatButton>
            <Track.Thumb>
              <Thumb MinHeight="28">
                <Thumb.Template>
                  <ControlTemplate TargetType="Thumb">
                    <Border x:Name="pill" CornerRadius="3.5" Background="#D3DED2"/>
                    <ControlTemplate.Triggers>
                      <Trigger Property="IsMouseOver" Value="True">
                        <Setter TargetName="pill" Property="Background" Value="#A9C8BF"/>
                      </Trigger>
                      <Trigger Property="IsDragging" Value="True">
                        <Setter TargetName="pill" Property="Background" Value="#8CB7AF"/>
                      </Trigger>
                    </ControlTemplate.Triggers>
                  </ControlTemplate>
                </Thumb.Template>
              </Thumb>
            </Track.Thumb>
            <Track.IncreaseRepeatButton>
              <RepeatButton Command="ScrollBar.PageDownCommand" Focusable="False">
                <RepeatButton.Template>
                  <ControlTemplate TargetType="RepeatButton">
                    <Border Background="Transparent"/>
                  </ControlTemplate>
                </RepeatButton.Template>
              </RepeatButton>
            </Track.IncreaseRepeatButton>
          </Track>
        </Grid>
      </ControlTemplate>
    </Setter.Value>
  </Setter>
</Style>
'@
$scrollBarStyle = [System.Windows.Markup.XamlReader]::Parse($scrollBarXaml)
$scroll.Resources.Add([System.Windows.Controls.Primitives.ScrollBar], $scrollBarStyle)

$cardPanel = New-Object System.Windows.Controls.StackPanel
$scroll.Content = $cardPanel
# 换经文后正文高度会变，这时自动回到顶部；用户自己滚动不触发（高度没变）。
# 功课页会自己记住滚动位置（展开一行不该被拉回顶部），所以那一页不触发。
$cardPanel.Add_SizeChanged({ if ($script:CardTab -ne 'work') { $scroll.ScrollToVerticalOffset(0) } })

# 读经页的内容整块塞进 readPanel：切到「功课」时整块收起，原来的渲染逻辑一行都不用改。
$readPanel = New-Object System.Windows.Controls.StackPanel

# 卡片分两行：上面可滚动正文，下面固定操作栏，按钮不会被正文顶出视野。
$cardShell = New-Object System.Windows.Controls.Grid
$rowBody = New-Object System.Windows.Controls.RowDefinition
$rowBody.Height = New-Object System.Windows.GridLength 1, 'Star'
$rowFoot = New-Object System.Windows.Controls.RowDefinition
$rowFoot.Height = [System.Windows.GridLength]::Auto
[void]$cardShell.RowDefinitions.Add($rowBody)
[void]$cardShell.RowDefinitions.Add($rowFoot)
[System.Windows.Controls.Grid]::SetRow($scroll, 0)
$cardShell.Children.Add($scroll) | Out-Null

$cardBorder.Child = $cardShell
$stack.Children.Add($cardBorder) | Out-Null

function New-LinkButton {
  param([string]$Label, [string]$Color = $AccentDk, [double]$Size = 11.5)
  $b = New-Object System.Windows.Controls.Button
  $b.Content = $Label
  $b.Foreground = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString($Color)))
  $b.Background = [System.Windows.Media.Brushes]::Transparent
  $b.BorderThickness = New-Object System.Windows.Thickness 0
  $b.Padding = New-Object System.Windows.Thickness 6, 2, 6, 2
  $b.Margin = New-Object System.Windows.Thickness 6, 0, 0, 0
  $b.FontSize = $Size
  $b.FontWeight = 'Bold'
  $b.Cursor = [System.Windows.Input.Cursors]::Hand
  return $b
}

$headRow = New-Object System.Windows.Controls.StackPanel
$headRow.Orientation = 'Horizontal'
$headRow.Margin = (New-Thickness '0,0,0,6')

$txtEyebrow = New-Text -Text '莲鲸手记 · 今日读经' -Size 10 -Color $Muted -Weight 'Bold' -Margin '0,0,0,0'
$txtEyebrow.VerticalAlignment = 'Center'
$txtEyebrow.Width = $WindowWidth - 132

$btnOlder = New-LinkButton -Label '‹' -Color '#8D7A5C' -Size 15
$btnNewer = New-LinkButton -Label '›' -Color '#8D7A5C' -Size 15
$btnOlder.Padding = (New-Thickness '6,0,6,4')
$btnNewer.Padding = (New-Thickness '6,0,6,4')
$btnOlder.ToolTip = '更早一条'
$btnNewer.ToolTip = '更新一条'
$btnOlder.IsEnabled = $false
$btnNewer.IsEnabled = $false
$btnOlder.VerticalAlignment = 'Center'
$btnNewer.VerticalAlignment = 'Center'

$headRow.Children.Add($txtEyebrow) | Out-Null
$headRow.Children.Add($btnOlder) | Out-Null
$headRow.Children.Add($btnNewer) | Out-Null

$txtTitle   = New-Text -Text '般若波罗蜜多心经' -Size 21 -Color $Ink -Family 'KaiTi' -Margin '0,0,0,3'
$txtMeta    = New-Text -Text '' -Size 10.5 -Color $Muted -Margin '0,0,0,6'
$pickerPanel = New-Object System.Windows.Controls.WrapPanel
$pickerPanel.Margin = (New-Thickness '0,0,0,8')
$rule       = New-Object System.Windows.Controls.Border
$rule.Height = 1
$rule.Background = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString('#D9C6A4')))
$rule.Margin = New-Object System.Windows.Thickness 0, 0, 0, 12
$txtLabel1  = New-Text -Text '经文原文' -Size 9.5 -Color $Accent -Weight 'Bold' -Margin '0,0,0,5'
$txtCite    = New-Text -Text '' -Size 16.5 -Color '#43584F' -Family 'KaiTi' -Margin '0,0,0,12' -LineHeight 30
$noteBorder = New-Object System.Windows.Controls.Border
$noteBorder.CornerRadius = New-Object System.Windows.CornerRadius 12
$noteBorder.Background = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString('#F1F6EE')))
$noteBorder.BorderThickness = New-Object System.Windows.Thickness 1
$noteBorder.BorderBrush = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString('#DBE7DB')))
$noteBorder.Padding = New-Object System.Windows.Thickness 11, 10, 11, 10
$noteBorder.Margin = New-Object System.Windows.Thickness 0, 0, 0, 11
$notePanel = New-Object System.Windows.Controls.StackPanel
$txtPlain = New-Text -Text '' -Size 12 -Color $InkSoft -LineHeight 21
$notePanel.Children.Add($txtPlain) | Out-Null
$noteBorder.Child = $notePanel
$txtLabel2 = New-Text -Text '今日练习' -Size 9.5 -Color $Accent -Weight 'Bold' -Margin '0,0,0,5'
$txtPractice = New-Text -Text '' -Size 12 -Color $InkSoft -Margin '0,0,0,4' -LineHeight 21

# 名相：逐条「词 + 解释」
$txtLabelTerms = New-Text -Text '名相' -Size 9.5 -Color $Accent -Weight 'Bold' -Margin '0,0,0,4'
$termsPanel = New-Object System.Windows.Controls.StackPanel
$termsPanel.Margin = (New-Thickness '0,0,0,10')

# --- 尺寸档位：小方块与切换 ---------------------------------------------------
# 三颗小方块（不是胶囊）：圆角 6、纸底、1px #E2D3B6 描边、深色字；当前档换淡青底 + 青描边。
function Set-SizeChipLook {
  param($Chip, [string]$Name)
  if (-not $Chip) { return }
  $active = ($script:SizePreset -eq $Name)
  if ($active) {
    $Chip.Background = New-Brush '#EAF2ED'
    $Chip.BorderBrush = New-Brush '#8CB7AF'
  } else {
    $Chip.Background = New-Brush '#FFFBF2'
    $Chip.BorderBrush = New-Brush '#E2D3B6'
  }
  $tb = $Chip.Child
  if ($tb) {
    $color = '#7A6A4E'
    $weight = 'Normal'
    if ($active) { $color = '#2F5D55'; $weight = 'Bold' }
    $tb.Foreground = New-Brush $color
    $tb.FontWeight = ConvertTo-FontWeight $weight
  }
}

function New-SizeChip {
  param([string]$Name, [string]$Label)
  $chip = New-Object System.Windows.Controls.Border
  $chip.CornerRadius = New-Object System.Windows.CornerRadius 6
  $chip.BorderThickness = New-Object System.Windows.Thickness 1
  $chip.Padding = New-Thickness '9,2,9,3'
  $chip.Margin = New-Thickness '4,0,0,0'
  $chip.Cursor = [System.Windows.Input.Cursors]::Hand
  $chip.Tag = $Name
  $chip.Child = (New-Text -Text $Label -Size 10 -Color '#7A6A4E' -Weight 'Normal')
  $script:SizeChips[$Name] = $chip
  Set-SizeChipLook -Chip $chip -Name $Name
  # 和 tab / 经书胶囊一样用 Preview（隧道）事件，别被外层吃掉
  $chip.Add_PreviewMouseLeftButtonUp({
      try {
        $name = [string]$this.Tag
        if ($name) {
          Apply-PetSize $name
          Save-SizePreset $name
        }
      } catch { }
    })
  return $chip
}

function Update-SizeChips {
  foreach ($key in $SizePresets.Keys) {
    Set-SizeChipLook -Chip $script:SizeChips[$key] -Name $key
  }
}

function Read-SizePreset {
  try {
    if (-not $PetStatePath -or -not (Test-Path $PetStatePath)) { return 'large' }
    $raw = [IO.File]::ReadAllText($PetStatePath)
    if (-not $raw -or -not $raw.Trim()) { return 'large' }
    $saved = [string]($raw | ConvertFrom-Json).sizePreset
    if ($SizePresets.Contains($saved)) { return $saved }
  } catch { }
  return 'large'
}

function Save-SizePreset {
  param([string]$Name)
  try {
    if (-not $PetStatePath) { return }
    $dir = [IO.Path]::GetDirectoryName($PetStatePath)
    if ($dir -and -not (Test-Path $dir)) { [void][IO.Directory]::CreateDirectory($dir) }
    $payload = @{ sizePreset = $Name } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($PetStatePath, $payload, (New-Object System.Text.UTF8Encoding($false)))
  } catch { }
}

function Apply-PetSize {
  param([string]$Name)
  if (-not $Name -or -not $SizePresets.Contains($Name)) { $Name = 'large' }
  $script:SizePreset = $Name
  $script:PetScale = [double]$SizePresets[$Name]
  try {
    $script:PetScaleTx.ScaleX = $script:PetScale
    $script:PetScaleTx.ScaleY = $script:PetScale
  } catch { }
  Update-SizeChips
  # 窗口高度就是内容高度：缩小后要跟着收（否则上面留一块看不见的透明窗），
  # 放大后也可能顶出屏幕 —— Fit-WindowHeight 会贴回底边并夹进工作区，这里再兜一次左右。
  try {
    $window.UpdateLayout()
    Fit-WindowHeight
    $wa = Get-WindowWorkArea
    $w = $window.Width
    $h = $window.Height
    if (($window.Left + $w) -gt $wa.Right) { $window.Left = $wa.Right - $w }
    if ($window.Left -lt $wa.Left) { $window.Left = $wa.Left }
    if (($window.Top + $h) -gt $wa.Bottom) { $window.Top = $wa.Bottom - $h }
    if ($window.Top -lt $wa.Top) { $window.Top = $wa.Top }
  } catch { }
}
$btnRow = New-Object System.Windows.Controls.StackPanel
$btnRow.Orientation = 'Horizontal'
$btnRow.HorizontalAlignment = 'Right'
$btnRow.Margin = New-Object System.Windows.Thickness 0, 8, 4, 0

# 固定页脚：分隔线 + 操作栏 + 状态行
$footBorder = New-Object System.Windows.Controls.Border
$footBorder.BorderThickness = New-Object System.Windows.Thickness 0, 1, 0, 0
$footBorder.BorderBrush = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString('#EADCC2')))
$footBorder.Padding = New-Object System.Windows.Thickness 16, 2, 14, 10
$footBorder.Margin = New-Object System.Windows.Thickness 0, 4, 0, 0

$footPanel = New-Object System.Windows.Controls.StackPanel
$footBorder.Child = $footPanel


$btnClose = New-LinkButton -Label '收起' -Color '#7A8F88'
$btnNext  = New-LinkButton -Label '再读一句'
$btnMore  = New-LinkButton -Label '展开全文' -Color '#7A8F88'
$btnMore.ToolTip = '把这一句的白话与练习展开或收起'
# 功课页专用：手动拉一次 work.json（不点也会自动每 5 秒拉）
$btnRefresh = New-LinkButton -Label '刷新' -Color '#7A8F88'
$btnRefresh.Visibility = 'Collapsed'
$btnRow.Children.Add($btnRefresh) | Out-Null
$btnRow.Children.Add($btnMore) | Out-Null
$btnRow.Children.Add($btnClose) | Out-Null
$btnRow.Children.Add($btnNext) | Out-Null
# 尺寸档和操作按钮排同一行：左边「尺寸 大 中 小」，右边还是原来的刷新/收起/再读一句。
# 一块 Grid 分两列，别挤成一串。
$sizeRow = New-Object System.Windows.Controls.StackPanel
$sizeRow.Orientation = 'Horizontal'
$sizeRow.HorizontalAlignment = 'Left'
$sizeRow.VerticalAlignment = 'Center'
$sizeLabel = New-Text -Text '尺寸' -Size 9.5 -Color '#A08A68' -Weight 'Bold' -Margin '2,0,0,0'
$sizeLabel.VerticalAlignment = 'Center'
$sizeRow.Children.Add($sizeLabel) | Out-Null
foreach ($sizeKey in $SizePresets.Keys) {
  $sizeRow.Children.Add((New-SizeChip -Name $sizeKey -Label $SizeLabels[$sizeKey])) | Out-Null
}

$footActionRow = New-Object System.Windows.Controls.Grid
$faCol0 = New-Object System.Windows.Controls.ColumnDefinition
$faCol0.Width = New-Object System.Windows.GridLength 1, 'Star'
$faCol1 = New-Object System.Windows.Controls.ColumnDefinition
$faCol1.Width = [System.Windows.GridLength]::Auto
[void]$footActionRow.ColumnDefinitions.Add($faCol0)
[void]$footActionRow.ColumnDefinitions.Add($faCol1)
[System.Windows.Controls.Grid]::SetColumn($sizeRow, 0)
[System.Windows.Controls.Grid]::SetColumn($btnRow, 1)
$footActionRow.Children.Add($sizeRow) | Out-Null
$footActionRow.Children.Add($btnRow) | Out-Null

$txtStatus = New-Text -Text '' -Size 9 -Color '#C07D6F' -Margin '0,6,0,0'

$readPanel.Children.Add($headRow) | Out-Null
$readPanel.Children.Add($txtTitle) | Out-Null
$readPanel.Children.Add($txtMeta) | Out-Null
$readPanel.Children.Add($pickerPanel) | Out-Null
$readPanel.Children.Add($rule) | Out-Null
$readPanel.Children.Add($txtLabel1) | Out-Null
$readPanel.Children.Add($txtCite) | Out-Null
$readPanel.Children.Add($noteBorder) | Out-Null
$readPanel.Children.Add($txtLabelTerms) | Out-Null
$readPanel.Children.Add($termsPanel) | Out-Null
$readPanel.Children.Add($txtLabel2) | Out-Null
$readPanel.Children.Add($txtPractice) | Out-Null

# --- 功课面板：静态骨架 -------------------------------------------------------
# 会话行是数据驱动的，每次数据变了在 Render-Work 里重建；这里只搭 tab 条和容器。
$tabBar = New-Object System.Windows.Controls.StackPanel
$tabBar.Orientation = 'Horizontal'
$tabBar.Margin = (New-Thickness '0,0,0,10')

$txtWorkEyebrow = New-Text -Text '莲鲸手记 · 功课' -Size 10 -Color $Muted -Weight 'Bold' -Margin '0,0,0,2'

$workTitleRow = New-Object System.Windows.Controls.Grid
$wtCol0 = New-Object System.Windows.Controls.ColumnDefinition
$wtCol0.Width = New-Object System.Windows.GridLength 1, 'Star'
$wtCol1 = New-Object System.Windows.Controls.ColumnDefinition
$wtCol1.Width = [System.Windows.GridLength]::Auto
[void]$workTitleRow.ColumnDefinitions.Add($wtCol0)
[void]$workTitleRow.ColumnDefinitions.Add($wtCol1)

$txtWorkTitle = New-Text -Text '手上的活' -Size 20 -Color $Ink -Family 'KaiTi' -Margin '0,0,0,0'
$txtWorkTitle.VerticalAlignment = 'Bottom'
$txtWorkMeta = New-Text -Text '' -Size 10.5 -Color $Muted -Weight 'Bold' -Margin '0,0,2,3'
$txtWorkMeta.HorizontalAlignment = 'Right'
$txtWorkMeta.VerticalAlignment = 'Bottom'
[System.Windows.Controls.Grid]::SetColumn($txtWorkTitle, 0)
[System.Windows.Controls.Grid]::SetColumn($txtWorkMeta, 1)
$workTitleRow.Children.Add($txtWorkTitle) | Out-Null
$workTitleRow.Children.Add($txtWorkMeta) | Out-Null

$workRule = New-Object System.Windows.Controls.Border
$workRule.Height = 1
$workRule.Background = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString('#D9C6A4')))
$workRule.Margin = New-Object System.Windows.Thickness 0, 7, 0, 6

$workList = New-Object System.Windows.Controls.StackPanel
$txtWorkNote = New-Text -Text '' -Size 9.5 -Color '#A89A80' -Margin '2,8,0,2'

$workPanel = New-Object System.Windows.Controls.StackPanel
$workPanel.Visibility = 'Collapsed'
$workPanel.Children.Add($txtWorkEyebrow) | Out-Null
$workPanel.Children.Add($workTitleRow) | Out-Null
$workPanel.Children.Add($workRule) | Out-Null
$workPanel.Children.Add($workList) | Out-Null
$workPanel.Children.Add($txtWorkNote) | Out-Null

$cardPanel.Children.Add($tabBar) | Out-Null
$cardPanel.Children.Add($readPanel) | Out-Null
$cardPanel.Children.Add($workPanel) | Out-Null

$footPanel.Children.Add($footActionRow) | Out-Null
$footPanel.Children.Add($txtStatus) | Out-Null
[System.Windows.Controls.Grid]::SetRow($footBorder, 1)
$cardShell.Children.Add($footBorder) | Out-Null


# --- 立绘 + 徽标 -------------------------------------------------------------
$petHost = New-Object System.Windows.Controls.Grid
$petHost.HorizontalAlignment = 'Center'
$petHost.Margin = New-Object System.Windows.Thickness 0, 0, 0, 4

# 用 ImageBrush 画立绘：Stretch=Uniform 会稳定地把整张图缩进固定尺寸的框，
# 比 Image + Uniform 在不同 DPI 下更可控（后者曾被放大裁切）。
$petImage = New-Object System.Windows.Controls.Border
$petImage.Width = [int]($PetHeight * 0.96)
$petImage.Height = $PetHeight
$petImage.Cursor = [System.Windows.Input.Cursors]::Hand
# 不要在立绘上挂 ToolTip：悬停一秒后弹出的气泡会挡住点击，让人以为「点了没反应」。
# 提示改用窗口里的小字。

$petBrush = New-Object System.Windows.Media.ImageBrush
$petBrush.Stretch = 'Uniform'
$petImage.Background = $petBrush
$petHost.Children.Add($petImage) | Out-Null
# --- 佛光 ---------------------------------------------------------------------
# 有活在跑时，立绘背后那一圈慢慢转的金色光（网页端 .fj-halo 的桌面版）。
# 素材是网页 conic-gradient 烘好的 512×512 PNG；加载失败就静默跳过，不能让壳起不来。
# 尺寸/位置照网页端比例换算，不写死像素：网页立绘 196px 时佛光圆 206px、
# 圆心在立绘顶部往下 104px（≈53% 高度），这里按立绘实际显示高度等比缩。
$script:HaloDiameterRatio = 206.0 / 196.0
$script:HaloCenterRatio = 104.0 / 196.0
$script:HaloOn = $false
$script:HaloImage = $null
$script:HaloBox = $null

# 佛光圆比立绘大一圈（直径约 1.05 倍）：直接挂在 $petHost 里会把 Grid 撑大，
# 把立绘和下面那排标签整体往下挤。所以套一层「和立绘同尺寸」的盒子：
# 盒子参与布局但不裁剪，佛光超出的部分照样画出来，布局一点都不变。
function Update-HaloLayout {
  try {
    if (-not $script:HaloBox -or -not $script:HaloImage) { return }
    $petH = [double]$petImage.Height
    if ($petH -le 0) { return }
    $petW = [double]$petImage.Width
    if ($petW -le 0) { $petW = [int]($petH * 0.96) }
    $d = $petH * $script:HaloDiameterRatio
    $script:HaloBox.Width = $petW
    $script:HaloBox.Height = $petH
    $script:HaloImage.Width = $d
    $script:HaloImage.Height = $d
    # 圆心落在立绘高度的 53%：图顶边 = 0.53H - D/2（网页端 104 - 103 = 1px）
    $top = ($petH * $script:HaloCenterRatio) - ($d / 2)
    if ($top -lt 0) { $top = 0 }
    $script:HaloImage.Margin = New-Object System.Windows.Thickness 0, $top, 0, 0
  } catch { }
}

# 在跑 <-> 不跑：淡入淡出各 0.42s；不跑时淡完再 Collapsed（网页端没活就整个不渲染）
function Set-HaloRunning {
  param([bool]$Running)
  try {
    if (-not $script:HaloImage) { return }
    if ($script:HaloOn -eq $Running) { return }
    $script:HaloOn = $Running
    $duration = [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(420))
    if ($Running) {
      $script:HaloImage.Visibility = 'Visible'
      $fade = New-Object System.Windows.Media.Animation.DoubleAnimation
      $fade.From = 0.0
      $fade.To = 1.0
      $fade.Duration = $duration
      $script:HaloImage.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $fade)
    } else {
      $fade = New-Object System.Windows.Media.Animation.DoubleAnimation
      $fade.From = 1.0
      $fade.To = 0.0
      $fade.Duration = $duration
      $fade.Add_Completed({
          # 淡出期间又被拉回「在跑」就别收
          try { if (-not $script:HaloOn -and $script:HaloImage) { $script:HaloImage.Visibility = 'Collapsed' } } catch { }
        })
      $script:HaloImage.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $fade)
    }
  } catch { }
}

try {
  $haloPath = Join-Path $AssetDir 'halo.png'
  if (Test-Path $haloPath) {
    $haloBox = New-Object System.Windows.Controls.Grid
    $haloBox.HorizontalAlignment = 'Center'
    $haloBox.VerticalAlignment = 'Top'
    $haloBox.IsHitTestVisible = $false
    $haloBox.Focusable = $false
    $halo = New-Object System.Windows.Controls.Image
    $halo.Stretch = 'Uniform'
    $halo.HorizontalAlignment = 'Center'
    $halo.VerticalAlignment = 'Top'
    $halo.IsHitTestVisible = $false
    $halo.Focusable = $false
    $halo.Visibility = 'Collapsed'
    $halo.Opacity = 0.0
    $halo.RenderTransformOrigin = New-Object System.Windows.Point 0.5, 0.5
    $haloSpin = New-Object System.Windows.Media.RotateTransform 0.0
    $halo.RenderTransform = $haloSpin
    # 和网页同一步调：一圈 5.5 秒、线性、永远转（隐藏时转不转看不出来，不折腾启停）
    $haloSpinAnim = New-Object System.Windows.Media.Animation.DoubleAnimation
    $haloSpinAnim.From = 0.0
    $haloSpinAnim.To = 360.0
    $haloSpinAnim.Duration = [System.Windows.Duration]::new([TimeSpan]::FromSeconds(5.5))
    $haloSpinAnim.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever
    $haloSpin.BeginAnimation([System.Windows.Media.RotateTransform]::AngleProperty, $haloSpinAnim)
    # CacheOption=OnLoad：解码完立刻 Freeze，别占着文件句柄
    $haloBmp = New-Object System.Windows.Media.Imaging.BitmapImage
    $haloBmp.BeginInit()
    $haloBmp.CacheOption = 'OnLoad'
    $haloBmp.UriSource = New-Object System.Uri $haloPath
    $haloBmp.EndInit()
    $haloBmp.Freeze()
    $halo.Source = $haloBmp
    $haloBox.Children.Add($halo) | Out-Null
    # 插到第 0 个：Grid 的绘制顺序就是子元素顺序，佛光必须在立绘下面
    $petHost.Children.Insert(0, $haloBox) | Out-Null
    $script:HaloBox = $haloBox
    $script:HaloImage = $halo
    Update-HaloLayout
  }
} catch {
  # 佛光是装饰：素材缺失/解码失败就静默降级，壳照常起
  $script:HaloBox = $null
  $script:HaloImage = $null
}

# 飘字层：敲木鱼的「功德 +1」在这一层往上飘。纯装饰，绝不参与命中测试。
$floatLayer = New-Object System.Windows.Controls.Canvas
$floatLayer.IsHitTestVisible = $false
$petHost.Children.Add($floatLayer) | Out-Null

# 右上角「灵感」光点：不再写数字，改成一团会呼吸的淡金光；点它 = 展开/收起卡片。
$badge = New-Object System.Windows.Controls.Grid
$badge.Width = 24
$badge.Height = 24
$badge.HorizontalAlignment = 'Right'
$badge.VerticalAlignment = 'Top'
# 往内收一截：离上边 16、离右边 10（原来是 6/6，贴角显得占地）
$badge.Margin = New-Object System.Windows.Thickness 0, 19, 13, 0
$badge.Background = [System.Windows.Media.Brushes]::Transparent
$badge.Cursor = [System.Windows.Input.Cursors]::Hand

# 光晕：径向渐变 + 透明度/直径呼吸（约 2.2 秒一个来回）
$badgeGlow = New-Object System.Windows.Shapes.Ellipse
$badgeGlow.Width = 32
$badgeGlow.Height = 32
$badgeGlow.HorizontalAlignment = 'Center'
$badgeGlow.VerticalAlignment = 'Center'
$badgeGlow.RenderTransformOrigin = New-Object System.Windows.Point 0.5, 0.5
$badgeGlowScale = New-Object System.Windows.Media.ScaleTransform 1.0, 1.0
$badgeGlow.RenderTransform = $badgeGlowScale
$badgeGlowBrush = New-Object System.Windows.Media.RadialGradientBrush
$badgeGlowBrush.GradientStops.Add((New-Object System.Windows.Media.GradientStop ([System.Windows.Media.Color][System.Windows.Media.ColorConverter]::ConvertFromString('#AFF6E0A8'), 0.0)))
$badgeGlowBrush.GradientStops.Add((New-Object System.Windows.Media.GradientStop ([System.Windows.Media.Color][System.Windows.Media.ColorConverter]::ConvertFromString('#5AEFD08E'), 0.45)))
$badgeGlowBrush.GradientStops.Add((New-Object System.Windows.Media.GradientStop ([System.Windows.Media.Color][System.Windows.Media.ColorConverter]::ConvertFromString('#00F2D79B'), 1.0)))
$badgeGlow.Fill = $badgeGlowBrush
$badge.Children.Add($badgeGlow) | Out-Null

# 芯：11 DIP 暖白到淡金的小圆点，不带数字；最外圈淡到全透明，不留描边那圈硬边
$badgeCore = New-Object System.Windows.Shapes.Ellipse
$badgeCore.Width = 11
$badgeCore.Height = 11
$badgeCore.HorizontalAlignment = 'Center'
$badgeCore.VerticalAlignment = 'Center'
$badgeCoreBrush = New-Object System.Windows.Media.RadialGradientBrush
$badgeCoreBrush.GradientStops.Add((New-Object System.Windows.Media.GradientStop ([System.Windows.Media.Color][System.Windows.Media.ColorConverter]::ConvertFromString('#FFFFFCF2'), 0.0)))
$badgeCoreBrush.GradientStops.Add((New-Object System.Windows.Media.GradientStop ([System.Windows.Media.Color][System.Windows.Media.ColorConverter]::ConvertFromString('#FFF7E4B8'), 0.5)))
$badgeCoreBrush.GradientStops.Add((New-Object System.Windows.Media.GradientStop ([System.Windows.Media.Color][System.Windows.Media.ColorConverter]::ConvertFromString('#70EFD08E'), 0.8)))
$badgeCoreBrush.GradientStops.Add((New-Object System.Windows.Media.GradientStop ([System.Windows.Media.Color][System.Windows.Media.ColorConverter]::ConvertFromString('#00E7C887'), 1.0)))
$badgeCore.Fill = $badgeCoreBrush
$badge.Children.Add($badgeCore) | Out-Null
$petHost.Children.Add($badge) | Out-Null

# 呼吸动画：光晕透明度 0.20 <-> 0.95、直径 0.92 <-> 1.12；AutoReverse + Forever
$badgeBreath = New-Object System.Windows.Media.Animation.DoubleAnimation
$badgeBreath.From = 0.20
$badgeBreath.To = 0.95
$badgeBreath.Duration = [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(1100))
$badgeBreath.AutoReverse = $true
$badgeBreath.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever
$badgeGlow.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $badgeBreath)
$badgeScale = New-Object System.Windows.Media.Animation.DoubleAnimation
$badgeScale.From = 0.92
$badgeScale.To = 1.12
$badgeScale.Duration = [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(1100))
$badgeScale.AutoReverse = $true
$badgeScale.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever
$badgeGlowScale.BeginAnimation([System.Windows.Media.ScaleTransform]::ScaleXProperty, $badgeScale)
$badgeGlowScale.BeginAnimation([System.Windows.Media.ScaleTransform]::ScaleYProperty, $badgeScale)

# 立绘 + 飘字层 + 光点 + 底部标签一起包进 $petGroup：尺寸档位只在它身上挂一个
# LayoutTransform，四块按同一比例缩，连它们之间的间距也一起缩。
# HorizontalAlignment=Center + 按内容定宽：LayoutTransform 绕左上角缩放，
# 只有布局槽等于缩放后的宽度、居中交给父容器，整只宠物才不会往左偏。
$petGroup = New-Object System.Windows.Controls.StackPanel
$petGroup.HorizontalAlignment = 'Center'
$script:PetScaleTx = New-Object System.Windows.Media.ScaleTransform 1.0, 1.0
$petGroup.LayoutTransform = $script:PetScaleTx
$petGroup.Children.Add($petHost) | Out-Null
$stack.Children.Add($petGroup) | Out-Null

# 立绘下面的小标签：跟网页里的 .fj-tag 同一套语义（状态点 + 一行字）。
# 有功课在跑时改成「N 个在跑」；否则保持原来的说法：静坐中 / 翻经中 / MM:SS 后再读。
$tagBorder = New-Object System.Windows.Controls.Border
$tagBorder.CornerRadius = New-Object System.Windows.CornerRadius 6
$tagBorder.Background = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString('#FFFBF2')))
$tagBorder.BorderThickness = New-Object System.Windows.Thickness 1
$tagBorder.BorderBrush = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString('#E2D3B6')))
$tagBorder.Padding = New-Object System.Windows.Thickness 9, 2, 9, 3
$tagBorder.HorizontalAlignment = 'Center'
$tagBorder.Margin = New-Object System.Windows.Thickness 0, 3, 0, 2

$tagLine = New-Object System.Windows.Controls.StackPanel
$tagLine.Orientation = 'Horizontal'
$tagDot = New-Object System.Windows.Shapes.Ellipse
$tagDot.Width = 5.5
$tagDot.Height = 5.5
$tagDot.Fill = New-Brush '#8CB7AF'
$tagDot.Margin = New-Object System.Windows.Thickness 0, 0, 5, 0
$tagDot.VerticalAlignment = 'Center'
$tagText = New-Text -Text '静坐中' -Size 10 -Color '#3F5F5C' -Weight 'Bold'
$tagText.VerticalAlignment = 'Center'
$tagLine.Children.Add($tagDot) | Out-Null
$tagLine.Children.Add($tagText) | Out-Null
$tagBorder.Child = $tagLine

# 小标签一行：状态标签 + 「已积功德 N」（只要拿到数据就常显，没敲过显示 0）
$tagRow = New-Object System.Windows.Controls.StackPanel
$tagRow.Orientation = 'Horizontal'
$tagRow.HorizontalAlignment = 'Center'
$tagRow.Children.Add($tagBorder) | Out-Null

$knockBorder = New-Object System.Windows.Controls.Border
$knockBorder.CornerRadius = New-Object System.Windows.CornerRadius 6
$knockBorder.Background = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString('#FFFBF2')))
$knockBorder.BorderThickness = New-Object System.Windows.Thickness 1
$knockBorder.BorderBrush = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString('#E2D3B6')))
$knockBorder.Padding = New-Object System.Windows.Thickness 9, 2, 9, 3
$knockBorder.Margin = New-Object System.Windows.Thickness 6, 3, 0, 2
$knockBorder.Visibility = 'Visible'
$knockText = New-Text -Text '已积功德 0' -Size 10 -Color '#7A6A4E' -Weight 'Bold'
$knockText.VerticalAlignment = 'Center'
$knockBorder.Child = $knockText
$tagRow.Children.Add($knockBorder) | Out-Null

$petGroup.Children.Add($tagRow) | Out-Null

# --- 状态 -------------------------------------------------------------------
$script:State = $null
$script:Busy = $false
$script:ShowingStudy = $false
$script:Sutra = $null

# --- 功课面板状态 -----------------------------------------------------------
$script:CardTab = 'work'         # work | read（功课是默认页，tab 排在左边）
$script:WorkData = $null         # 最近一次成功拉到的 work.json
$script:WorkFailed = $false      # 上一拍失败（有旧数据就继续用旧的）
$script:WorkOpenId = ''          # 展开的那一行（同一时间只展开一行）
$script:ClosedProjects = @{}     # 收起的项目组（键=项目名）。数据每 5 秒重建行时不清掉，折叠状态要活着
$script:WorkPending = $null      # 飞行中的异步请求
$script:WorkRunspace = $null     # 复用的后台 runspace：网络请求不在 UI 线程上跑
$script:WorkSignature = ''       # 数据指纹：没变就不重建行，免得每 5 秒闪一下
$script:NextWorkAt = [DateTime]::MinValue

$spriteIdle = Join-Path $AssetDir 'pet-idle.png'
$spriteOpen = Join-Path $AssetDir 'pet-open.png'
$spriteRead = Join-Path $AssetDir 'pet-read.png'
$spriteKnock = Join-Path $AssetDir 'pet-knock.png'

function Set-PetImage {
  param([string]$Kind)
  # 眼神会按秒重算，同一张图不要反复解码
  if ($script:PetKind -eq $Kind -and $petBrush.ImageSource) { return }
  $path = switch ($Kind) {
    'open' { $spriteOpen }
    'read' { $spriteRead }
    'knock' { $script:KnockSpritePath }
    default { $spriteIdle }
  }
  # 没有敲木鱼那张图（还没生成/没下到）就保持原样，不换、不报错
  if ($Kind -eq 'knock' -and (-not $path -or -not (Test-Path $path))) { return }
  if (-not (Test-Path $path)) { $path = $spriteIdle }
  if (-not (Test-Path $path)) { return }
  $bmp = New-Object System.Windows.Media.Imaging.BitmapImage
  $bmp.BeginInit()
  $bmp.CacheOption = 'OnLoad'
  $bmp.UriSource = New-Object System.Uri $path
  $bmp.EndInit()
  $bmp.Freeze()
  $petBrush.ImageSource = $bmp
  $script:PetKind = $Kind
}

# --- 眼神 -------------------------------------------------------------------
# 闭眼入定 / 垂目看经 / 睁眼看你——三种眼神是三种注意力朝向。
# 睁眼只在「跟你发生关系」的那一拍（点开、收起、读完、被拖动），到期自己落回去。
$script:PetKind = ''
$script:LookUntil = [DateTime]::MinValue

function Set-Look {
  param([int]$Ms)
  $script:LookUntil = [DateTime]::Now.AddMilliseconds($Ms)
}

function Update-PetImage {
  # 敲木鱼的 420ms 里别抢图
  if ($script:KnockUntil -ne [DateTime]::MinValue -and [DateTime]::Now -lt $script:KnockUntil) { return }
  if ([DateTime]::Now -lt $script:LookUntil) { Set-PetImage 'open'; return }
  if ($script:ShowingStudy -or $script:ShowingCard) { Set-PetImage 'read'; return }
  # 有未读不常亮（那是干瞪眼）：每 20 秒抬眼看你两三秒就走
  if ($script:State -and $script:State.unread -gt 0 -and ([DateTime]::Now.Second % 20) -lt 3) {
    Set-PetImage 'open'
    return
  }
  Set-PetImage 'idle'
}

function Set-CardSize {
  param([bool]$open)
  $petH = if ($open) { $OpenPetHeight } else { $PetHeight }
  # 尺寸档缩的是 LayoutTransform：这里按比例先估窗口高度，随后 Fit-WindowHeight 再精确修
  $scaledPet = [int][Math]::Ceiling($petH * $script:PetScale)
  $height = if ($open) { $CardHeight + $scaledPet + 40 } else { $scaledPet + 40 }
  # 展开时把立绘缩小，把省下的纵向空间让给经文与释义
  $petImage.Height = $petH
  $petImage.Width = [int]($petH * 0.96)
  Update-HaloLayout
  $bottom = $window.Top + $window.Height
  $window.Height = $height
  $wa = Get-WindowWorkArea
  $window.Top = [Math]::Max($wa.Top, $bottom - $height)
}

# --- 多显示器 -----------------------------------------------------------------
# SystemParameters.WorkArea 只认主屏。DSH 摆在副屏上时，按主屏算位置会把她
# 扔到另一块屏幕的角落——看起来就是「点了放她到桌面，人就不见了」。
# 统一改成：谁在光标底下就按哪块屏幕算；判断在不在屏上则看所有屏幕。
function Convert-PhysicalRectToDip {
  param($Rect)
  $s = Get-DpiScale
  if (-not $s -or $s -le 0) { $s = 1.0 }
  return [pscustomobject]@{
    Left   = $Rect.Left / $s
    Top    = $Rect.Top / $s
    Right  = $Rect.Right / $s
    Bottom = $Rect.Bottom / $s
  }
}

function Get-CursorWorkArea {
  $scr = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position)
  return Convert-PhysicalRectToDip $scr.WorkingArea
}

function Get-WindowWorkArea {
  $p = $window.PointToScreen([System.Windows.Point]::new($window.Width / 2, $window.Height / 2))
  $scr = [System.Windows.Forms.Screen]::FromPoint([System.Drawing.Point]::new([int]$p.X, [int]$p.Y))
  return Convert-PhysicalRectToDip $scr.WorkingArea
}

# 按内容实际高度定窗口高度：写死常数会在换经书/长释义时把卡片顶部裁掉。
function Fit-WindowHeight {
  $window.UpdateLayout()
  $wa = Get-WindowWorkArea
  $available = $wa.Bottom - $wa.Top
  $need = [Math]::Ceiling($stack.ActualHeight) + 4
  $floor = [int][Math]::Ceiling($PetHeight * $script:PetScale) + 20
  $target = [Math]::Max($floor, [Math]::Min($need, $available))
  $bottom = $window.Top + $window.Height
  $window.Height = $target
  $window.Top = [Math]::Max($wa.Top, $bottom - $target)
}

# 把窗口放到「鼠标所在那块屏」的右下角：用户刚点完按钮，光标就在他眼前那块屏上。
function Reset-PetPosition {
  $wa = Get-CursorWorkArea
  $window.Left = [Math]::Max($wa.Left, $wa.Right - $window.Width - 24)
  $window.Top = [Math]::Max($wa.Top, $wa.Bottom - $window.Height - 16)
}

# 只要窗口中心落在任意一块屏幕上就算「在屏内」，不再是只在主屏里才算。
function Test-OnScreen {
  try {
    $p = $window.PointToScreen([System.Windows.Point]::new($window.Width / 2, $window.Height / 2))
    foreach ($scr in [System.Windows.Forms.Screen]::AllScreens) {
      $b = $scr.Bounds
      if ($p.X -ge $b.Left -and $p.X -le $b.Right -and $p.Y -ge $b.Top -and $p.Y -le $b.Bottom) { return $true }
    }
    return $false
  } catch {
    return $true
  }
}

function Show-Error {
  param([string]$Message)
  $txtStatus.Text = '离线 · ' + $Message
}

function Get-PageCard {
  $cards = @($script:State.cards)
  if ($cards.Count -eq 0) { return $null }
  if ($script:PinnedId) {
    $found = $cards | Where-Object { $_.id -eq $script:PinnedId } | Select-Object -First 1
    if ($found) { return $found }
  }
  $idx = [Math]::Max(0, [Math]::Min($script:PageIndex, $cards.Count - 1))
  return $cards[$idx]
}

function Render-Card {
  if (-not $script:State) { return }
  # 在功课页时读经卡片是收起的：重建它没有意义，还会把功课页的滚动位置拉回顶部
  if ($script:CardTab -eq 'work') { return }
  $cards = @($script:State.cards)
  $card = Get-PageCard
  if (-not $card) {
    $txtEyebrow.Text = '莲鲸手记 · 今日读经'
    $txtTitle.Text = '还没有读过的经文'
    $txtMeta.Text = ''
    $pickerPanel.Children.Clear()
    $txtCite.Text = ''
    $noteBorder.Visibility = 'Collapsed'
    $txtLabelTerms.Visibility = 'Collapsed'
    $termsPanel.Visibility = 'Collapsed'
    $txtLabel2.Visibility = 'Collapsed'
    $txtPractice.Text = ''
    $btnOlder.IsEnabled = $false
    $btnNewer.IsEnabled = $false
    return
  }
  $idx = 0
  for ($i = 0; $i -lt $cards.Count; $i++) {
    if ($cards[$i].id -eq $card.id) { $idx = $i; break }
  }
  $script:PageIndex = $idx
  $script:PinnedId = $card.id
  $txtEyebrow.Text = '莲鲸手记 · 今日读经'
  $txtTitle.Text = $card.fullTitle
  $unit = '句'
  if ($card.unit) { $unit = $card.unit }
  $meta = "$($card.sutraTitle) · 第 $($card.no) $unit / 共 $($card.total) $unit"
  if ($card.label) { $meta = "$($card.sutraTitle) · 第 $($card.no) $unit · $($card.label)" }
  $txtMeta.Text = $meta
  # 经书选择器：每张卡片按当前语料重建，命中的那部高亮
  $pickerPanel.Children.Clear()
  $sutras = @()
  if ($script:State -and $script:State.corpus) { $sutras = @($script:State.corpus.sutras) }
  foreach ($item in $sutras) {
    if (-not $item -or -not $item.id) { continue }
    $isActive = ($item.id -eq $card.sutraId)
    $tip = "$($item.fullTitle)"
    $chip = New-SutraChip -Title $item.title -SutraId $item.id -Active $isActive -Tip $tip
    $pickerPanel.Children.Add($chip) | Out-Null
  }
  $txtCite.Text = $card.cite.text
  $txtPlain.Text = $card.gist
  $txtPractice.Text = $card.practice
  # 名相逐条重建
  $termsPanel.Children.Clear()
  $hasTerms = $false
  if ($card.terms) {
    foreach ($term in @($card.terms)) {
      if (-not $term -or -not $term.word) { continue }
      $txtWord = New-Text -Text $term.word -Size 11 -Color '#4F7368' -Weight 'Bold' -Margin '0,3,0,0'
      $txtGloss = New-Text -Text $term.gloss -Size 10.5 -Color '#5C7168' -LineHeight 18
      $termsPanel.Children.Add($txtWord) | Out-Null
      $termsPanel.Children.Add($txtGloss) | Out-Null
      $hasTerms = $true
    }
  }
  $txtLabelTerms.Visibility = 'Collapsed'
  $termsPanel.Visibility = 'Collapsed'
  $noteBorder.Visibility = 'Collapsed'
  $txtLabel2.Visibility = 'Collapsed'
  $txtLabel2.Text = '今日练习'
  if ($script:ShowExtra) {
    if ($hasTerms) {
      $txtLabelTerms.Visibility = 'Visible'
      $termsPanel.Visibility = 'Visible'
    }
    $noteBorder.Visibility = 'Visible'
    $txtLabel2.Visibility = 'Visible'
  }
  # 换卡后回到顶部：ScrollViewer 会保留上一次的偏移。
  $scroll.UpdateLayout()
  $scroll.ScrollToVerticalOffset(0)
  $btnMore.Content = '收起释义'
  if (-not $script:ShowExtra) { $btnMore.Content = '展开释义' }
  $btnOlder.IsEnabled = ($idx -lt $cards.Count - 1)
  $btnNewer.IsEnabled = ($idx -gt 0)

}

function Step-Page {
  param([int]$Delta)
  $cards = @($script:State.cards)
  if ($cards.Count -eq 0) { return }
  $next = [Math]::Max(0, [Math]::Min($script:PageIndex + $Delta, $cards.Count - 1))
  $script:PageIndex = $next
  $target = $cards[$next]
  $script:PinnedId = $target.id
  Render-Card
  if ($target -and -not $target.read) {
    try { Invoke-PetApi -Method 'POST' -Url $ReadUrl -Body @{ id = $target.id } | Out-Null } catch { }
    $script:State = Invoke-PetApi -Url $StateUrl
    Update-PetImage
  }
}

$script:ShowingCard = $false
$script:ShowExtra = $true
$script:PageIndex = 0
$script:PinnedId = $null

function Refresh-State {
  try {
    $script:State = Invoke-PetApi -Url $StateUrl
    $txtStatus.Text = ''
    if (-not $script:ShowingStudy) { Render-Card }
    # 光点不消失：有未读亮一点，没未读暗一点（它同时也是展开卡片的入口）
    $badge.Opacity = 0.60
    if ($script:State.unread -gt 0) { $badge.Opacity = 1.0 }
    Update-PetImage
    Update-KnockCount
    Request-KnockSprite
    return $true
  } catch {
    Show-Error '连不上 DSH，显示的是最后一条'
    return $false
  }
}

# --- 功课：拉数据 -------------------------------------------------------------
# 网络请求一律丢到后台 runspace 里用同步 Invoke-RestMethod 跑；UI 线程每 600ms
# 只看一眼「回来没」。断网/慢网时窗口照样能拖、能点，绝不卡死。

function Request-WorkUpdate {
  # 把下一次拉取提前到现在（打开卡片 / 切页 / 手点刷新时用）
  $script:NextWorkAt = [DateTime]::MinValue
}

function Start-WorkFetch {
  if ($script:WorkPending) { return }
  try {
    $rsState = ''
    if ($script:WorkRunspace) { $rsState = [string]$script:WorkRunspace.RunspaceStateInfo.State }
    if ($rsState -ne 'Opened') {
      try { if ($script:WorkRunspace) { $script:WorkRunspace.Dispose() } } catch { }
      $iss = [System.Management.Automation.Runspaces.InitialSessionState]::CreateDefault()
      $rs = [runspacefactory]::CreateRunspace($iss)
      $rs.Open()
      $script:WorkRunspace = $rs
    }
    $fetchScript = @'
param([string]$Url)
$ErrorActionPreference = 'Stop'
Invoke-RestMethod -Method 'GET' -Uri $Url -Headers @{ 'x-dsh-fojing-pet' = '1' } -TimeoutSec 5
'@
    $ps = [powershell]::Create()
    $ps.Runspace = $script:WorkRunspace
    [void]$ps.AddScript($fetchScript)
    [void]$ps.AddArgument($WorkUrl)
    $handle = $ps.BeginInvoke()
    $script:WorkPending = @{ ps = $ps; handle = $handle; at = [DateTime]::Now }
  } catch {
    $script:WorkPending = $null
    $script:WorkFailed = $true
  }
}

function Complete-WorkFetch {
  # 返回 $true 表示这一拍拿到了新数据
  if (-not $script:WorkPending) { return $false }
  $pending = $script:WorkPending
  if (-not $pending.handle.IsCompleted) {
    # 兜底：runspace 万一卡住，12 秒就丢弃这次请求，绝不能让面板停在「永不刷新」
    if (([DateTime]::Now - $pending.at).TotalSeconds -gt 12) {
      $script:WorkPending = $null
      try { $pending.ps.Stop() } catch { }
      try { $pending.ps.Dispose() } catch { }
      $script:WorkFailed = $true
    }
    return $false
  }
  $script:WorkPending = $null
  $applied = $false
  try {
    $out = $pending.ps.EndInvoke($pending.handle)
    $payload = $null
    if ($out -and $out.Count -gt 0) { $payload = $out[0] }
    if ($payload -and $payload.ok -and $null -ne $payload.sessions) {
      $script:WorkData = $payload
      $script:WorkFailed = $false
      $applied = $true
    } else {
      $script:WorkFailed = $true
    }
  } catch {
    $script:WorkFailed = $true
  } finally {
    try { $pending.ps.Dispose() } catch { }
  }
  return $applied
}

function Update-Work {
  $wasFailed = $script:WorkFailed
  # 「在 DSH 里打开这个对话」的结果回填（runspace 收尾 + 提示到期）
  Update-OpenSession
  $applied = Complete-WorkFetch
  if ($applied -or ($script:WorkFailed -ne $wasFailed) -or (-not $script:WorkData)) {
    Update-PetTag
    if ($script:ShowingCard -and $script:CardTab -eq 'work') {
      $sig = Get-WorkSignature
      if ($sig -ne $script:WorkSignature) {
        $script:WorkSignature = $sig
        Render-Work
        # 数据变少（会话结束 / 收起详单）时窗口也要跟着缩，否则卡片上面会留一大片空白
        Fit-WindowHeight
      }
      if ($script:WorkFailed) { $txtStatus.Text = '读不到功课 · 显示上次的' }
      else { $txtStatus.Text = '' }
    }
  }
  # 到点就发下一次（上一次没回来就不叠加请求）
  if (-not $script:WorkPending -and [DateTime]::Now -ge $script:NextWorkAt) {
    $interval = 15
    if ($script:ShowingCard) { $interval = 5 }
    $script:NextWorkAt = [DateTime]::Now.AddSeconds($interval)
    Start-WorkFetch
  }
}

# --- 敲木鱼 -------------------------------------------------------------------
# 点立绘正中间 = 敲一下：立刻出声 + 飘一行彩头。彩头要 POST 换，所以和拉数据
# 一样丢到后台 runspace，UI 线程只负责「排队 → 到点在画面上飘字」。
$script:KnockQueue = [System.Collections.Generic.Queue[int]]::new()
$script:KnockPending = $null
$script:KnockRunspace = $null
$script:KnockSound = $null      # SoundPlayer，启动时下好 19KB 的 wav 预加载
$script:KnockCount = 0          # 服务端返回的累计敲击数
$script:KnockFloats = New-Object System.Collections.ArrayList
# 「在 DSH 里打开这个对话」：和敲木鱼一样丢后台 runspace，UI 线程只负责收结果。
$script:OpenPending = $null
$script:OpenRunspace = $null
$script:OpenNote = $null        # @{ id; text; until }：展开行底部那句浅色小字
$script:OpenNoteEl = $null      # 当前挂在界面上的那个 TextBlock
$script:OpenNoteElId = ''       # 那个 TextBlock 属于哪个会话

$script:WavPending = $null
$script:WavRunspace = $null
$script:KnockSpritePath = ''      # 敲木鱼那张立绘（本地资产优先，其次临时目录里下到的）
$script:KnockSpriteTried = [DateTime]::MinValue
$script:KnockUntil = [DateTime]::MinValue   # 敲击立绘显示到什么时候（420ms 后换回去）
$script:KnockPrevKind = ''        # 敲之前是什么图，就回什么图
try {
  if (Test-Path $spriteKnock) { $script:KnockSpritePath = $spriteKnock }
  else { $script:KnockSpritePath = $KnockSpriteTemp }
} catch { $script:KnockSpritePath = '' }

# 预取脚本：wav 和 knock 立绘各下各的，一个 404 不影响另一个
$script:AssetFetchScript = @'
param([string]$WavUrl, [string]$WavPath, [bool]$WantWav, [string]$SpriteUrl, [string]$SpritePath, [bool]$WantSprite)
$ErrorActionPreference = 'Continue'
if ($WantWav) {
  try { Invoke-WebRequest -Method 'GET' -Uri $WavUrl -Headers @{ 'x-dsh-fojing-pet' = '1' } -OutFile $WavPath -UseBasicParsing -TimeoutSec 6 } catch { }
}
if ($WantSprite) {
  try { Invoke-WebRequest -Method 'GET' -Uri $SpriteUrl -Headers @{ 'x-dsh-fojing-pet' = '1' } -OutFile $SpritePath -UseBasicParsing -TimeoutSec 6 } catch { }
}
'@

function Show-KnockFloat {
  param([string]$Label = '功德', [int]$Amount = 1)
  # 纯装饰：一张小纸条从头顶往上飘 52 DIP 并淡出，950ms 后由 Update-Knocks 收走
  try {
    $w = [double]$floatLayer.ActualWidth
    $h = [double]$floatLayer.ActualHeight
    if ($w -le 0 -or $h -le 0) { return }
    # 连敲时左右错开：第一下正中，之后依次往两边挪，别叠成一坨
    $spread = @(0, -62, 62, -31, 31)
    $off = [double]$spread[$script:KnockFloats.Count % $spread.Count]


    # 一行字：咖金色、无底色无边框无图标
    $el = New-Object System.Windows.Controls.TextBlock
    $el.FontFamily = New-Object System.Windows.Media.FontFamily 'Microsoft YaHei'
    $el.FontSize = 13
    $el.FontWeight = ConvertTo-FontWeight 'Bold'
    $el.TextWrapping = 'NoWrap'
    $el.IsHitTestVisible = $false
    $runLabel = New-Object System.Windows.Documents.Run $Label
    $runLabel.Foreground = New-Brush '#C69A4E'
    $runAmount = New-Object System.Windows.Documents.Run ('+' + $Amount)
    $runAmount.Foreground = New-Brush '#C69A4E'
    $el.Inlines.Add($runLabel) | Out-Null
    $el.Inlines.Add($runAmount) | Out-Null

    $el.Measure([System.Windows.Size]::new([double]::PositiveInfinity, [double]::PositiveInfinity))
    $pw = [double]$el.DesiredSize.Width
    [System.Windows.Controls.Canvas]::SetLeft($el, ($w / 2) - ($pw / 2) + $off)
    [System.Windows.Controls.Canvas]::SetTop($el, ($h * 0.24))
    $floatLayer.Children.Add($el) | Out-Null

    $tt = New-Object System.Windows.Media.TranslateTransform
    $el.RenderTransform = $tt
    $animY = New-Object System.Windows.Media.Animation.DoubleAnimation
    $animY.From = 0.0
    $animY.To = -52.0
    $animY.Duration = [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(900))
    $ease = New-Object System.Windows.Media.Animation.QuadraticEase
    $ease.EasingMode = 'EaseOut'
    $animY.EasingFunction = $ease
    $tt.BeginAnimation([System.Windows.Media.TranslateTransform]::YProperty, $animY)

    $animO = New-Object System.Windows.Media.Animation.DoubleAnimation
    $animO.From = 1.0
    $animO.To = 0.0
    $animO.BeginTime = [TimeSpan]::FromMilliseconds(320)
    $animO.Duration = [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(580))
    $el.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $animO)

    $script:KnockFloats.Add(@{ el = $el; until = [DateTime]::Now.AddMilliseconds(950) }) | Out-Null
  } catch { }
}

# 木鱼功德总数：网页和壳看同一份账（muyuCount），刚敲的那几下用本地 count 补上
function Get-MuyuTotal {
  $total = 0
  try {
    if ($script:State -and $null -ne $script:State.muyuCount) { $total = [int]$script:State.muyuCount }
  } catch { $total = 0 }
  if ($script:KnockCount -gt $total) { $total = $script:KnockCount }
  if ($total -lt 0) { $total = 0 }
  return $total
}

# 功课页底部那行：有功德就报功德，没有就说数字的来源
function Update-WorkNote {
  try {
    if ($script:WorkFailed) { $txtWorkNote.Text = '读不到最新功课 · 显示的是上次的'; return }
    $total = Get-MuyuTotal
    if ($total -gt 0) { $txtWorkNote.Text = ('已积功德 {0}' -f $total) }
    else { $txtWorkNote.Text = '数字来自 DSH 会话日志' }
  } catch { }
}

function Update-KnockCount {
  try {
    # 只要拿到过数据就常显：没敲过也显示「已积功德 0」，不再时有时无
    $knockText.Text = ('已积功德 {0}' -f (Get-MuyuTotal))
    $knockBorder.Visibility = 'Visible'
    Update-WorkNote
  } catch { }
}

function Request-KnockSprite {
  # 立绘不是必须的：没下到就一直用原来的图，悄悄重试，不打扰人
  try {
    if (-not $script:KnockSpritePath) { return }
    if (Test-Path $script:KnockSpritePath) { return }
    if ($script:WavPending) { return }
    if ([DateTime]::Now -lt $script:KnockSpriteTried) { return }
    $script:KnockSpriteTried = [DateTime]::Now.AddSeconds(60)
    Start-WavFetch
  } catch { }
}

function Show-KnockSprite {
  try {
    if (-not $script:KnockSpritePath) { return }
    if (-not (Test-Path $script:KnockSpritePath)) { return }
    if ($script:PetKind -ne 'knock') { $script:KnockPrevKind = [string]$script:PetKind }
    Set-PetImage 'knock'
    # 淡入一下（0.55 → 1，120ms），不闪白
    $fade = New-Object System.Windows.Media.Animation.DoubleAnimation
    $fade.From = 0.55
    $fade.To = 1.0
    $fade.Duration = [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(120))
    $petImage.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $fade)
    $script:KnockUntil = [DateTime]::Now.AddMilliseconds(420)
  } catch { }
}

function Restore-PetSprite {
  if ($script:KnockUntil -eq [DateTime]::MinValue) { return }
  if ([DateTime]::Now -lt $script:KnockUntil) { return }
  $script:KnockUntil = [DateTime]::MinValue
  try {
    $back = [string]$script:KnockPrevKind
    if (-not $back -or $back -eq 'knock') { $back = 'idle' }
    Set-PetImage $back
  } catch { }
}

function Start-WavFetch {
  # 启动只下一次：音效 19KB + 敲木鱼立绘，都落到临时目录，成功就预加载
  if ($script:WavPending) { return }
  $wantWav = ($null -eq $script:KnockSound)
  $wantSprite = (-not (Test-Path $script:KnockSpritePath)) -and (-not (Test-Path $spriteKnock))
  if (-not $wantWav -and -not $wantSprite) { return }
  try {
    $rsState = ''
    if ($script:WavRunspace) { $rsState = [string]$script:WavRunspace.RunspaceStateInfo.State }
    if ($rsState -ne 'Opened') {
      try { if ($script:WavRunspace) { $script:WavRunspace.Dispose() } } catch { }
      $iss = [System.Management.Automation.Runspaces.InitialSessionState]::CreateDefault()
      $rs = [runspacefactory]::CreateRunspace($iss)
      $rs.Open()
      $script:WavRunspace = $rs
    }
    $ps = [powershell]::Create()
    $ps.Runspace = $script:WavRunspace
    [void]$ps.AddScript($script:AssetFetchScript)
    [void]$ps.AddArgument($MuyuWavUrl)
    [void]$ps.AddArgument($MuyuWavPath)
    [void]$ps.AddArgument([bool]$wantWav)
    [void]$ps.AddArgument($KnockSpriteUrl)
    [void]$ps.AddArgument($KnockSpriteTemp)
    [void]$ps.AddArgument([bool]$wantSprite)
    $handle = $ps.BeginInvoke()
    $script:WavPending = @{ ps = $ps; handle = $handle; at = [DateTime]::Now }
  } catch {
    $script:WavPending = $null
  }
}

function Complete-WavFetch {
  if (-not $script:WavPending) { return }
  $pending = $script:WavPending
  if (-not $pending.handle.IsCompleted) {
    # 兜底：下载卡住就丢掉，不能拖着一辈子
    if (([DateTime]::Now - $pending.at).TotalSeconds -gt 8) {
      $script:WavPending = $null
      try { $pending.ps.Stop() } catch { }
      try { $pending.ps.Dispose() } catch { }
    }
    return
  }
  $script:WavPending = $null
  try {
    $null = $pending.ps.EndInvoke($pending.handle)
    if ((-not $script:KnockSound) -and (Test-Path $MuyuWavPath)) {
      $player = New-Object System.Media.SoundPlayer -ArgumentList $MuyuWavPath
      $player.Load()
      $script:KnockSound = $player
    }
  } catch {
    # 下不到/放不了就静默：敲木鱼照样有飘字，只是没声
    $script:KnockSound = $null
  } finally {
    try { $pending.ps.Dispose() } catch { }
  }
  try {
    if (Test-Path $spriteKnock) { $script:KnockSpritePath = $spriteKnock }
    elseif (Test-Path $KnockSpriteTemp) { $script:KnockSpritePath = $KnockSpriteTemp }
  } catch { }
}

function Start-KnockFetch {
  if ($script:KnockPending) { return }
  if ($script:KnockQueue.Count -eq 0) { return }
  try {
    $rsState = ''
    if ($script:KnockRunspace) { $rsState = [string]$script:KnockRunspace.RunspaceStateInfo.State }
    if ($rsState -ne 'Opened') {
      try { if ($script:KnockRunspace) { $script:KnockRunspace.Dispose() } } catch { }
      $iss = [System.Management.Automation.Runspaces.InitialSessionState]::CreateDefault()
      $rs = [runspacefactory]::CreateRunspace($iss)
      $rs.Open()
      $script:KnockRunspace = $rs
    }
    # 防跨站守卫要求：带 x-dsh-fojing-pet 头 + application/json + 一个 json body
    $knockScript = @'
param([string]$Url)
$ErrorActionPreference = 'Stop'
Invoke-RestMethod -Method 'POST' -Uri $Url -Headers @{ 'x-dsh-fojing-pet' = '1' } -ContentType 'application/json' -Body '{}' -TimeoutSec 5
'@
    $ps = [powershell]::Create()
    $ps.Runspace = $script:KnockRunspace
    [void]$ps.AddScript($knockScript)
    [void]$ps.AddArgument($MuyuUrl)
    $handle = $ps.BeginInvoke()
    $script:KnockPending = @{ ps = $ps; handle = $handle; at = [DateTime]::Now }
  } catch {
    # 连请求都发不出去：照旧本地给一句，别让敲下去没反应
    $script:KnockPending = $null
    if ($script:KnockQueue.Count -gt 0) { [void]$script:KnockQueue.Dequeue() }
    $names = @('功德', '财富', '桃花运', '好运', '健康')
    Show-KnockFloat -Label $names[(Get-Random -Minimum 0 -Maximum $names.Count)] -Amount 1
  }
}

function Complete-KnockFetch {
  if (-not $script:KnockPending) { return }
  $pending = $script:KnockPending
  if (-not $pending.handle.IsCompleted) {
    if (([DateTime]::Now - $pending.at).TotalSeconds -gt 10) {
      $script:KnockPending = $null
      try { $pending.ps.Stop() } catch { }
      try { $pending.ps.Dispose() } catch { }
      if ($script:KnockQueue.Count -gt 0) { [void]$script:KnockQueue.Dequeue() }
      $names = @('功德', '财富', '桃花运', '好运', '健康')
      Show-KnockFloat -Label $names[(Get-Random -Minimum 0 -Maximum $names.Count)] -Amount 1
    }
    return
  }
  $script:KnockPending = $null
  $payload = $null
  try {
    $out = $pending.ps.EndInvoke($pending.handle)
    if ($out -and $out.Count -gt 0) { $payload = $out[0] }
  } catch {
    $payload = $null
  } finally {
    try { $pending.ps.Dispose() } catch { }
  }

  if ($script:KnockQueue.Count -gt 0) { [void]$script:KnockQueue.Dequeue() }
  $label = ''
  $amount = 1
  if ($payload -and $payload.ok) {
    $label = [string]$payload.label
    if (-not $label) { $label = '功德' }
    try { $amount = [int]$payload.amount } catch { $amount = 1 }
    if ($amount -le 0) { $amount = 1 }
    try {
      if ($null -ne $payload.count) {
        $script:KnockCount = [int]$payload.count
        Update-KnockCount
      }
    } catch { }
  } else {
    # 没换成：本地随机一个彩头，只飘字，不写累计
    $names = @('功德', '财富', '桃花运', '好运', '健康')
    $label = $names[(Get-Random -Minimum 0 -Maximum $names.Count)]
  }
  Show-KnockFloat -Label $label -Amount $amount
}

function Update-Knocks {
  # 每 150ms 一拍：收 wav 下载结果、收 POST 彩头、清掉飘完的字
  Complete-WavFetch
  Complete-KnockFetch
  Restore-PetSprite
  if ($script:KnockFloats.Count -gt 0) {
    for ($i = $script:KnockFloats.Count - 1; $i -ge 0; $i--) {
      if ([DateTime]::Now -ge $script:KnockFloats[$i].until) {
        try { [void]$floatLayer.Children.Remove($script:KnockFloats[$i].el) } catch { }
        $script:KnockFloats.RemoveAt($i)
      }
    }
  }
  if (-not $script:KnockPending -and $script:KnockQueue.Count -gt 0) { Start-KnockFetch }
}

function Invoke-MuyuKnock {
  # 先换表情、再出声：都是本地预加载的，不用等网络
  Show-KnockSprite
  try { if ($script:KnockSound) { $script:KnockSound.Play() } } catch { }
  if ($script:KnockQueue.Count -ge 12) {
    # 点太疯了：不排队，但照样给一句，手感不断
    $names = @('功德', '财富', '桃花运', '好运', '健康')
    Show-KnockFloat -Label $names[(Get-Random -Minimum 0 -Maximum $names.Count)] -Amount 1
    return
  }
  $script:KnockQueue.Enqueue(1) | Out-Null
  if (-not $script:KnockPending) { Start-KnockFetch }
}

# --- 在 DSH 里打开对话 ---------------------------------------------------------
# 壳是独立进程，够不到网页的客户端服务，所以走「宿主接力」：壳 POST /dsh-fojing-pet/open，
# 网页每 2.5 秒拉一次快照，看到新请求就 uiWorkspace.openSession(id)。
# 行自己用 PreviewMouseLeftButtonUp 做展开/收起（隧道事件先到行），所以点按钮时得先认出
# 「这一下落没落在按钮里」，否则会顺手把行收起来。
function Test-HitInsideButton {
  param($Source, $StopAt)
  $node = $Source
  $guard = 0
  while ($node -and $guard -lt 32) {
    $guard++
    if ($node -is [System.Windows.Controls.Button]) { return $true }
    if ($node -eq $StopAt) { return $false }
    if ($node -is [System.Windows.Media.Visual]) { $node = [System.Windows.Media.VisualTreeHelper]::GetParent($node) }
    elseif ($node -is [System.Windows.FrameworkContentElement]) { $node = $node.Parent }
    else { return $false }
  }
  return $false
}

function Set-OpenNote {
  param([string]$Id, [string]$Text)
  # 成功/失败都留 4 秒；期间数据刷新重建了行，也能从 $script:OpenNote 补回来
  $script:OpenNote = @{ id = $Id; text = $Text; until = [DateTime]::Now.AddSeconds(4) }
  try {
    if ($script:OpenNoteEl -and [string]$script:OpenNoteElId -eq $Id) { $script:OpenNoteEl.Text = $Text }
  } catch { }
}

function Start-OpenSession {
  param([string]$Id)
  if (-not $Id) { return }
  if ($script:OpenPending) { return }   # 连点挡住，不叠 runspace
  try {
    if ($script:OpenNoteEl -and [string]$script:OpenNoteElId -eq $Id) { $script:OpenNoteEl.Text = '在交给 DSH…' }
  } catch { }
  try {
    $rsState = ''
    if ($script:OpenRunspace) { $rsState = [string]$script:OpenRunspace.RunspaceStateInfo.State }
    if ($rsState -ne 'Opened') {
      try { if ($script:OpenRunspace) { $script:OpenRunspace.Dispose() } } catch { }
      $iss = [System.Management.Automation.Runspaces.InitialSessionState]::CreateDefault()
      $rs = [runspacefactory]::CreateRunspace($iss)
      $rs.Open()
      $script:OpenRunspace = $rs
    }
    # 防跨站守卫要求：x-dsh-fojing-pet 头 + application/json + 一个 json body
    $openScript = @'
param([string]$Url, [string]$Id)
$ErrorActionPreference = 'Stop'
$body = @{ id = $Id } | ConvertTo-Json -Compress
Invoke-RestMethod -Method 'POST' -Uri $Url -Headers @{ 'x-dsh-fojing-pet' = '1' } -ContentType 'application/json' -Body $body -TimeoutSec 5
'@
    $ps = [powershell]::Create()
    $ps.Runspace = $script:OpenRunspace
    [void]$ps.AddScript($openScript)
    [void]$ps.AddArgument($OpenUrl)
    [void]$ps.AddArgument($Id)
    $handle = $ps.BeginInvoke()
    $script:OpenPending = @{ ps = $ps; handle = $handle; at = [DateTime]::Now; id = $Id }
  } catch {
    # 连请求都发不出去：照实说，不要静默
    $script:OpenPending = $null
    Set-OpenNote -Id $Id -Text 'DSH 那边没接上'
  }
}

function Update-OpenSession {
  # 每 600ms 一拍（从 Update-Work 里叫）：收 POST 结果、清到期提示
  if ($script:OpenPending) {
    $pending = $script:OpenPending
    if (-not $pending.handle.IsCompleted) {
      if (([DateTime]::Now - $pending.at).TotalSeconds -gt 8) {
        $script:OpenPending = $null
        try { $pending.ps.Stop() } catch { }
        try { $pending.ps.Dispose() } catch { }
        Set-OpenNote -Id $pending.id -Text 'DSH 那边没接上'
      }
    } else {
      $script:OpenPending = $null
      $ok = $false
      try {
        $out = $pending.ps.EndInvoke($pending.handle)
        if ($out -and $out.Count -gt 0 -and $out[0] -and $out[0].ok) { $ok = $true }
      } catch {
        $ok = $false
      } finally {
        try { $pending.ps.Dispose() } catch { }
      }
      if ($ok) { Set-OpenNote -Id $pending.id -Text '已交给 DSH 打开' }
      else { Set-OpenNote -Id $pending.id -Text 'DSH 那边没接上' }
    }
  }
  try {
    if ($script:OpenNote -and $script:OpenNote.until -ne [DateTime]::MinValue) {
      if ([DateTime]::Now -ge $script:OpenNote.until) {
        $script:OpenNote = $null
        if ($script:OpenNoteEl) { $script:OpenNoteEl.Text = '' }
      }
    }
  } catch { }
}

# 数据指纹：只放「肉眼能看出来变化」的字段，token 每 5 秒抖一点不该导致整页重建。
function Get-WorkSignature {
  $bits = New-Object System.Collections.Generic.List[string]
  if (-not $script:WorkData) {
    if ($script:WorkFailed) { $bits.Add('fail') } else { $bits.Add('nodata') }
    $bits.Add('open=' + [string]$script:WorkOpenId)
    return ($bits -join ';')
  }
  try {
    $bits.Add('t=' + [string]$script:WorkData.totalSessions)
    $bits.Add('r=' + [string]$script:WorkData.runningCount)
    foreach ($s in @($script:WorkData.sessions)) {
      if (-not $s) { continue }
      $line = [string]$s.id
      $line += '|' + [string][int]([bool]$s.running)
      $line += '|' + [string]$s.todos.done + '/' + [string]$s.todos.total
      $line += '|' + [string]$s.tokens.total
      $mins = 0
      try { $mins = [Math]::Floor([double]$s.durationMs / 60000) } catch { }
      $idle = 0
      try { $idle = [Math]::Floor([double]$s.idleMs / 60000) } catch { }
      $line += '|' + [string]$mins + '|' + [string]$idle
      foreach ($c in @($s.children)) {
        if (-not $c) { continue }
        $line += '|c' + [string]$c.id + ':' + [string][int]([bool]$c.running) + ':' + [string]$c.tokens.total
      }
      $bits.Add($line)
    }
  } catch { }
  $bits.Add('open=' + [string]$script:WorkOpenId)
  $bits.Add('f=' + [string][int]$script:WorkFailed)
  return ($bits -join ';')
}

# --- 功课：立绘下面那个小标签 -------------------------------------------------
function Update-PetTag {
  $run = 0
  try {
    if ($script:WorkData -and $null -ne $script:WorkData.runningCount) { $run = [int]$script:WorkData.runningCount }
  } catch { $run = 0 }
  $dotColor = '#8CB7AF'
  if ($run -gt 0) {
    $tagText.Text = "$run 个在跑"
    $dotColor = '#D2A03C'
  } else {
    $petRunning = $false
    try { if ($script:State) { $petRunning = [bool]$script:State.running } } catch { }
    if ($petRunning) {
      $tagText.Text = '翻经中'
    } else {
      $left = Get-NextRunLeft
      if ($left -gt 0) {
        $tagText.Text = (Format-RunLeft $left)
      } else {
        $tagText.Text = '静坐中'
      }
    }
  }
  $tagDot.Fill = New-Brush $dotColor
  # 佛光：和上面的 $run 是同一个数（网页端 runningCount > 0 才渲染）
  Set-HaloRunning ($run -gt 0)
  Update-KnockCount
}

# --- 功课：tab 与卡片两页 -----------------------------------------------------
function New-TabChip {
  param([string]$Label, [string]$Key, [bool]$Active)
  $chip = New-Object System.Windows.Controls.Border
  $chip.CornerRadius = New-Object System.Windows.CornerRadius 6
  $chip.Padding = (New-Thickness '11,3,11,4')
  $chip.Margin = (New-Thickness '0,0,6,0')
  $chip.BorderThickness = (New-Thickness '1')
  $chip.Cursor = 'Hand'
  $chip.Tag = $Key
  if ($Active) {
    $chip.Background = New-Brush '#8CB7AF'
    $chip.BorderBrush = New-Brush '#8CB7AF'
  } else {
    $chip.Background = New-Brush '#FFFDF7'
    $chip.BorderBrush = New-Brush '#E2D3B6'
  }
  $color = '#7A6A4E'
  if ($Active) { $color = '#FFFDF5' }
  $chip.Child = (New-Text -Text $Label -Size 11 -Color $color -Weight 'SemiBold')
  # 和经书胶囊一样用 Preview（隧道）事件：ScrollViewer 会把冒泡事件吃掉
  $chip.Add_PreviewMouseLeftButtonUp({
      try {
        $key = [string]$this.Tag
        if ($key) { Set-CardTab $key }
      } catch { }
    })
  return $chip
}

function Update-TabBar {
  $tabBar.Children.Clear()
  # 功课在左，是默认页；读经挪到右边
  $tabBar.Children.Add((New-TabChip -Label '功课' -Key 'work' -Active ($script:CardTab -eq 'work'))) | Out-Null
  $tabBar.Children.Add((New-TabChip -Label '今日读经' -Key 'read' -Active ($script:CardTab -eq 'read'))) | Out-Null
}

function Set-CardTab {
  param([string]$Tab = 'work')
  if ($Tab -ne 'read') { $Tab = 'work' }
  $script:CardTab = $Tab
  Update-TabBar
  if ($Tab -eq 'work') {
    $readPanel.Visibility = 'Collapsed'
    $workPanel.Visibility = 'Visible'
    $btnMore.Visibility = 'Collapsed'
    $btnNext.Visibility = 'Collapsed'
    $btnRefresh.Visibility = 'Visible'
    # 功课页比读经页长：把卡片上限抬高，但必须留在当前屏幕放得下的范围内，
    # 否则窗口高度被工作区卡住、卡片顶部会被切掉（这个项目以前踩过）。
    $wa = Get-WindowWorkArea
    $avail = $wa.Bottom - $wa.Top
    $limit = [Math]::Min($WorkCardHeight, $avail - [Math]::Ceiling($OpenPetHeight * $script:PetScale) - 90)
    if ($limit -lt 300) { $limit = 300 }
    $cardBorder.MaxHeight = $limit
    $script:WorkSignature = Get-WorkSignature
    Render-Work
    Request-WorkUpdate
  } else {
    $readPanel.Visibility = 'Visible'
    $workPanel.Visibility = 'Collapsed'
    $btnMore.Visibility = 'Visible'
    $btnNext.Visibility = 'Visible'
    $btnRefresh.Visibility = 'Collapsed'
    $cardBorder.MaxHeight = $CardHeight
    Render-Card
    # 切到读经页就等于「看了」：把当前那条标成已读。
    # 默认页从读经改成功课后，这个动作挪到这里，读经页本身的渲染逻辑没动。
    if ($script:ShowingCard) {
      $shown = Get-PageCard
      if ($shown -and -not $shown.read) {
        try { Invoke-PetApi -Method 'POST' -Url $ReadUrl -Body @{ id = $shown.id } | Out-Null } catch { }
      }
    }
  }
  $scroll.UpdateLayout()
  $scroll.ScrollToVerticalOffset(0)
  Fit-WindowHeight
}

# --- 功课：行与详单 -----------------------------------------------------------
function New-WorkDot {
  param([bool]$Running)
  $dot = New-Object System.Windows.Shapes.Ellipse
  $dot.Width = 7
  $dot.Height = 7
  $dot.Margin = (New-Thickness '0,0,6,0')
  $dot.VerticalAlignment = 'Center'
  if ($Running) {
    $dot.Fill = New-Brush '#D2A03C'
    # 金色呼吸：只动不透明度，不占 UI 线程
    $anim = New-Object System.Windows.Media.Animation.DoubleAnimation
    $anim.From = 1.0
    $anim.To = 0.28
    $anim.Duration = [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(1100))
    $anim.AutoReverse = $true
    $anim.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever
    $dot.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $anim)
  } else {
    $dot.Fill = New-Brush '#CFC4AD'
  }
  return $dot
}

function New-StatCell {
  param([string]$Label, [string]$Value)
  $cell = New-Object System.Windows.Controls.StackPanel
  $cell.Margin = New-Object System.Windows.Thickness 0, 0, 6, 7
  $lab = New-Text -Text $Label -Size 9 -Color '#A89A80' -Margin '0,0,0,1'
  $val = New-Text -Text $Value -Size 11.5 -Color '#3F574F' -Weight 'SemiBold' -Margin '0,0,0,0'
  $cell.Children.Add($lab) | Out-Null
  $cell.Children.Add($val) | Out-Null
  return $cell
}

function New-TodoLine {
  param($Item)
  $line = New-Object System.Windows.Controls.Grid
  $line.Margin = New-Object System.Windows.Thickness 0, 2, 0, 0
  $colPre = New-Object System.Windows.Controls.ColumnDefinition
  $colPre.Width = [System.Windows.GridLength]::Auto
  $colTxt = New-Object System.Windows.Controls.ColumnDefinition
  $colTxt.Width = New-Object System.Windows.GridLength 1, 'Star'
  [void]$line.ColumnDefinitions.Add($colPre)
  [void]$line.ColumnDefinitions.Add($colTxt)
  $status = 'pending'
  try { if ($Item -and $Item.status) { $status = [string]$Item.status } } catch { }
  $mark = '○'
  $color = '#8A8172'
  if ($status -eq 'completed') { $mark = '✓'; $color = '#A79C86' }
  elseif ($status -eq 'in_progress') { $mark = '◔'; $color = '#3E6B5E' }
  # 符号统一交给 Segoe UI Symbol：雅黑里 ○/◔ 的覆盖不稳，容易出豆腐块
  $pre = New-Text -Text $mark -Size 10.5 -Color $color -Family 'Segoe UI Symbol' -Margin '0,0,4,0'
  $pre.Width = 14
  $pre.TextWrapping = 'NoWrap'
  $pre.TextAlignment = 'Center'
  $text = New-Text -Text ([string]$Item.content) -Size 10.5 -Color $color -LineHeight 17
  if ($status -eq 'in_progress') { $text.FontWeight = [System.Windows.FontWeights]::SemiBold }
  if ($status -eq 'completed') { $text.TextDecorations = [System.Windows.TextDecorations]::Strikethrough }
  [System.Windows.Controls.Grid]::SetColumn($pre, 0)
  [System.Windows.Controls.Grid]::SetColumn($text, 1)
  $line.Children.Add($pre) | Out-Null
  $line.Children.Add($text) | Out-Null
  return $line
}

# 展开后的详单：子任务 + 数字明细 + 子 agent
function New-WorkDetail {
  param($Session)
  $box = New-Object System.Windows.Controls.Border
  $box.CornerRadius = New-Object System.Windows.CornerRadius 9
  $box.Background = New-Brush '#FFFCF3'
  $box.BorderThickness = New-Object System.Windows.Thickness 1
  $box.BorderBrush = New-Brush '#EDE0C6'
  $box.Padding = New-Object System.Windows.Thickness 9, 8, 9, 9
  $box.Margin = New-Object System.Windows.Thickness 0, 7, 0, 1
  $panel = New-Object System.Windows.Controls.StackPanel
  $box.Child = $panel

  $lab1 = New-Text -Text '子任务' -Size 9 -Color $Accent -Weight 'Bold' -Margin '0,0,0,4'
  $panel.Children.Add($lab1) | Out-Null
  $items = @()
  try { if ($Session.todos -and $Session.todos.items) { $items = @($Session.todos.items) } } catch { }
  $hasItems = $false
  foreach ($it in $items) { if ($it -and $it.content) { $hasItems = $true; break } }
  if ($hasItems) {
    foreach ($it in $items) {
      if (-not $it) { continue }
      $panel.Children.Add((New-TodoLine -Item $it)) | Out-Null
    }
  } else {
    $panel.Children.Add((New-Text -Text '这个会话没写过子任务' -Size 9.5 -Color '#B3A78F' -Margin '16,1,0,2')) | Out-Null
  }

  # 数字明细：2×2。卡片只有 400 宽，四个数字摊开比竖着一列好扫。
  $stats = $null
  try { $stats = $Session.stats } catch { }
  $llm = '—'
  $tool = '—'
  $turns = '0'
  if ($stats) {
    $llm = Format-DurationMs $stats.llmMs
    $tool = Format-DurationMs $stats.toolMs
    try { if ($null -ne $stats.turns) { $turns = [string]$stats.turns } } catch { }
  }
  $grid = New-Object System.Windows.Controls.Grid
  $grid.Margin = New-Object System.Windows.Thickness 0, 9, 0, 0
  $g0 = New-Object System.Windows.Controls.ColumnDefinition
  $g0.Width = New-Object System.Windows.GridLength 1, 'Star'
  $g1 = New-Object System.Windows.Controls.ColumnDefinition
  $g1.Width = New-Object System.Windows.GridLength 1, 'Star'
  [void]$grid.ColumnDefinitions.Add($g0)
  [void]$grid.ColumnDefinitions.Add($g1)
  $gr0 = New-Object System.Windows.Controls.RowDefinition
  $gr0.Height = [System.Windows.GridLength]::Auto
  $gr1 = New-Object System.Windows.Controls.RowDefinition
  $gr1.Height = [System.Windows.GridLength]::Auto
  [void]$grid.RowDefinitions.Add($gr0)
  [void]$grid.RowDefinitions.Add($gr1)
  $cells = @(
    @{ Row = 0; Col = 0; Block = (New-StatCell -Label 'token 总量' -Value (Format-TokenCount $Session.tokens.total)) },
    @{ Row = 0; Col = 1; Block = (New-StatCell -Label 'LLM 墙钟' -Value $llm) },
    @{ Row = 1; Col = 0; Block = (New-StatCell -Label '工具墙钟' -Value $tool) },
    @{ Row = 1; Col = 1; Block = (New-StatCell -Label '轮次' -Value $turns) }
  )
  foreach ($c in $cells) {
    [System.Windows.Controls.Grid]::SetRow($c.Block, $c.Row)
    [System.Windows.Controls.Grid]::SetColumn($c.Block, $c.Col)
    $grid.Children.Add($c.Block) | Out-Null
  }
  $panel.Children.Add($grid) | Out-Null

  $kids = @()
  try { if ($Session.children) { $kids = @($Session.children) } } catch { }
  $hasKids = $false
  foreach ($k in $kids) { if ($k) { $hasKids = $true; break } }
  if ($hasKids) {
    $panel.Children.Add((New-Text -Text '子 agent' -Size 9 -Color $Accent -Weight 'Bold' -Margin '0,1,0,2')) | Out-Null
    foreach ($k in $kids) {
      if (-not $k) { continue }
      $kLine = New-Object System.Windows.Controls.WrapPanel
      $kLine.Margin = New-Object System.Windows.Thickness 0, 1, 0, 0
      $kLine.Children.Add((New-Text -Text '↳' -Size 10 -Color '#B0A38A' -Margin '0,0,5,0')) | Out-Null
      $kLine.Children.Add((New-Text -Text (Get-ShortName $k) -Size 10 -Color '#5C7168' -Weight 'SemiBold' -Margin '0,0,6,0')) | Out-Null
      $kLine.Children.Add((New-Text -Text (Format-TokenCount $k.tokens.total) -Size 10 -Color '#8A8172' -Margin '0,0,6,0')) | Out-Null
      $kr = $false
      try { $kr = [bool]$k.running } catch { }
      $kStatus = '已停'
      $kColor = '#A8A091'
      if ($kr) { $kStatus = '在跑'; $kColor = '#B98A2E' }
      $kLine.Children.Add((New-Text -Text $kStatus -Size 10 -Color $kColor)) | Out-Null
      $panel.Children.Add($kLine) | Out-Null
    }
  }
  # 最后一行：把这一行对应的会话交给 DSH 打开。纯文字按钮，不用胶囊。
  $openId = [string]$Session.id
  if ($openId) {
    $openRow = New-Object System.Windows.Controls.StackPanel
    $openRow.Orientation = 'Horizontal'
    $openRow.Margin = New-Object System.Windows.Thickness 0, 9, 0, 0
    $btnOpen = New-LinkButton -Label '在 DSH 里打开这个对话 →' -Color '#3E6B5E' -Size 10
    $btnOpen.Margin = New-Object System.Windows.Thickness 2, 0, 0, 0
    $btnOpen.Padding = New-Object System.Windows.Thickness 4, 1, 4, 1
    $btnOpen.Tag = $openId
    $btnOpen.ToolTip = '在 DSH 窗口里切到这个对话'
    $openNote = New-Text -Text '' -Size 9 -Color '#7F9A7A' -Margin '8,0,0,0'
    $openNote.VerticalAlignment = 'Center'
    $btnOpen.Add_Click({
        try {
          $id = [string]$this.Tag
          if ($id) { Start-OpenSession -Id $id }
        } catch { }
      })
    $openRow.Children.Add($btnOpen) | Out-Null
    $openRow.Children.Add($openNote) | Out-Null
    $panel.Children.Add($openRow) | Out-Null
    # 同一时间只挂一个提示位：展开另一行时旧的自动作废
    $script:OpenNoteEl = $openNote
    $script:OpenNoteElId = $openId
    try {
      if ($script:OpenNote -and [string]$script:OpenNote.id -eq $openId -and [DateTime]::Now -lt $script:OpenNote.until) {
        $openNote.Text = [string]$script:OpenNote.text
      }
    } catch { }
  }

  return $box
}

# --- 功课：按项目归成树 -------------------------------------------------------
# 同一个 project（cwd 目录名）下的多个会话收成一个项目节点：父行是项目，子行是会话。
# 整个盘只画一层树；子行左侧的竖线由 New-WorkTreeGutter 画。

# 项目行的状态点：组内有在跑就金色呼吸（节奏和会话行那个点一致），否则静态米色。
function New-WorkGroupDot {
  param([bool]$Running)
  $dot = New-Object System.Windows.Shapes.Ellipse
  $dot.Width = 6
  $dot.Height = 6
  $dot.Margin = (New-Thickness '0,0,6,0')
  $dot.VerticalAlignment = 'Center'
  if ($Running) {
    $dot.Fill = New-Brush '#D9A13C'
    # 金色呼吸：和网页那条 fj-pulse 同款节奏——1.5 秒一个来回，0.3 到 1.0
    $anim = New-Object System.Windows.Media.Animation.DoubleAnimation
    $anim.From = 0.3
    $anim.To = 1.0
    $anim.Duration = [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(750))
    $anim.AutoReverse = $true
    $anim.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever
    $dot.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $anim)
  } else {
    $dot.Fill = New-Brush '#C9BDA6'
  }
  return $dot
}

# 项目行（父节点）：高 26、无边框无底色，整行可点，只切换这一组的折叠。
# 点它绝不能碰「展开哪一行」（$script:WorkOpenId）——那是子行自己的事。
function New-WorkGroupRow {
  param($Group, [bool]$Closed, [double]$AgoMs)
  $row = New-Object System.Windows.Controls.Border
  $row.Height = 26
  $row.Padding = (New-Thickness '3,0,3,0')
  $row.CornerRadius = New-Object System.Windows.CornerRadius 7
  $row.Background = [System.Windows.Media.Brushes]::Transparent
  $row.Cursor = 'Hand'
  $row.Tag = [string]$Group.Key
  # hover：网页那条 rgba(255,253,246,.9) 落在纸色上的效果
  $row.Add_MouseEnter({ try { $this.Background = New-Brush '#FFFDF6' } catch { } })
  $row.Add_MouseLeave({ try { $this.Background = [System.Windows.Media.Brushes]::Transparent } catch { } })

  $grid = New-Object System.Windows.Controls.Grid
  $row.Child = $grid
  # 0 点 · 1 项目名 · 2 N 个 · 3 · N 个在跑 · 4 弹性 · 5 合计 · 6 时间 · 7 箭头
  for ($i = 0; $i -lt 8; $i++) {
    $cd = New-Object System.Windows.Controls.ColumnDefinition
    if ($i -eq 4) { $cd.Width = New-Object System.Windows.GridLength 1, 'Star' }
    else { $cd.Width = [System.Windows.GridLength]::Auto }
    [void]$grid.ColumnDefinitions.Add($cd)
  }

  $running = $false
  try { $running = [bool]$Group.HasRun } catch { }
  $dot = New-WorkGroupDot -Running $running
  [System.Windows.Controls.Grid]::SetColumn($dot, 0)

  $name = New-Text -Text ([string]$Group.Key) -Size 11 -Color '#6A5333' -Weight 'Bold' -Margin '0,0,0,0'
  $name.TextWrapping = 'NoWrap'
  $name.TextTrimming = 'CharacterEllipsis'
  $name.MaxWidth = 148
  $name.VerticalAlignment = 'Center'
  [System.Windows.Controls.Grid]::SetColumn($name, 1)

  $n = 0
  try { $n = [int]$Group.Items.Count } catch { $n = 0 }
  $countText = New-Text -Text ("$n 个") -Size 10 -Color '#9B866A' -Margin '6,0,0,0'
  $countText.TextWrapping = 'NoWrap'
  $countText.VerticalAlignment = 'Center'
  [System.Windows.Controls.Grid]::SetColumn($countText, 2)

  $runCount = 0
  try { $runCount = [int]$Group.RunCount } catch { $runCount = 0 }
  $runText = $null
  if ($runCount -gt 0) {
    $runText = New-Text -Text ('· ' + $runCount + ' 个在跑') -Size 10 -Color '#5F8A6A' -Margin '6,0,0,0'
    $runText.TextWrapping = 'NoWrap'
    $runText.VerticalAlignment = 'Center'
    [System.Windows.Controls.Grid]::SetColumn($runText, 3)
  }

  $tokSum = 0.0
  try { $tokSum = [double]$Group.Tokens } catch { $tokSum = 0.0 }
  $tot = New-Text -Text ('合计 ' + (Format-TokenCount $tokSum)) -Size 10 -Color '#9B866A' -Margin '0,0,0,0'
  $tot.TextWrapping = 'NoWrap'
  $tot.VerticalAlignment = 'Center'
  # 等宽数字：几行合计右对齐时尾数不会跳（和网页的 tabular-nums 一致）
  try { [System.Windows.Documents.Typography]::SetNumeralAlignment($tot, [System.Windows.FontNumeralAlignment]::Tabular) } catch { }
  [System.Windows.Controls.Grid]::SetColumn($tot, 5)

  $agoText = '刚刚'
  try { $agoText = Format-Ago $AgoMs } catch { $agoText = '刚刚' }
  $ago = New-Text -Text $agoText -Size 10 -Color '#9B866A' -Margin '8,0,0,0'
  $ago.TextWrapping = 'NoWrap'
  $ago.VerticalAlignment = 'Center'
  try { [System.Windows.Documents.Typography]::SetNumeralAlignment($ago, [System.Windows.FontNumeralAlignment]::Tabular) } catch { }
  [System.Windows.Controls.Grid]::SetColumn($ago, 6)

  $caretText = '▸'
  if (-not $Closed) { $caretText = '▾' }
  $caret = New-Text -Text $caretText -Size 9 -Color '#B9A98C' -Family 'Segoe UI Symbol' -Margin '6,0,0,0'
  $caret.TextWrapping = 'NoWrap'
  $caret.VerticalAlignment = 'Center'
  [System.Windows.Controls.Grid]::SetColumn($caret, 7)

  $grid.Children.Add($dot) | Out-Null
  $grid.Children.Add($name) | Out-Null
  $grid.Children.Add($countText) | Out-Null
  if ($runText) { $grid.Children.Add($runText) | Out-Null }
  $grid.Children.Add($tot) | Out-Null
  $grid.Children.Add($ago) | Out-Null
  $grid.Children.Add($caret) | Out-Null

  $row.Add_PreviewMouseLeftButtonUp({
      try {
        $key = [string]$this.Tag
        if (-not $key) { return }
        if ($script:ClosedProjects.ContainsKey($key)) { $script:ClosedProjects.Remove($key) }
        else { $script:ClosedProjects[$key] = $true }
        Render-Work
        Fit-WindowHeight
      } catch { }
    })
  return $row
}

# 子行左侧的树线（对齐网页 .fj-spine）：竖线在距列表左边 16 DIP 处，
# 卡片再往里让 13 DIP（总共缩进 29），中间 6 DIP 横枝接到卡片。
# 非最后一行竖线贯穿整行；最后一行只画到横枝为止（└），不再往下延长。
function New-WorkTreeGutter {
  param([bool]$Last)
  # rgba(190,170,135,.55) 的 ARGB 等效值
  $railColor = '#8CBEAA87'
  $g = New-Object System.Windows.Controls.Grid
  $g.Width = 13
  $g.HorizontalAlignment = 'Left'
  $rail = New-Object System.Windows.Controls.Border
  $rail.Width = 1
  $rail.HorizontalAlignment = 'Left'
  $rail.Margin = New-Object System.Windows.Thickness 0, 0, 0, 0
  $rail.Background = New-Brush $railColor
  $branch = New-Object System.Windows.Controls.Border
  $branch.Width = 6
  $branch.Height = 1
  $branch.HorizontalAlignment = 'Left'
  $branch.VerticalAlignment = 'Top'
  # 横枝落在子行第一行的中线上（卡片上内边距 7 + 行高一半 ≈ 14）
  $branch.Margin = New-Object System.Windows.Thickness 0, 14, 0, 0
  $branch.Background = New-Brush $railColor
  if ($Last) {
    $rail.Height = 15
    $rail.VerticalAlignment = 'Top'
  } else {
    $rail.VerticalAlignment = 'Stretch'
  }
  $g.Children.Add($rail) | Out-Null
  $g.Children.Add($branch) | Out-Null
  return $g
}

# 把会话卡片放进「13 宽树线 + 卡片」两列里（外层再让 16，合计缩进 29）
function New-WorkTreeNode {
  param($Card, [bool]$Last)
  $node = New-Object System.Windows.Controls.Grid
  $c0 = New-Object System.Windows.Controls.ColumnDefinition
  $c0.Width = New-Object System.Windows.GridLength 13
  $c1 = New-Object System.Windows.Controls.ColumnDefinition
  $c1.Width = New-Object System.Windows.GridLength 1, 'Star'
  [void]$node.ColumnDefinitions.Add($c0)
  [void]$node.ColumnDefinitions.Add($c1)
  $gutter = New-WorkTreeGutter -Last $Last
  [System.Windows.Controls.Grid]::SetColumn($gutter, 0)
  [System.Windows.Controls.Grid]::SetColumn($Card, 1)
  $node.Children.Add($gutter) | Out-Null
  $node.Children.Add($Card) | Out-Null
  return $node
}

function New-WorkRow {
  param($Session, [bool]$Open)
  $row = New-Object System.Windows.Controls.Border
  $row.CornerRadius = New-Object System.Windows.CornerRadius 10
  $row.Padding = (New-Thickness '8,7,6,8')
  $row.Cursor = 'Hand'
  $row.Tag = [string]$Session.id
  if ($Open) { $row.Background = New-Brush '#F6EFDE' }
  else { $row.Background = [System.Windows.Media.Brushes]::Transparent }
  $body = New-Object System.Windows.Controls.StackPanel
  $row.Child = $body

  # 第一行：状态点 · 标题（长标题吃省略号）· 展开箭头
  # 项目名已经上移到项目父行，子行不再重复画它，标题顶到最前。
  $line1 = New-Object System.Windows.Controls.Grid
  $c0 = New-Object System.Windows.Controls.ColumnDefinition
  $c0.Width = [System.Windows.GridLength]::Auto
  $c1 = New-Object System.Windows.Controls.ColumnDefinition
  $c1.Width = New-Object System.Windows.GridLength 1, 'Star'
  $c2 = New-Object System.Windows.Controls.ColumnDefinition
  $c2.Width = [System.Windows.GridLength]::Auto
  [void]$line1.ColumnDefinitions.Add($c0)
  [void]$line1.ColumnDefinitions.Add($c1)
  [void]$line1.ColumnDefinitions.Add($c2)

  $running = $false
  try { $running = [bool]$Session.running } catch { }
  $dot = New-WorkDot -Running $running

  $titleText = ''
  try { if ($Session.title) { $titleText = ([string]$Session.title).Trim() } } catch { }
  # 和网页一致：标题空着就写「（没有标题）」，不再拿项目名做兜底
  if (-not $titleText) { $titleText = '（没有标题）' }

  $ttl = New-Text -Text $titleText -Size 10.5 -Color '#8A8172' -Margin '0,0,2,0'
  $ttl.TextWrapping = 'NoWrap'
  $ttl.TextTrimming = 'CharacterEllipsis'
  $ttl.VerticalAlignment = 'Center'
  $caretText = '▸'
  if ($Open) { $caretText = '▾' }
  $caret = New-Text -Text $caretText -Size 8.5 -Color '#B0A38A' -Family 'Segoe UI Symbol' -Margin '2,0,0,0'
  $caret.VerticalAlignment = 'Center'

  [System.Windows.Controls.Grid]::SetColumn($dot, 0)
  [System.Windows.Controls.Grid]::SetColumn($ttl, 1)
  [System.Windows.Controls.Grid]::SetColumn($caret, 2)
  $line1.Children.Add($dot) | Out-Null
  $line1.Children.Add($ttl) | Out-Null
  $line1.Children.Add($caret) | Out-Null
  $body.Children.Add($line1) | Out-Null

  # 第二行：进度条 + done/total + token + 时长
  $total = 0
  $done = 0
  try {
    if ($Session.todos) {
      if ($null -ne $Session.todos.total) { $total = [int]$Session.todos.total }
      if ($null -ne $Session.todos.done) { $done = [int]$Session.todos.done }
    }
  } catch { }
  $line2 = New-Object System.Windows.Controls.Grid
  $line2.Margin = New-Object System.Windows.Thickness 13, 5, 0, 0
  $d0 = New-Object System.Windows.Controls.ColumnDefinition
  $d0.Width = [System.Windows.GridLength]::Auto
  $d1 = New-Object System.Windows.Controls.ColumnDefinition
  $d1.Width = [System.Windows.GridLength]::Auto
  $d2 = New-Object System.Windows.Controls.ColumnDefinition
  $d2.Width = New-Object System.Windows.GridLength 1, 'Star'
  $d3 = New-Object System.Windows.Controls.ColumnDefinition
  $d3.Width = [System.Windows.GridLength]::Auto
  $d4 = New-Object System.Windows.Controls.ColumnDefinition
  $d4.Width = [System.Windows.GridLength]::Auto
  [void]$line2.ColumnDefinitions.Add($d0)
  [void]$line2.ColumnDefinitions.Add($d1)
  [void]$line2.ColumnDefinitions.Add($d2)
  [void]$line2.ColumnDefinitions.Add($d3)
  [void]$line2.ColumnDefinitions.Add($d4)

  if ($total -gt 0) {
    # 细进度条：只在有 todos 时出现，没有就只留状态点和数字
    $bar = New-Object System.Windows.Controls.Border
    $bar.Width = 62
    $bar.Height = 3.5
    $bar.CornerRadius = New-Object System.Windows.CornerRadius 2
    $bar.Background = New-Brush '#E4D9C2'
    $bar.VerticalAlignment = 'Center'
    $bar.Margin = New-Object System.Windows.Thickness 0, 0, 7, 0
    if ($done -gt 0) {
      $ratio = [double]$done / [double]$total
      $fill = New-Object System.Windows.Controls.Border
      $fill.Height = 3.5
      $fill.CornerRadius = New-Object System.Windows.CornerRadius 2
      $fill.Background = New-Brush '#7F9A7A'
      $fill.HorizontalAlignment = 'Left'
      $fill.Width = [Math]::Max(2, [Math]::Round(62 * $ratio))
      $bar.Child = $fill
    }
    $count = New-Text -Text ("$done/$total") -Size 10 -Color '#8A8172' -Margin '0,0,0,0'
    $count.VerticalAlignment = 'Center'
    if ($done -ge $total) { $count.Foreground = New-Brush '#3E6B5E' }
    [System.Windows.Controls.Grid]::SetColumn($bar, 0)
    [System.Windows.Controls.Grid]::SetColumn($count, 1)
    $line2.Children.Add($bar) | Out-Null
    $line2.Children.Add($count) | Out-Null
  }

  $tokText = '0'
  try { $tokText = Format-TokenCount $Session.tokens.total } catch { }
  $tok = New-Text -Text $tokText -Size 10 -Color '#6E7F79' -Margin '10,0,0,0'
  $tok.VerticalAlignment = 'Center'
  # 时长：在跑看「从建会话到现在」，闲着看「上次说话到现在」
  $durText = '—'
  try {
    if ($running) {
      $durText = Format-DurationMs $Session.durationMs
    } else {
      $lastPrompt = 0.0
      if ($null -ne $Session.lastPromptAt) { $lastPrompt = [double]$Session.lastPromptAt }
      if ($lastPrompt -gt 0) {
        $nowMs = 0.0
        try { if ($script:WorkData -and $null -ne $script:WorkData.now) { $nowMs = [double]$script:WorkData.now } } catch { }
        if ($nowMs -le 0) { $nowMs = [DateTimeOffset]::Now.ToUnixTimeMilliseconds() }
        $durText = Format-Ago ($nowMs - $lastPrompt)
      } else {
        $durText = Format-DurationMs $Session.durationMs
      }
    }
  } catch { }
  $dur = New-Text -Text $durText -Size 10 -Color '#9C8B6C' -Margin '8,0,2,0'
  $dur.VerticalAlignment = 'Center'
  [System.Windows.Controls.Grid]::SetColumn($tok, 3)
  [System.Windows.Controls.Grid]::SetColumn($dur, 4)
  $line2.Children.Add($tok) | Out-Null
  $line2.Children.Add($dur) | Out-Null
  $body.Children.Add($line2) | Out-Null

  if ($Open) { $body.Children.Add((New-WorkDetail -Session $Session)) | Out-Null }
  return $row
}

function Render-Work {
  param([switch]$Reveal)
  $offset = 0.0
  try { $offset = $scroll.VerticalOffset } catch { }
  $workList.Children.Clear()

  if (-not $script:WorkData) {
    $txtWorkMeta.Text = ''
    Update-WorkNote
    $hint = '正在读功课…'
    if ($script:WorkFailed) { $hint = '读不到功课 · 稍后再试' }
    $empty = New-Text -Text $hint -Size 12 -Color '#A08A68' -Margin '10,16,10,20'
    $empty.HorizontalAlignment = 'Center'
    $workList.Children.Add($empty) | Out-Null
    $scroll.UpdateLayout()
    $scroll.ScrollToVerticalOffset($offset)
    return
  }

  $sessions = @()
  try { if ($script:WorkData.sessions) { $sessions = @($script:WorkData.sessions) } } catch { }
  $run = 0
  try { if ($null -ne $script:WorkData.runningCount) { $run = [int]$script:WorkData.runningCount } } catch { }
  $total = 0
  try { if ($null -ne $script:WorkData.totalSessions) { $total = [int]$script:WorkData.totalSessions } } catch { }

  if ($run -gt 0) { $txtWorkMeta.Text = "$run 在跑 · 共 $total 个" }
  else { $txtWorkMeta.Text = "共 $total 个会话" }

  if ($sessions.Count -eq 0) {
    # 空状态：不画一张空卡片，就写一句话
    $empty = New-Text -Text '今日无功课' -Size 16 -Color '#8A8172' -Family 'KaiTi' -Margin '10,18,10,8'
    $empty.HorizontalAlignment = 'Center'
    $workList.Children.Add($empty) | Out-Null
    $idle = New-Text -Text '没有会话在等你，先歇一会儿' -Size 10 -Color '#B3A78F' -Margin '10,0,10,18'
    $idle.HorizontalAlignment = 'Center'
    $workList.Children.Add($idle) | Out-Null
    Update-WorkNote
    $scroll.UpdateLayout()
    $scroll.ScrollToVerticalOffset($offset)
    return
  }

  # 展开的那一行若已经被挤出列表，就当作没展开，别留一个看不见的展开状态
  $openId = [string]$script:WorkOpenId
  if ($openId) {
    $still = $false
    foreach ($s in $sessions) { if ($s -and [string]$s.id -eq $openId) { $still = $true; break } }
    if (-not $still) { $script:WorkOpenId = ''; $openId = '' }
  }

  # --- 按项目归组：同一个 project 的会话收成一个项目节点 ---
  # 组键和网页 groupSessions 一致：project → short → 未归类
  $groups = New-Object System.Collections.Generic.List[object]
  $groupIndex = @{}
  foreach ($s in $sessions) {
    if ($null -eq $s) { continue }
    $key = ''
    try { if ($s.project) { $key = ([string]$s.project).Trim() } } catch { }
    if (-not $key) { try { if ($s.short) { $key = ([string]$s.short).Trim() } } catch { } }
    if (-not $key) { $key = '未归类' }
    if (-not $groupIndex.ContainsKey($key)) {
      $g = [pscustomobject]@{
        Key = $key
        Items = (New-Object System.Collections.Generic.List[object])
        RunCount = 0
        HasRun = $false
        LastAt = 0.0
        Tokens = 0.0
        MinIdle = -1.0
      }
      $groupIndex[$key] = $g
      $groups.Add($g)
    }
    $g = $groupIndex[$key]
    $g.Items.Add($s)
    $tok = 0.0
    try { if ($null -ne $s.tokens.total) { $tok = [double]$s.tokens.total } } catch { }
    $g.Tokens = [double]$g.Tokens + $tok
    $lp = 0.0
    try { if ($null -ne $s.lastPromptAt) { $lp = [double]$s.lastPromptAt } } catch { }
    if ($lp -gt [double]$g.LastAt) { $g.LastAt = $lp }
    # 时间兜底：老会话可能没 lastPromptAt，就退回组内最小 idleMs（和网页一致）
    try {
      if ($null -ne $s.idleMs) {
        $idle = [double]$s.idleMs
        if ($idle -ge 0 -and ([double]$g.MinIdle -lt 0 -or $idle -lt [double]$g.MinIdle)) { $g.MinIdle = $idle }
      }
    } catch { }
    $sRun = $false
    try { $sRun = [bool]$s.running } catch { }
    if ($sRun) { $g.HasRun = $true; $g.RunCount = [int]$g.RunCount + 1 }
  }

  # 组间：有在跑的组优先，再按组内最近活动倒序（组名做稳定键）
  $groupSort = @(
    @{ Expression = { if ($_.HasRun) { 0 } else { 1 } } },
    @{ Expression = { [double]$_.LastAt }; Descending = $true },
    @{ Expression = { [string]$_.Key } }
  )
  $groupList = @($groups | Sort-Object -Property $groupSort)

  $nowMs = 0.0
  try { if ($script:WorkData -and $null -ne $script:WorkData.now) { $nowMs = [double]$script:WorkData.now } } catch { }
  if ($nowMs -le 0) { $nowMs = [DateTimeOffset]::Now.ToUnixTimeMilliseconds() }

  # 行数上限跟着宿主 roots 数（8），不再是写死的 6：
  # 同一项目的会话收成一组后行本来就少了，再按 6 砍会把一整组会话直接藏掉。
  $rowCap = 8
  $shown = 0
  $openEl = $null
  foreach ($g in $groupList) {
    if ($shown -ge $rowCap) { break }
    $closed = $false
    try { $closed = $script:ClosedProjects.ContainsKey([string]$g.Key) } catch { }

    # 组内最近活动；一次都没说过话就退回最小 idleMs（网页也是这么兜的）
    $agoMs = 0.0
    $lastAt = 0.0
    try { $lastAt = [double]$g.LastAt } catch { }
    if ($lastAt -gt 0) { $agoMs = $nowMs - $lastAt }
    else { try { if ([double]$g.MinIdle -gt 0) { $agoMs = [double]$g.MinIdle } } catch { } }

    # 一个组一个竖排容器：父行在上，子行挂在下面
    $box = New-Object System.Windows.Controls.StackPanel
    $box.Margin = New-Object System.Windows.Thickness 0, 1, 0, 6
    $box.Children.Add((New-WorkGroupRow -Group $g -Closed $closed -AgoMs $agoMs)) | Out-Null
    $workList.Children.Add($box) | Out-Null

    # 注意：PS 5.1 里对 PSCustomObject 上的 List 属性写 @($g.Items) 会抛
    # "Argument types do not match"，必须走 ToArray()。
    $kids = $g.Items.ToArray()
    if ($closed) {
      # 折叠的组照样占上限：只是没画子行，会话还是那些
      $shown += $kids.Count
      continue
    }
    # 子行容器：对应网页 .fj-spine 的 margin「1px 0 3px 16px」——左边 16 就是竖线位置
    $spine = New-Object System.Windows.Controls.StackPanel
    $spine.Margin = New-Object System.Windows.Thickness 16, 1, 0, 3
    $box.Children.Add($spine) | Out-Null

    # 组内：在跑排前，再按 lastPromptAt 倒序（id 做稳定键）
    $itemSort = @(
      @{ Expression = { if ([bool]$_.running) { 0 } else { 1 } } },
      @{ Expression = { $lp = 0.0; try { if ($null -ne $_.lastPromptAt) { $lp = [double]$_.lastPromptAt } } catch { }; $lp }; Descending = $true },
      @{ Expression = { [string]$_.id } }
    )
    $items = @($kids | Sort-Object -Property $itemSort)
    for ($i = 0; $i -lt $items.Count; $i++) {
      if ($shown -ge $rowCap) { break }
      $s = $items[$i]
      if ($null -eq $s) { continue }
      $isLast = ($i -eq ($items.Count - 1))
      $open = ($openId -ne '' -and [string]$s.id -eq $openId)
      $row = New-WorkRow -Session $s -Open $open
      # 行间距 5（对应网页 .fj-spine 的 gap 5px）；最后一行不再留，交给组的 3px 底边
      if ($isLast) { $row.Margin = New-Object System.Windows.Thickness 0, 0, 0, 0 }
      else { $row.Margin = New-Object System.Windows.Thickness 0, 0, 0, 5 }
      $row.Add_PreviewMouseLeftButtonUp({
          try {
            # 行里的小按钮（「在 DSH 里打开」）自己处理点击，别把行顺手收起来
            if (Test-HitInsideButton -Source $_.OriginalSource -StopAt $this) { return }
            $id = [string]$this.Tag
            if (-not $id) { return }
            if ([string]$script:WorkOpenId -eq $id) { $script:WorkOpenId = '' }
            else { $script:WorkOpenId = $id }
            Render-Work -Reveal
            Fit-WindowHeight
          } catch { }
        })
      $node = New-WorkTreeNode -Card $row -Last $isLast
      $spine.Children.Add($node) | Out-Null
      if ($open) { $openEl = $row }
      $shown++
    }
  }

  Update-WorkNote

  $scroll.UpdateLayout()
  $scroll.ScrollToVerticalOffset($offset)

  # 点开一行时把它带进视野：展开的详单在卡片底部时不该要用户自己滚
  # （行现在包在树节点 Grid 里，不能再按 $workList 的一级子元素找 Border，直接记住行）
  if ($Reveal -and $openEl) {
    try { $openEl.BringIntoView() } catch { }
  }
}

function Toggle-Card {
  if ($script:ShowingCard) {
    $script:ShowingCard = $false
    $script:ShowingStudy = $false
    $cardBorder.Visibility = 'Collapsed'
    Set-Look 600   # 合卷，抬眼看你一下
    Set-CardSize $false
    Update-PetImage
    Fit-WindowHeight
    # 收起后按 15 秒的节奏拉在跑数；先立刻要一次，别让标签停在旧数字上
    Request-WorkUpdate
  } else {
    $script:ShowingCard = $true
    $script:ShowingStudy = $false
    $script:PageIndex = 0
    $script:PinnedId = $null
    $cardBorder.Visibility = 'Visible'
    Set-Look 400   # 先抬眼「哦，是你」，再低头捧经
    Set-CardSize $true
    Refresh-State | Out-Null
    # 每次展开都落在功课页（默认页）；读经页只能从 tab 点进去
    $script:CardTab = 'work'
    # 功课页保留上次展开的那一行，收起再打开也能接着看
    Set-CardTab $script:CardTab
    Fit-WindowHeight
    Update-PetImage
    Request-WorkUpdate
    $shown = Get-PageCard
    if ($shown -and -not $shown.read -and $script:CardTab -eq 'read') {
      try { Invoke-PetApi -Method 'POST' -Url $ReadUrl -Body @{ id = $shown.id } | Out-Null } catch { }
    }
  }
}

function Invoke-Next {
  param([string]$SutraId = '')
  if ($script:Busy) { return }
  $script:Busy = $true
  $btnNext.Content = '翻页中…'
  try {
    $body = @{}
    if ($SutraId) { $body['sutraId'] = $SutraId }
    Invoke-PetApi -Method 'POST' -Url $NextUrl -Body $body | Out-Null
    $script:ShowingStudy = $false
    $script:PageIndex = 0
    $script:PinnedId = $null
    Refresh-State | Out-Null
    Render-Card
    Update-PetImage
  } catch {
    $detail = $_.Exception.Message
    if ($detail.Length -gt 40) { $detail = $detail.Substring(0, 40) }
    $txtStatus.Text = "出卡失败 · $detail"
  } finally {
    $script:Busy = $false
    $btnNext.Content = '再读一句'
  }
}

# --- 联网取经 ---------------------------------------------------------------
# 告诉 Host「我站着呢」，否则网页里会再画一只，桌上就两只莲鲸
function Send-Heartbeat {
  try { Invoke-PetApi -Method 'POST' -Url $BeatUrl -Body @{ action = 'heartbeat'; pid = $PID } | Out-Null } catch { }
}

function Get-Catalog {
  try {
    $payload = Invoke-PetApi -Method 'GET' -Url $CatalogUrl
    return @($payload.items)
  } catch {
    return @()
  }
}

function Invoke-Import {
  param([string]$CatalogId = '')
  if (-not $CatalogId) { return }
  if ($script:Busy) { return }
  $script:Busy = $true
  try {
    $txtStatus.Text = '联网取经中…'
    # 抓网页要几秒，先把「取经中」这几个字画出来，不然界面像卡死
    $window.Dispatcher.Invoke([action] {}, [System.Windows.Threading.DispatcherPriority]::Background)
    $result = Invoke-PetApi -Method 'POST' -Url $ImportUrl -Body @{ catalogId = $CatalogId }
    Refresh-State | Out-Null
    Render-Card
    Update-PetImage
    $txtStatus.Text = "取回《$($result.title)》· $($result.count) 段"
  } catch {
    $detail = $_.Exception.Message
    if ($detail.Length -gt 40) { $detail = $detail.Substring(0, 40) }
    $txtStatus.Text = "取经失败 · $detail"
  } finally {
    $script:Busy = $false
  }
}

# --- 交互 -------------------------------------------------------------------
# 用 WPF 原生 DragMove：它自己处理 DPI，不会像手算像素差那样越拖越偏。
# DragMove 会阻塞到松手，所以用「位置有没有变」来区分拖动和单击。
function Move-PetTo {
  param([double]$Left, [double]$Top)
  # 整只窗留在工作区内：不能让桌宠「拖到屏幕边缘就再也找不到」。
  # 拖动时按光标所在那块屏算，副屏上也能拖到头。
  $wa = Get-CursorWorkArea
  $maxLeft = [Math]::Max($wa.Left, $wa.Right - $window.Width)
  $maxTop = [Math]::Max($wa.Top, $wa.Bottom - $window.Height)
  $window.Left = [Math]::Max($wa.Left, [Math]::Min($Left, $maxLeft))
  $window.Top = [Math]::Max($wa.Top, [Math]::Min($Top, $maxTop))
}

# 拖动与点击的判定不用 Window.DragMove：窗口未激活时它会吞掉单击，
# 而且它按物理像素移动窗口，在 175% 缩放下会把窗口甩到屏幕外。
# 这里自己算：光标位移（物理像素）÷ DPI 缩放 = 窗口位移（DIP）。
function Get-DpiScale {
  $source = [System.Windows.PresentationSource]::FromVisual($window)
  if ($source -and $source.CompositionTarget) { return $source.CompositionTarget.TransformToDevice.M11 }
  return 1.0
}

$script:Drag = $null
$script:DragMoved = $false

# 鼠标一进来就把窗口激活：否则第一次点击只会用来激活窗口，用户会觉得「点了没反应」。
$petImage.Add_MouseEnter({ try { $window.Activate() } catch { } })

$petImage.Add_MouseLeftButtonDown({
    if ($_.ChangedButton -ne [System.Windows.Input.MouseButton]::Left) { return }
    $cursor = [System.Windows.Forms.Cursor]::Position
    $script:Drag = @{
      x = $cursor.X
      y = $cursor.Y
      left = $window.Left
      top = $window.Top
      scale = Get-DpiScale
    }
    $script:DragMoved = $false
    [void]$petImage.CaptureMouse()
    $_.Handled = $true
  })

$petImage.Add_MouseMove({
    if (-not $script:Drag) { return }
    $cursor = [System.Windows.Forms.Cursor]::Position
    $dx = ($cursor.X - $script:Drag.x) / $script:Drag.scale
    $dy = ($cursor.Y - $script:Drag.y) / $script:Drag.scale
    if (-not $script:DragMoved -and ([Math]::Abs($dx) -gt 3 -or [Math]::Abs($dy) -gt 3)) {
      $script:DragMoved = $true
    }
    if ($script:DragMoved) {
      $window.Left = $script:Drag.left + $dx
      $window.Top = $script:Drag.top + $dy
    }
    $_.Handled = $true
  })

$petImage.Add_MouseLeftButtonUp({
    if (-not $script:Drag) { return }
    $moved = $script:DragMoved
    $script:Drag = $null
    $script:DragMoved = $false
    [void]$petImage.ReleaseMouseCapture()
    if ($moved) {
      Set-Look 400   # 放下了，看你一眼
      Move-PetTo -Left $window.Left -Top $window.Top   # 拖完拉回屏内
    } else {
      # 点正中间（身体那块椭圆）敲木鱼；点四周/头部/边缘仍然是展开卡片
      $inBody = $false
      try {
        $pos = $_.GetPosition($petImage)
        $w = [double]$petImage.ActualWidth
        $h = [double]$petImage.ActualHeight
        if ($w -gt 0 -and $h -gt 0) {
          # 椭圆：中心在图片中心偏下（宽 50%、高 56%），半轴 宽×0.30 / 高×0.26
          $nx = ($pos.X - ($w / 2)) / ($w * 0.30)
          $ny = ($pos.Y - ($h * 0.56)) / ($h * 0.26)
          if (($nx * $nx + $ny * $ny) -le 1.0) { $inBody = $true }
        }
      } catch { $inBody = $false }
      if ($inBody) { Invoke-MuyuKnock } else { Toggle-Card }
    }
    $_.Handled = $true
  })

# 小标签 / 敲击数是「大目标」：点它们也展开或收起卡片（立绘中间留给木鱼）
$tagBorder.Cursor = [System.Windows.Input.Cursors]::Hand
$knockBorder.Cursor = [System.Windows.Input.Cursors]::Hand
$tagBorder.Add_MouseLeftButtonUp({ try { Toggle-Card } catch { } })
$knockBorder.Add_MouseLeftButtonUp({ try { Toggle-Card } catch { } })
$badge.Add_MouseLeftButtonUp({ try { Toggle-Card } catch { } })

$btnClose.Add_Click({ Toggle-Card })
$btnNext.Add_Click({ Invoke-Next })
$btnOlder.Add_Click({ Step-Page 1 })
$btnNewer.Add_Click({ Step-Page -1 })
$btnRefresh.Add_Click({
    Request-WorkUpdate
    $txtStatus.Text = '刷新中…'
  })
$btnMore.Add_Click({
    $script:ShowExtra = -not $script:ShowExtra
    Render-Card
  })

$menu = New-Object System.Windows.Controls.ContextMenu
$miReset = New-Object System.Windows.Controls.MenuItem
$miReset.Header = '复位位置'
$miReset.Add_Click({ Reset-PetPosition })
$miHide = New-Object System.Windows.Controls.MenuItem
$miHide.Header = '收起卡片'
$miHide.Add_Click({ if ($script:ShowingCard) { Toggle-Card } })
$miQuit = New-Object System.Windows.Controls.MenuItem
$miQuit.Header = '退出桌宠'
$miQuit.Add_Click({ $window.Close() })
# 取经：子菜单在展开时才去问一次经目，省得每分钟都打接口
$miFetch = New-Object System.Windows.Controls.MenuItem
$miFetch.Header = '取经（联网）'
$miFetch.Add_SubmenuOpened({
    try {
      $miFetch.Items.Clear()
      $items = @(Get-Catalog)
      if (-not $items.Count) {
        $none = New-Object System.Windows.Controls.MenuItem
        $none.Header = '取不到经目'
        $none.IsEnabled = $false
        $miFetch.Items.Add($none) | Out-Null
        return
      }
      foreach ($item in $items) {
        $mi = New-Object System.Windows.Controls.MenuItem
        if ($item.installed) {
          $mi.Header = "$($item.title)（已收录）"
          $mi.IsEnabled = $false
        } else {
          $mi.Header = "$($item.title) · 联网取回"
          $mi.Tag = $item.id
          $mi.Add_Click({
              try {
                $id = $this.Tag
                if ($id) { Invoke-Import $id }
              } catch {
                $txtStatus.Text = '取经失败'
              }
            })
        }
        $miFetch.Items.Add($mi) | Out-Null
      }
    } catch { }
  })
$menu.Items.Add($miReset) | Out-Null
$menu.Items.Add($miHide) | Out-Null
$menu.Items.Add($miFetch) | Out-Null
$menu.Items.Add((New-Object System.Windows.Controls.Separator)) | Out-Null
$menu.Items.Add($miQuit) | Out-Null
$petImage.ContextMenu = $menu

# --- 眼神节拍 ---------------------------------------------------------------
# 只负责「睁眼那几秒到期了没」和「未读的间歇抬眼」：一秒一次，图没变就不动。
$lookTimer = New-Object System.Windows.Threading.DispatcherTimer
$lookTimer.Interval = [TimeSpan]::FromSeconds(1)
$lookTimer.Add_Tick({ Update-PetImage; Update-PetTag })
$lookTimer.Start()

# --- 功课节拍 ---------------------------------------------------------------
# 每 600ms 看一眼后台请求回来了没；到点（卡片开着 5s / 收着 15s）就发下一次。
# 这一拍只做「检查 + 应用 + 重建」，网络在 runspace 里，UI 线程不会卡。
$workTimer = New-Object System.Windows.Threading.DispatcherTimer
$workTimer.Interval = [TimeSpan]::FromMilliseconds(600)
$workTimer.Add_Tick({ try { Update-Work } catch { } })
$workTimer.Start()

# --- 敲木鱼节拍 -------------------------------------------------------------
# 150ms 一拍：收音效下载结果、收 POST 彩头、清掉飘完的字；网络全在 runspace 里。
$knockTimer = New-Object System.Windows.Threading.DispatcherTimer
$knockTimer.Interval = [TimeSpan]::FromMilliseconds(150)
$knockTimer.Add_Tick({ try { Update-Knocks } catch { } })
$knockTimer.Start()

# --- 轮询 -------------------------------------------------------------------
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds(20)
$timer.Add_Tick({
    # 兜底：任何原因跑到屏幕外（显示器拔插、缩放变化）都拉回来，否则用户再也点不到她。
    if (-not (Test-OnScreen)) { Reset-PetPosition }
    Refresh-State | Out-Null
    if ($script:ShowingCard -and -not $script:ShowingStudy) { Render-Card }
    Send-Heartbeat
  })
$timer.Start()

$window.Add_Loaded({
    # 先把上次的尺寸档读回来并落位，再按新的窗口高度找右下角（否则会按大档的高度飘一下）
    Apply-PetSize (Read-SizePreset)
    # 落到「鼠标所在那块屏」的右下角：用户刚点完按钮，光标就在他眼前那块屏上。
    Reset-PetPosition
    Set-PetImage 'idle'
    Update-TabBar
    Refresh-State | Out-Null
    Update-PetTag
    Request-WorkUpdate
    Start-WavFetch        # 音效只下一次，之后用本地预加载的 SoundPlayer
    Send-Heartbeat
  })

# 退出时把后台 runspace / 飞行中的请求收掉，别留一个孤儿线程
$window.Add_Closed({
    try {
      if ($script:WorkPending) {
        $script:WorkPending.ps.Stop()
        $script:WorkPending.ps.Dispose()
        $script:WorkPending = $null
      }
    } catch { }
    try {
      if ($script:WorkRunspace) {
        $script:WorkRunspace.Close()
        $script:WorkRunspace.Dispose()
        $script:WorkRunspace = $null
      }
    } catch { }
    # 木鱼的请求 / 音效下载 / 临时 wav 一起收掉，别留孤儿线程和临时文件
    try {
      if ($script:KnockPending) {
        $script:KnockPending.ps.Stop()
        $script:KnockPending.ps.Dispose()
        $script:KnockPending = $null
      }
      if ($script:WavPending) {
        $script:WavPending.ps.Stop()
        $script:WavPending.ps.Dispose()
        $script:WavPending = $null
      }
    } catch { }
    try {
      if ($script:KnockRunspace) {
        $script:KnockRunspace.Close()
        $script:KnockRunspace.Dispose()
        $script:KnockRunspace = $null
      }
      if ($script:WavRunspace) {
        $script:WavRunspace.Close()
        $script:WavRunspace.Dispose()
        $script:WavRunspace = $null
      }
    } catch { }

    # 「在 DSH 里打开」的飞行中请求 / runspace 也一起收掉，别留孤儿线程
    try {
      if ($script:OpenPending) {
        $script:OpenPending.ps.Stop()
        $script:OpenPending.ps.Dispose()
        $script:OpenPending = $null
      }
      if ($script:OpenRunspace) {
        $script:OpenRunspace.Close()
        $script:OpenRunspace.Dispose()
        $script:OpenRunspace = $null
      }
    } catch { }
    try { if ($script:KnockSound) { $script:KnockSound.Dispose(); $script:KnockSound = $null } } catch { }
    try { if (Test-Path $MuyuWavPath) { Remove-Item $MuyuWavPath -Force -ErrorAction SilentlyContinue } } catch { }
    try { if (Test-Path $KnockSpriteTemp) { Remove-Item $KnockSpriteTemp -Force -ErrorAction SilentlyContinue } } catch { }
  })

# 最后一道保险：单个交互出错时把错误显示在状态行，别让整个桌宠退出。
$window.Dispatcher.Add_UnhandledException({
    try {
      $e = $args[1]
      if ($e -and $e.Exception) {
        $e.Handled = $true
        $txtStatus.Text = '出错了 · ' + $e.Exception.Message
      }
    } catch { }
  })

[void]$window.ShowDialog()

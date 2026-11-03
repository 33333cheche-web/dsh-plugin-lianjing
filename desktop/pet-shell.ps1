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

$PetHeight  = 210
$CardHeight = 470
$OpenPetHeight = 210
$WindowWidth = 448

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

# 经书选择用的圆角小胶囊
function New-SutraChip {
  param([string]$Title, [string]$SutraId, [bool]$Active, [string]$Tip)
  $chip = New-Object System.Windows.Controls.Border
  $chip.CornerRadius = New-Object System.Windows.CornerRadius 999
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
$cardPanel.Add_SizeChanged({ $scroll.ScrollToVerticalOffset(0) })

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
$btnRow.Children.Add($btnMore) | Out-Null
$btnRow.Children.Add($btnClose) | Out-Null
$btnRow.Children.Add($btnNext) | Out-Null

$txtStatus = New-Text -Text '' -Size 9 -Color '#C07D6F' -Margin '0,6,0,0'

$cardPanel.Children.Add($headRow) | Out-Null
$cardPanel.Children.Add($txtTitle) | Out-Null
$cardPanel.Children.Add($txtMeta) | Out-Null
$cardPanel.Children.Add($pickerPanel) | Out-Null
$cardPanel.Children.Add($rule) | Out-Null
$cardPanel.Children.Add($txtLabel1) | Out-Null
$cardPanel.Children.Add($txtCite) | Out-Null
$cardPanel.Children.Add($noteBorder) | Out-Null
$cardPanel.Children.Add($txtLabelTerms) | Out-Null
$cardPanel.Children.Add($termsPanel) | Out-Null
$cardPanel.Children.Add($txtLabel2) | Out-Null
$cardPanel.Children.Add($txtPractice) | Out-Null

$footPanel.Children.Add($btnRow) | Out-Null
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

$badge = New-Object System.Windows.Controls.Border
$badge.CornerRadius = New-Object System.Windows.CornerRadius 9
$badge.Background = (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString($Accent)))
$badge.HorizontalAlignment = 'Right'
$badge.VerticalAlignment = 'Top'
$badge.Margin = New-Object System.Windows.Thickness 0, 6, 6, 0
$badge.Padding = New-Object System.Windows.Thickness 5, 0, 5, 0
$badge.Visibility = 'Collapsed'
$badgeText = New-Text -Text '1' -Size 10 -Color '#FFFDF5' -Weight 'Bold'
$badgeText.HorizontalAlignment = 'Center'
$badge.Child = $badgeText
$petHost.Children.Add($badge) | Out-Null

$stack.Children.Add($petHost) | Out-Null

# --- 状态 -------------------------------------------------------------------
$script:State = $null
$script:Busy = $false
$script:ShowingStudy = $false
$script:Sutra = $null

$spriteIdle = Join-Path $AssetDir 'pet-idle.png'
$spriteOpen = Join-Path $AssetDir 'pet-open.png'
$spriteRead = Join-Path $AssetDir 'pet-read.png'

function Set-PetImage {
  param([string]$Kind)
  # 眼神会按秒重算，同一张图不要反复解码
  if ($script:PetKind -eq $Kind -and $petBrush.ImageSource) { return }
  $path = switch ($Kind) {
    'open' { $spriteOpen }
    'read' { $spriteRead }
    default { $spriteIdle }
  }
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
  $height = if ($open) { $CardHeight + $OpenPetHeight + 40 } else { $PetHeight + 40 }
  # 展开时把立绘缩小，把省下的纵向空间让给经文与释义
  $petImage.Height = $petH
  $petImage.Width = [int]($petH * 0.96)
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
  $floor = $PetHeight + 20
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
    if ($script:State.unread -gt 0) {
      $badge.Visibility = 'Visible'
      $badgeText.Text = [string]$script:State.unread
      if ($script:State.unread -gt 9) { $badgeText.Text = '9+' }
    } else {
      $badge.Visibility = 'Collapsed'
    }
    Update-PetImage
    return $true
  } catch {
    Show-Error '连不上 DSH，显示的是最后一条'
    return $false
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
  } else {
    $script:ShowingCard = $true
    $script:ShowingStudy = $false
    $script:PageIndex = 0
    $script:PinnedId = $null
    $cardBorder.Visibility = 'Visible'
    Set-Look 400   # 先抬眼「哦，是你」，再低头捧经
    Set-CardSize $true
    Refresh-State | Out-Null
    Render-Card
    Fit-WindowHeight
    Update-PetImage
    $shown = Get-PageCard
    if ($shown -and -not $shown.read) {
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
      Toggle-Card
    }
    $_.Handled = $true
  })

$btnClose.Add_Click({ Toggle-Card })
$btnNext.Add_Click({ Invoke-Next })
$btnOlder.Add_Click({ Step-Page 1 })
$btnNewer.Add_Click({ Step-Page -1 })
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
$lookTimer.Add_Tick({ Update-PetImage })
$lookTimer.Start()

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
    # 落到「鼠标所在那块屏」的右下角：用户刚点完按钮，光标就在他眼前那块屏上。
    Reset-PetPosition
    Set-PetImage 'idle'
    Refresh-State | Out-Null
    Send-Heartbeat
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

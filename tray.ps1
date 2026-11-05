param([int]$Port = 47322, [string]$IconPath, [string]$AppName = 'StudyDash')
# StudyDash system-tray helper. Talks to the StudyDash app over localhost.
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$base = "http://127.0.0.1:$Port"
function Call([string]$p) {
  try {
    $wc = New-Object System.Net.WebClient
    $wc.Encoding = [System.Text.Encoding]::UTF8
    $wc.Headers.Add('Content-Type', 'application/json')
    return $wc.UploadString("$base$p", 'POST', '{}')
  } catch { return $null }
}

$ni = New-Object System.Windows.Forms.NotifyIcon
$script:iconChanged = $null
$script:ownsIcon = $false
function Update-StudyDashIcon {
  if (!$IconPath -or !(Test-Path -LiteralPath $IconPath)) { return }
  $changed = (Get-Item -LiteralPath $IconPath).LastWriteTimeUtc.Ticks
  if ($changed -eq $script:iconChanged) { return }
  try {
    $bytes = [System.IO.File]::ReadAllBytes($IconPath)
    $stream = New-Object System.IO.MemoryStream(,$bytes)
    $loaded = New-Object System.Drawing.Icon($stream)
    $replacement = $loaded.Clone()
    $loaded.Dispose()
    $stream.Dispose()
    $previous = $ni.Icon
    $ni.Icon = $replacement
    if ($script:ownsIcon -and $previous) { $previous.Dispose() }
    $script:ownsIcon = $true
    $script:iconChanged = $changed
  } catch {}
}
$ni.Icon = [System.Drawing.SystemIcons]::Information
Update-StudyDashIcon
$ni.Text = $AppName

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$open = $menu.Items.Add('Open dashboard')
$open.Font = New-Object System.Drawing.Font($open.Font, [System.Drawing.FontStyle]::Bold)
$open.add_Click({ Call '/api/open' | Out-Null })
$sync = $menu.Items.Add('Sync Classroom, Canvas and Gmail')
$sync.add_Click({ Call '/api/sync-all' | Out-Null })
$test = $menu.Items.Add('Send test notification')
$test.add_Click({ Call '/api/test-notification' | Out-Null })
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$quit = $menu.Items.Add("Quit $AppName (stops reminders)")
$quit.add_Click({
  Call '/api/quit' | Out-Null
  $ni.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})
$ni.ContextMenuStrip = $menu
$ni.add_MouseClick({ param($s, $e) if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Call '/api/open' | Out-Null } })
$ni.add_BalloonTipClicked({ Call '/api/open' | Out-Null })
$ni.Visible = $true

$script:fails = 0
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 3000
$timer.add_Tick({
  Update-StudyDashIcon
  $r = Call '/api/tray/poll'
  if ($r -eq $null) {
    $script:fails++
    if ($script:fails -ge 6) { $ni.Visible = $false; [System.Windows.Forms.Application]::Exit() }
    return
  }
  $script:fails = 0
  $o = $r | ConvertFrom-Json
  if ($o.quit) { $ni.Visible = $false; [System.Windows.Forms.Application]::Exit(); return }
  foreach ($b in $o.balloons) { $ni.ShowBalloonTip(10000, [string]$b.title, [string]$b.body, [System.Windows.Forms.ToolTipIcon]::Info) }
  if ($o.tip) { $t = [string]$o.tip; if ($t.Length -gt 63) { $t = $t.Substring(0, 63) }; $ni.Text = $t }
})
$timer.Start()
[System.Windows.Forms.Application]::Run()
$ni.Dispose()

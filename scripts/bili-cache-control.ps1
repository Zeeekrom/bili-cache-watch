Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$node = "node.exe"
$cloudflared = Join-Path $root "tools\cloudflared.exe"
$serverOut = Join-Path $root "data\server-3001.out.log"
$serverErr = Join-Path $root "data\server-3001.err.log"
$tunnelOut = Join-Path $root "data\cloudflared.out.log"
$tunnelErr = Join-Path $root "data\cloudflared.err.log"
$localUrl = "http://localhost:3001"

function Ensure-DataDir {
  New-Item -ItemType Directory -Force (Join-Path $root "data") | Out-Null
}

function Get-ServerProcess {
  Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -like "*New project 4*src/server.js*" } |
    Select-Object -First 1
}

function Get-TunnelProcess {
  Get-Process cloudflared -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Start-Server {
  Ensure-DataDir
  if (Get-ServerProcess) { return }
  Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "node --experimental-sqlite src/server.js" `
    -WorkingDirectory $root `
    -RedirectStandardOutput $serverOut `
    -RedirectStandardError $serverErr `
    -WindowStyle Hidden
}

function Start-Tunnel {
  Ensure-DataDir
  if (!(Test-Path $cloudflared)) {
    throw "找不到 cloudflared.exe：$cloudflared"
  }
  if (Get-TunnelProcess) { return }
  Remove-Item $tunnelOut, $tunnelErr -ErrorAction SilentlyContinue
  Start-Process -FilePath $cloudflared `
    -ArgumentList "tunnel", "--url", $localUrl, "--no-autoupdate" `
    -WorkingDirectory $root `
    -RedirectStandardOutput $tunnelOut `
    -RedirectStandardError $tunnelErr `
    -WindowStyle Hidden
}

function Stop-All {
  Get-TunnelProcess | Stop-Process -ErrorAction SilentlyContinue
  $server = Get-ServerProcess
  if ($server) {
    Stop-Process -Id $server.ProcessId -ErrorAction SilentlyContinue
  }
}

function Get-TunnelUrl {
  $logs = @()
  if (Test-Path $tunnelOut) { $logs += Get-Content $tunnelOut -ErrorAction SilentlyContinue }
  if (Test-Path $tunnelErr) { $logs += Get-Content $tunnelErr -ErrorAction SilentlyContinue }
  $line = $logs | Select-String -Pattern "https://[-a-z0-9]+\.trycloudflare\.com" | Select-Object -Last 1
  if ($line) {
    return $line.Matches[0].Value
  }
  return ""
}

function Refresh-Status {
  $server = Get-ServerProcess
  $tunnel = Get-TunnelProcess
  $url = Get-TunnelUrl

  $serverLabel.Text = if ($server) { "网站：运行中 (PID $($server.ProcessId))" } else { "网站：未运行" }
  $tunnelLabel.Text = if ($tunnel) { "公网隧道：运行中 (PID $($tunnel.Id))" } else { "公网隧道：未运行" }
  $urlBox.Text = $url
  $openPublicButton.Enabled = [bool]$url
  $copyButton.Enabled = [bool]$url
}

function Show-Error($message) {
  [System.Windows.Forms.MessageBox]::Show($message, "Bili Cache Watch", "OK", "Error") | Out-Null
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "Bili Cache Watch 控制面板"
$form.Size = New-Object System.Drawing.Size(620, 330)
$form.StartPosition = "CenterScreen"
$form.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 10)

$serverLabel = New-Object System.Windows.Forms.Label
$serverLabel.Location = New-Object System.Drawing.Point(20, 20)
$serverLabel.Size = New-Object System.Drawing.Size(560, 26)

$tunnelLabel = New-Object System.Windows.Forms.Label
$tunnelLabel.Location = New-Object System.Drawing.Point(20, 50)
$tunnelLabel.Size = New-Object System.Drawing.Size(560, 26)

$urlLabel = New-Object System.Windows.Forms.Label
$urlLabel.Text = "公网地址："
$urlLabel.Location = New-Object System.Drawing.Point(20, 88)
$urlLabel.Size = New-Object System.Drawing.Size(90, 26)

$urlBox = New-Object System.Windows.Forms.TextBox
$urlBox.Location = New-Object System.Drawing.Point(110, 86)
$urlBox.Size = New-Object System.Drawing.Size(470, 26)
$urlBox.ReadOnly = $true

$startButton = New-Object System.Windows.Forms.Button
$startButton.Text = "启动网站 + 公网隧道"
$startButton.Location = New-Object System.Drawing.Point(20, 130)
$startButton.Size = New-Object System.Drawing.Size(180, 42)
$startButton.Add_Click({
  try {
    Start-Server
    Start-Sleep -Seconds 2
    Start-Tunnel
    Start-Sleep -Seconds 8
    Refresh-Status
  } catch {
    Show-Error $_.Exception.Message
  }
})

$stopButton = New-Object System.Windows.Forms.Button
$stopButton.Text = "关闭全部"
$stopButton.Location = New-Object System.Drawing.Point(215, 130)
$stopButton.Size = New-Object System.Drawing.Size(110, 42)
$stopButton.Add_Click({
  Stop-All
  Start-Sleep -Milliseconds 500
  Refresh-Status
})

$refreshButton = New-Object System.Windows.Forms.Button
$refreshButton.Text = "刷新状态"
$refreshButton.Location = New-Object System.Drawing.Point(340, 130)
$refreshButton.Size = New-Object System.Drawing.Size(110, 42)
$refreshButton.Add_Click({ Refresh-Status })

$openLocalButton = New-Object System.Windows.Forms.Button
$openLocalButton.Text = "打开本地"
$openLocalButton.Location = New-Object System.Drawing.Point(20, 188)
$openLocalButton.Size = New-Object System.Drawing.Size(110, 38)
$openLocalButton.Add_Click({ Start-Process $localUrl })

$openPublicButton = New-Object System.Windows.Forms.Button
$openPublicButton.Text = "打开公网"
$openPublicButton.Location = New-Object System.Drawing.Point(145, 188)
$openPublicButton.Size = New-Object System.Drawing.Size(110, 38)
$openPublicButton.Add_Click({
  if ($urlBox.Text) { Start-Process $urlBox.Text }
})

$copyButton = New-Object System.Windows.Forms.Button
$copyButton.Text = "复制公网地址"
$copyButton.Location = New-Object System.Drawing.Point(270, 188)
$copyButton.Size = New-Object System.Drawing.Size(140, 38)
$copyButton.Add_Click({
  if ($urlBox.Text) { [System.Windows.Forms.Clipboard]::SetText($urlBox.Text) }
})

$inviteLabel = New-Object System.Windows.Forms.Label
$inviteLabel.Text = "邀请码：reeshiram-YuBirdSing-202605"
$inviteLabel.Location = New-Object System.Drawing.Point(20, 245)
$inviteLabel.Size = New-Object System.Drawing.Size(560, 26)

$form.Controls.AddRange(@(
  $serverLabel,
  $tunnelLabel,
  $urlLabel,
  $urlBox,
  $startButton,
  $stopButton,
  $refreshButton,
  $openLocalButton,
  $openPublicButton,
  $copyButton,
  $inviteLabel
))

Refresh-Status
[void]$form.ShowDialog()

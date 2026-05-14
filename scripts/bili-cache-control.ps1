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
  $server = Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -like "*src/server.js*" -and $_.CommandLine -like "*$root*" } |
    Select-Object -First 1
  if ($server) { return $server }

  Get-LocalPortProcessIds | ForEach-Object {
    Get-CimInstance Win32_Process -Filter "ProcessId = $_" -ErrorAction SilentlyContinue
  } |
    Where-Object { $_.Name -eq "node.exe" } |
    Select-Object -First 1
}

function Get-TunnelProcess {
  $cloudflaredName = [System.IO.Path]::GetFileNameWithoutExtension($cloudflared)
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -eq "$cloudflaredName.exe" -and
      ($_.ExecutablePath -eq $cloudflared -or $_.CommandLine -like "*--url $localUrl*")
    }
}

function Get-LocalPortProcessIds {
  Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
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
    throw "cloudflared.exe was not found: $cloudflared"
  }
  if (Get-TunnelProcess) { return }
  Remove-Item $tunnelOut, $tunnelErr -ErrorAction SilentlyContinue
  Start-Process -FilePath $cloudflared `
    -ArgumentList "tunnel", "--url", $localUrl, "--protocol", "http2", "--no-autoupdate" `
    -WorkingDirectory $root `
    -RedirectStandardOutput $tunnelOut `
    -RedirectStandardError $tunnelErr `
    -WindowStyle Hidden
}

function Stop-All {
  Get-TunnelProcess | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
  $server = Get-ServerProcess
  if ($server) {
    Stop-Process -Id $server.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Get-LocalPortProcessIds | ForEach-Object {
    Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
  }
  Remove-Item $tunnelOut, $tunnelErr -ErrorAction SilentlyContinue
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
  $tunnel = @(Get-TunnelProcess)
  $url = if ($tunnel.Count -gt 0) { Get-TunnelUrl } else { "" }

  $serverLabel.Text = if ($server) { "Web app: running (PID $($server.ProcessId))" } else { "Web app: stopped" }
  $tunnelLabel.Text = if ($tunnel.Count -gt 0) { "Public tunnel: running (PID $($tunnel[0].ProcessId))" } else { "Public tunnel: stopped" }
  $urlBox.Text = $url
  $openPublicButton.Enabled = ($tunnel.Count -gt 0 -and [bool]$url)
  $copyButton.Enabled = ($tunnel.Count -gt 0 -and [bool]$url)
}

function Show-Error($message) {
  [System.Windows.Forms.MessageBox]::Show($message, "Bili Cache Watch", "OK", "Error") | Out-Null
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "Bili Cache Watch Control Panel"
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
$urlLabel.Text = "Public URL:"
$urlLabel.Location = New-Object System.Drawing.Point(20, 88)
$urlLabel.Size = New-Object System.Drawing.Size(90, 26)

$urlBox = New-Object System.Windows.Forms.TextBox
$urlBox.Location = New-Object System.Drawing.Point(110, 86)
$urlBox.Size = New-Object System.Drawing.Size(470, 26)
$urlBox.ReadOnly = $true

$startButton = New-Object System.Windows.Forms.Button
$startButton.Text = "Start App + Public Tunnel"
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
$stopButton.Text = "Stop All"
$stopButton.Location = New-Object System.Drawing.Point(215, 130)
$stopButton.Size = New-Object System.Drawing.Size(110, 42)
$stopButton.Add_Click({
  Stop-All
  Start-Sleep -Milliseconds 500
  Refresh-Status
})

$refreshButton = New-Object System.Windows.Forms.Button
$refreshButton.Text = "Refresh"
$refreshButton.Location = New-Object System.Drawing.Point(340, 130)
$refreshButton.Size = New-Object System.Drawing.Size(110, 42)
$refreshButton.Add_Click({ Refresh-Status })

$openLocalButton = New-Object System.Windows.Forms.Button
$openLocalButton.Text = "Open Local"
$openLocalButton.Location = New-Object System.Drawing.Point(20, 188)
$openLocalButton.Size = New-Object System.Drawing.Size(110, 38)
$openLocalButton.Add_Click({ Start-Process $localUrl })

$openPublicButton = New-Object System.Windows.Forms.Button
$openPublicButton.Text = "Open Public"
$openPublicButton.Location = New-Object System.Drawing.Point(145, 188)
$openPublicButton.Size = New-Object System.Drawing.Size(110, 38)
$openPublicButton.Add_Click({
  if ($urlBox.Text) { Start-Process $urlBox.Text }
})

$copyButton = New-Object System.Windows.Forms.Button
$copyButton.Text = "Copy Public URL"
$copyButton.Location = New-Object System.Drawing.Point(270, 188)
$copyButton.Size = New-Object System.Drawing.Size(140, 38)
$copyButton.Add_Click({
  if ($urlBox.Text) { [System.Windows.Forms.Clipboard]::SetText($urlBox.Text) }
})

$inviteLabel = New-Object System.Windows.Forms.Label
$inviteLabel.Text = "Invite code: reeshiram-YuBirdSing-202605"
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

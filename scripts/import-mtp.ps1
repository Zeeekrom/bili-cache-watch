param(
  [Parameter(Mandatory = $true)]
  [string]$SourcePath,

  [Parameter(Mandatory = $true)]
  [string]$DestinationRoot,

  [string]$ExistingBvidsJson = "[]"
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$copyFlags = 4 + 16 + 1024
$existing = @{}

foreach ($bvid in (ConvertFrom-Json -InputObject $ExistingBvidsJson)) {
  $existing[[string]$bvid] = $true
}

function ConvertTo-JsonResult($obj) {
  $obj | ConvertTo-Json -Depth 8 -Compress
}

function Get-ChildFolder {
  param([object]$Folder, [string]$Name)

  foreach ($item in @($Folder.Items())) {
    if ($item.Name -eq $Name) {
      return $item.GetFolder()
    }
  }

  throw "Path segment not found: $Name"
}

function Resolve-FromRoot {
  param([object]$RootFolder, [string[]]$Segments, [int]$StartIndex)

  $folder = $RootFolder
  for ($i = $StartIndex; $i -lt $Segments.Count; $i++) {
    $folder = Get-ChildFolder -Folder $folder -Name $Segments[$i]
  }

  return $folder
}

function Resolve-ShellFolder {
  param([string]$Path)

  $segments = @($Path -split "[\\/]+" | Where-Object { $_ -and $_.Trim() })
  if ($segments.Count -eq 0) {
    throw "Phone cache path is empty"
  }

  $shell = New-Object -ComObject Shell.Application
  $desktop = $shell.Namespace(0)
  $thisPc = $shell.Namespace(17)
  $errors = @()

  try {
    return Resolve-FromRoot -RootFolder $desktop -Segments $segments -StartIndex 0
  } catch {
    $errors += $_.Exception.Message
  }

  try {
    return Resolve-FromRoot -RootFolder $thisPc -Segments $segments -StartIndex 0
  } catch {
    $errors += $_.Exception.Message
  }

  if ($segments.Count -gt 1) {
    try {
      return Resolve-FromRoot -RootFolder $thisPc -Segments $segments -StartIndex 1
    } catch {
      $errors += $_.Exception.Message
    }
  }

  throw ("Could not resolve MTP path. Checked: " + ($errors -join " | "))
}

function Copy-ShellItem {
  param(
    [object]$Item,
    [string]$Destination,
    [string]$ExpectedPath
  )

  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  $destFolder = (New-Object -ComObject Shell.Application).Namespace($Destination)
  $destFolder.CopyHere($Item, $copyFlags)

  $deadline = (Get-Date).AddMinutes(5)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $ExpectedPath) {
      return
    }
    Start-Sleep -Milliseconds 300
  }

  throw "Copy timed out: $($Item.Name)"
}

function Read-EntryFromMtp {
  param([object]$EntryItem)

  $tempDir = Join-Path $env:TEMP ("bili-entry-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
  $target = Join-Path $tempDir "entry.json"

  try {
    Copy-ShellItem -Item $EntryItem -Destination $tempDir -ExpectedPath $target
    return Get-Content -LiteralPath $target -Raw -Encoding UTF8
  } finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Convert-AvToBv {
  param([object]$Avid)

  if ($null -eq $Avid) { return $null }
  $number = [double]$Avid
  if ($number -le 0) { return $null }

  $table = "fZodR9XQDSUm21yCkr6zBqiveYah8bt4xsWpHnJE7jL5VG3guMTKNPAwcF"
  $positions = @(11, 10, 3, 8, 4, 6)
  $xor = 177451812
  $add = 8728348608
  $value = ([int64]$number -bxor $xor) + $add
  $chars = "BV1  4 1 7  ".ToCharArray()

  for ($i = 0; $i -lt $positions.Count; $i++) {
    $index = [math]::Floor($value / [math]::Pow(58, $i)) % 58
    $chars[$positions[$i]] = $table[[int]$index]
  }

  return -join $chars
}

try {
  New-Item -ItemType Directory -Force -Path $DestinationRoot | Out-Null
  $sessionRoot = Join-Path $DestinationRoot (Get-Date -Format "yyyyMMdd-HHmmss")
  New-Item -ItemType Directory -Force -Path $sessionRoot | Out-Null

  $downloadFolder = Resolve-ShellFolder -Path $SourcePath
  $scanned = 0
  $copied = 0
  $skippedExisting = 0
  $errors = @()

  foreach ($aidItem in @($downloadFolder.Items())) {
    if (-not $aidItem.IsFolder) { continue }

    $aidFolder = $aidItem.GetFolder()
    foreach ($cidItem in @($aidFolder.Items())) {
      if (-not $cidItem.IsFolder) { continue }

      $cidFolder = $cidItem.GetFolder()
      $entryItem = $cidFolder.ParseName("entry.json")
      if ($null -eq $entryItem) { continue }

      $scanned += 1
      try {
        $entry = ConvertFrom-Json -InputObject (Read-EntryFromMtp -EntryItem $entryItem)
        $bvid = if ($entry.bvid) { [string]$entry.bvid } else { Convert-AvToBv -Avid $entry.avid }
        if (-not $bvid) {
          $errors += @{ path = "$($aidItem.Name)\$($cidItem.Name)\entry.json"; error = "entry.json has no bvid or avid" }
          continue
        }

        if ($existing.ContainsKey($bvid)) {
          $skippedExisting += 1
          continue
        }

        $destAid = Join-Path $sessionRoot $aidItem.Name
        $expected = Join-Path (Join-Path $destAid $cidItem.Name) "entry.json"
        Copy-ShellItem -Item $cidItem -Destination $destAid -ExpectedPath $expected
        $copied += 1
      } catch {
        if ($errors.Count -lt 20) {
          $errors += @{ path = "$($aidItem.Name)\$($cidItem.Name)"; error = $_.Exception.Message }
        }
      }
    }
  }

  ConvertTo-JsonResult @{
    ok = $true
    sourcePath = $SourcePath
    destination = $sessionRoot
    scanned = $scanned
    copied = $copied
    skippedExisting = $skippedExisting
    errorCount = $errors.Count
    errors = $errors
  }
} catch {
  ConvertTo-JsonResult @{
    ok = $false
    sourcePath = $SourcePath
    error = $_.Exception.Message
  }
  exit 1
}

# Copies GoldTracker.lua and Auctionator.lua from the WoW folder to the
# dashboard folder (Documents\ForeverGoldTracker) when WoW saves them.
# Read-only on the game folder. Installed and started by setup.ps1.
param([switch]$Once)

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfg = Get-Content (Join-Path $appDir 'config.json') -Raw | ConvertFrom-Json
$files = @('GoldTracker.lua', 'Auctionator.lua')

if (-not $Once) {
  # One copier at a time.
  $isNew = $false
  $script:mutex = New-Object System.Threading.Mutex($true, 'Local\ForeverGoldTrackerCopier', [ref]$isNew)
  if (-not $isNew) { exit }
}

function Copy-Changed {
  $accounts = Join-Path $cfg.wowRoot (Join-Path $cfg.flavor 'WTF\Account')
  if (-not (Test-Path $accounts)) { return }
  foreach ($acct in Get-ChildItem $accounts -Directory -ErrorAction SilentlyContinue) {
    foreach ($f in $files) {
      $src = Join-Path $acct.FullName "SavedVariables\$f"
      if (-not (Test-Path $src)) { continue }
      $destDir = Join-Path $cfg.dest "$($cfg.flavor)\$($acct.Name)\SavedVariables"
      $dst = Join-Path $destDir $f
      $srcTime = (Get-Item $src).LastWriteTimeUtc
      if ((Test-Path $dst) -and (Get-Item $dst).LastWriteTimeUtc -ge $srcTime) { continue }
      try {
        New-Item -ItemType Directory -Force $destDir | Out-Null
        # Copy to a temp name first, so the dashboard never reads a half-written file.
        Copy-Item $src "$dst.tmp" -Force
        Move-Item "$dst.tmp" $dst -Force
        (Get-Item $dst).LastWriteTimeUtc = $srcTime
      } catch {
        # WoW may still be writing; the next round retries.
      }
    }
  }
}

Copy-Changed
if ($Once) { exit }
while ($true) {
  Start-Sleep -Seconds 5
  Copy-Changed
}

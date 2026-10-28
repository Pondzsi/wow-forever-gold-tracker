# Copies GoldTracker.lua and Auctionator.lua from every WoW game version
# (_forever_, _retail_, ...) to the dashboard folder
# (Documents\ForeverGoldTracker\<version>\...) when WoW saves them.
# The dashboard picks the version to show. Read-only on the game folder.
# Installed and started by setup.ps1.
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
  foreach ($flavor in Get-ChildItem $cfg.wowRoot -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^_.*_$' }) {
    $accounts = Join-Path $flavor.FullName 'WTF\Account'
    if (-not (Test-Path $accounts)) { continue }
    foreach ($acct in Get-ChildItem $accounts -Directory -ErrorAction SilentlyContinue) {
      foreach ($f in $files) {
        $src = Join-Path $acct.FullName "SavedVariables\$f"
        if (-not (Test-Path $src)) { continue }
        $destDir = Join-Path $cfg.dest "$($flavor.Name)\$($acct.Name)\SavedVariables"
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
}

Copy-Changed
if ($Once) { exit }
while ($true) {
  Start-Sleep -Seconds 5
  Copy-Changed
}

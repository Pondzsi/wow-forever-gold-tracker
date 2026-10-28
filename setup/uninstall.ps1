# Removes the background copier, its startup entry and the Gold Tracker addon.
# Keeps your dashboard data (it lives in the browser) and Documents\ForeverGoldTracker.
$appDir = "$env:LOCALAPPDATA\ForeverGoldTracker"
$cfgPath = Join-Path $appDir 'config.json'

Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*ForeverGoldTracker*copier.ps1*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host 'Background copier stopped.'

$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Forever Gold Tracker copier.lnk'
if (Test-Path $lnk) { Remove-Item $lnk -Force; Write-Host 'Startup entry removed.' }

if (Test-Path $cfgPath) {
  $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
  foreach ($f in Get-ChildItem $cfg.wowRoot -Directory -ErrorAction SilentlyContinue) {
    $addon = Join-Path $f.FullName 'Interface\AddOns\GoldTracker'
    if (Test-Path $addon) {
      try { Remove-Item $addon -Recurse -Force; Write-Host "Addon removed: $addon" }
      catch { Write-Host "Could not remove $addon (try Run as administrator)." }
    }
  }
}
if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force }
Write-Host 'Done. Documents\ForeverGoldTracker and your dashboard data were kept.'

# Forever Gold Tracker setup. Run through setup.bat.
#  1. Finds World of Warcraft.
#  2. Installs the Gold Tracker addon into the game.
#  3. Installs a small background copier that copies GoldTracker.lua and
#     Auctionator.lua to Documents\ForeverGoldTracker whenever WoW saves them.
#     (Browsers may not open folders inside Program Files, so the dashboard
#     reads this copy instead.)
#  4. Opens the dashboard.
# Run it again any time to update the addon or switch game version.
param(
  [string]$Flavor = '',     # game version folder to track, e.g. _forever_ or _retail_
  [string]$WowRoot = '',    # World of Warcraft folder, if it cannot be found
  [switch]$NoStartup,       # testing: don't add the copier to Windows startup or open the browser
  [string]$AppDir = "$env:LOCALAPPDATA\ForeverGoldTracker",
  [string]$Dest = ''
)
$ErrorActionPreference = 'Stop'
$DashboardUrl = 'https://pondzsi.github.io/wow-forever-gold-tracker/'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Dest) { $Dest = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'ForeverGoldTracker' }

function Say($msg) { Write-Host $msg }
function Fail($msg) { Write-Host ''; Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

function Find-WowRoot {
  $keys = @(
    'HKLM:\SOFTWARE\WOW6432Node\Blizzard Entertainment\World of Warcraft',
    'HKLM:\SOFTWARE\Blizzard Entertainment\World of Warcraft'
  )
  foreach ($k in $keys) {
    try {
      $p = (Get-ItemProperty $k -ErrorAction Stop).InstallPath
      if ($p) {
        $p = $p.TrimEnd('\')
        if ((Split-Path $p -Leaf) -match '^_.*_$') { $p = Split-Path $p -Parent }
        if (Test-Path $p) { return $p }
      }
    } catch {}
  }
  $guesses = @(
    "${env:ProgramFiles(x86)}\World of Warcraft", "$env:ProgramFiles\World of Warcraft",
    'C:\World of Warcraft', 'D:\World of Warcraft', 'C:\Games\World of Warcraft', 'D:\Games\World of Warcraft'
  )
  foreach ($p in $guesses) { if (Test-Path $p) { return $p } }
  return $null
}

Say '=== Forever Gold Tracker setup ==='

# --- 1. Find the game --------------------------------------------------------
if (-not $WowRoot) { $WowRoot = Find-WowRoot }
if (-not $WowRoot) {
  $WowRoot = Read-Host 'World of Warcraft folder not found. Paste its path (e.g. C:\Games\World of Warcraft)'
}
if (-not $WowRoot -or -not (Test-Path $WowRoot)) { Fail "Folder not found: $WowRoot" }
Say "WoW folder: $WowRoot"

$flavors = @(Get-ChildItem $WowRoot -Directory | Where-Object {
  $_.Name -match '^_.*_$' -and ((Test-Path (Join-Path $_.FullName 'Interface')) -or (Test-Path (Join-Path $_.FullName 'WTF')) -or (Get-ChildItem $_.FullName -Filter 'Wow*.exe' -ErrorAction SilentlyContinue))
} | Select-Object -ExpandProperty Name)
if ($flavors.Count -eq 0) { Fail "No game versions (like _forever_ or _retail_) found in $WowRoot" }

# --- 2. Which game version to track -----------------------------------------
if (-not $Flavor) {
  $default = if ($flavors -contains '_forever_') { '_forever_' } else { $flavors[0] }
  Say ''
  Say 'Game versions found:'
  for ($i = 0; $i -lt $flavors.Count; $i++) {
    $mark = if ($flavors[$i] -eq $default) { ' (default)' } else { '' }
    Say ("  [{0}] {1}{2}" -f ($i + 1), $flavors[$i], $mark)
  }
  $answer = Read-Host "Which one should the dashboard track? Press Enter for $default"
  if ($answer -match '^\d+$' -and [int]$answer -ge 1 -and [int]$answer -le $flavors.Count) { $Flavor = $flavors[[int]$answer - 1] }
  else { $Flavor = $default }
}
if ($flavors -notcontains $Flavor) { Fail "$Flavor is not in $WowRoot" }
Say "Tracking: $Flavor"

# --- 3. Install the addon ----------------------------------------------------
$addonSrc = Join-Path $here 'GoldTracker'
if (-not (Test-Path $addonSrc)) { $addonSrc = Join-Path $here '..\addon\GoldTracker' }
if (-not (Test-Path (Join-Path $addonSrc 'GoldTracker.toc'))) { Fail 'GoldTracker addon files are missing next to setup.bat.' }

$targets = @($Flavor) + @($flavors | Where-Object { $_ -in @('_forever_', '_retail_') }) | Select-Object -Unique
foreach ($f in $targets) {
  $addons = Join-Path $WowRoot "$f\Interface\AddOns"
  try {
    New-Item -ItemType Directory -Force $addons | Out-Null
    $dst = Join-Path $addons 'GoldTracker'
    if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
    Copy-Item $addonSrc $dst -Recurse -Force
    Say "Addon installed: $dst"
  } catch [System.UnauthorizedAccessException] {
    Fail "No permission to write to $addons. Right-click setup.bat and choose 'Run as administrator'."
  } catch {
    Fail "Could not install the addon into $addons : $($_.Exception.Message)"
  }
}
if (-not (Test-Path (Join-Path $WowRoot "$Flavor\Interface\AddOns\Auctionator"))) {
  Say ''
  Say "NOTE: Auctionator is not installed in $Flavor. Install it (CurseForge or Wago) for AH prices."
}

# --- 4. Install the background copier ---------------------------------------
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*ForeverGoldTracker*copier.ps1*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

New-Item -ItemType Directory -Force $AppDir | Out-Null
Copy-Item (Join-Path $here 'copier.ps1') (Join-Path $AppDir 'copier.ps1') -Force
Copy-Item (Join-Path $here 'uninstall.ps1') (Join-Path $AppDir 'uninstall.ps1') -Force
Get-ChildItem $AppDir -Filter *.ps1 | Unblock-File
@{ wowRoot = $WowRoot; flavor = $Flavor; dest = $Dest } | ConvertTo-Json | Set-Content (Join-Path $AppDir 'config.json') -Encoding UTF8

# Only one game version in the copy, so data from different versions never mixes.
New-Item -ItemType Directory -Force $Dest | Out-Null
Get-ChildItem $Dest -Directory | Where-Object { $_.Name -ne $Flavor } | Remove-Item -Recurse -Force
Set-Content (Join-Path $Dest 'README.txt') "Copies of WoW SavedVariables for the Forever Gold Tracker dashboard ($Flavor). Made by the background copier. Safe to delete." -Encoding UTF8

$copier = Join-Path $AppDir 'copier.ps1'
& powershell -NoProfile -ExecutionPolicy Bypass -File $copier -Once
Say "Copy folder: $Dest"

if (-not $NoStartup) {
  $startup = [Environment]::GetFolderPath('Startup')
  $lnk = Join-Path $startup 'Forever Gold Tracker copier.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $s.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$copier`""
  $s.WindowStyle = 7
  $s.Description = 'Copies WoW SavedVariables for the Forever Gold Tracker dashboard'
  $s.Save()
  Start-Process "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -WindowStyle Hidden -ArgumentList @('-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', $copier)
  Say 'Background copier started (and starts with Windows).'

  Say ''
  Say '=== Done ==='
  Say 'In the dashboard that opens now:'
  Say '  Sync & to-do -> Choose WoW folder -> pick this folder:'
  Say "  $Dest"
  Say 'Use Chrome or Edge, and allow access on every visit when asked.'
  Start-Process $DashboardUrl
}

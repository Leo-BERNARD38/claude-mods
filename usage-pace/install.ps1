# Installe le mod usage-pace pour toutes tes sessions Claude Code (Windows).
# Usage : clic droit > "Exécuter avec PowerShell", ou : powershell -ExecutionPolicy Bypass -File install.ps1
$ErrorActionPreference = 'Stop'
$mod = (Resolve-Path $PSScriptRoot).Path -replace '\\', '/'
$dir = Join-Path $HOME '.claude'
$file = Join-Path $dir 'settings.json'
New-Item -ItemType Directory -Force $dir | Out-Null

if (Test-Path $file) {
  Copy-Item $file "$file.bak" -Force
  $settings = Get-Content $file -Raw | ConvertFrom-Json
} else {
  $settings = [pscustomobject]@{}
}
if (-not $settings.env) { $settings | Add-Member -Force env ([pscustomobject]@{}) }

# ajoute le dossier du mod à la liste (séparateur ; sous Windows), sans doublon
$dirs = @(($settings.env.CLAUDE_CODE_PLUGIN_DIRS -split ';') | Where-Object { $_ -and $_ -ne $mod })
$settings.env | Add-Member -Force CLAUDE_CODE_PLUGIN_DIRS (($dirs + $mod) -join ';')

[IO.File]::WriteAllText($file, ($settings | ConvertTo-Json -Depth 20))
Write-Host "usage-pace installé depuis $mod"
Write-Host "Ouvre une nouvelle session Claude Code : le bandeau apparaît après la première réponse."

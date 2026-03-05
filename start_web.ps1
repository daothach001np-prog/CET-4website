$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSCommandPath
Set-Location $projectRoot

$pythonExe = $null
if (Test-Path "D:\anaconda\python.exe") {
  $pythonExe = "D:\anaconda\python.exe"
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  $pythonExe = (Get-Command python).Source
}

if (-not $pythonExe) {
  Write-Host "No Python executable found. Please install Python or Anaconda." -ForegroundColor Red
  exit 1
}

Write-Host "Using Python: $pythonExe" -ForegroundColor Cyan
Write-Host "Serving: http://127.0.0.1:5173" -ForegroundColor Green
Write-Host "Press Ctrl + C to stop the server." -ForegroundColor Yellow

& $pythonExe -m http.server 5173 -d web

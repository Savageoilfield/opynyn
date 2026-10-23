$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath '.env')) {
  $bytes = [byte[]]::new(32)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  $key = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
  @("ADMIN_KEY=$key", 'TZ=America/Edmonton', 'PORT=3000', 'PUBLIC_URL=') | Set-Content -LiteralPath '.env' -Encoding ascii
  Write-Host 'Created .env with a private admin key.'
}
if (Get-Command docker -ErrorAction SilentlyContinue) {
  docker compose up -d --build
  if ($LASTEXITCODE -ne 0) { throw 'Docker did not start the site. Make sure Docker Desktop is running.' }
  Write-Host 'Docker container started.'
} else {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 or Docker Desktop to run Opynyn.' }
  $settings = @{}
  Get-Content -LiteralPath '.env' | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') { $settings[$matches[1]] = $matches[2] }
  }
  $env:ADMIN_KEY = $settings['ADMIN_KEY']
  $env:TZ = $settings['TZ']
  $env:PORT = $settings['PORT']
  $env:HOST = '127.0.0.1'
  $env:DATA_DIR = Join-Path $PSScriptRoot 'data'
  Write-Host 'Docker is unavailable; running with Node in this PowerShell window. Press Ctrl+C to stop.'
  Write-Host 'Open http://localhost:3000 (admin: http://localhost:3000/admin). The private admin key is in .env.'
  node server.mjs
  exit $LASTEXITCODE
}
Write-Host 'Open http://localhost:3000'
Write-Host 'Admin page: http://localhost:3000/admin'
Write-Host 'Your admin key is in .env. Keep it private.'

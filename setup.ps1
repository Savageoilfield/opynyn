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
docker compose up -d --build
Write-Host 'Open http://localhost:3000'
Write-Host 'Admin page: http://localhost:3000/admin'
Write-Host 'Your admin key is in .env. Keep it private.'

param(
  [string]$ProjectPath = (Split-Path -Parent $PSScriptRoot),
  [ValidateRange(1024, 65535)][int]$Port = 3000,
  [switch]$InstallDependencies,
  [switch]$WithServerTools,
  [switch]$Start,
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$ProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path
if (-not (Test-Path -LiteralPath (Join-Path $ProjectPath 'package.json'))) {
  throw 'Run this script in a cloned LMS project.'
}
$node = Get-Command node -ErrorAction Stop
$git = Get-Command git -ErrorAction Stop
$npm = Get-Command npm.cmd -ErrorAction Stop
$versionText = (& $node.Source -p 'process.versions.node').Trim()
if ($LASTEXITCODE -ne 0) { throw 'Node.js could not be started.' }
$version = [version]$versionText
if ($version.Major -lt 22 -or ($version.Major -eq 22 -and $version.Minor -lt 12)) {
  throw 'Use Node.js 22.12 or newer. Production currently uses Node.js 22.'
}
Write-Output "Node.js: $versionText"
Write-Output "Git: $($git.Source)"
Write-Output "Project: $ProjectPath"
$envPath = Join-Path $ProjectPath '.env.local'
if ($CheckOnly) {
  Write-Output "Local configuration exists: $(Test-Path -LiteralPath $envPath)"
  Write-Output 'Check only: no files changed and no services started.'
  return
}

$settings = [ordered]@{
  NODE_ENV = 'development'
  LMS_STORAGE = 'json'
  LMS_ALLOW_DEMO_DATA = 'true'
  LMS_DB_PATH = 'data/local-development/db.json'
  LMS_UPLOADS_DIR = 'data/local-development/uploads'
  HOST = '127.0.0.1'
  PORT = "$Port"
  APP_URL = "http://127.0.0.1:$Port"
  PUBLIC_BASE_URL = "http://127.0.0.1:$Port"
  DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5433/marine_lms?schema=public'
  TRUST_PROXY = 'false'
  SMTP_HOST = ''
  SMTP_USER = ''
  SMTP_PASS = ''
  SMTP_FROM = ''
  SMTP_TLS_REJECT_UNAUTHORIZED = 'true'
  LMS_CLI_MODE = 'false'
  LMS_ASSESSMENT_MAINTENANCE = 'false'
  LMS_MAINTENANCE_CONFIRMED = 'false'
}
if (Test-Path -LiteralPath $envPath) {
  $existing = @{}
  foreach ($line in [IO.File]::ReadAllLines($envPath)) {
    if ($line -match '^([A-Z_]+)="([^"]*)"$') { $existing[$matches[1]] = $matches[2] }
  }
  foreach ($key in $settings.Keys) {
    if (-not $existing.ContainsKey($key) -or $existing[$key] -cne $settings[$key]) {
      throw 'Existing .env.local does not match the isolated demo configuration. It was not overwritten. Review it before starting.'
    }
  }
} else {
  $lines = @('# Isolated local demo. No production database or email delivery.')
  foreach ($key in $settings.Keys) { $lines += ('{0}="{1}"' -f $key, $settings[$key]) }
  [IO.File]::WriteAllText($envPath, ($lines -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
  Write-Output 'Created .env.local for isolated local demo data. SMTP is disabled.'
}

Push-Location -LiteralPath $ProjectPath
try {
  if ($InstallDependencies) {
    & $npm.Source ci --include=dev
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    & $npm.Source run prisma:generate
    if ($LASTEXITCODE -ne 0) { throw 'Prisma client generation failed.' }
  }
  if ($WithServerTools) {
    & $npm.Source install --prefix .deploy-tools --ignore-scripts --no-audit --no-fund ssh2@1.17.0
    if ($LASTEXITCODE -ne 0) { throw 'Server tooling installation failed.' }
    Write-Output 'Server tooling installed. No server connection was made.'
  }
  if ($Start) {
    $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
    try { $probe.Start() } catch { throw "Port $Port is in use. Choose another -Port value." } finally { $probe.Stop() }
    $previous = @{}
    foreach ($key in $settings.Keys) {
      $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
      [Environment]::SetEnvironmentVariable($key, $settings[$key], 'Process')
    }
    try {
      Write-Output "Starting isolated LMS demo: http://127.0.0.1:$Port"
      & $npm.Source run dev
      if ($LASTEXITCODE -ne 0) { throw 'The local development server stopped with an error.' }
    } finally {
      foreach ($key in $settings.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
    }
  } else {
    Write-Output 'Ready. Run this script again with -Start to open the isolated demo.'
  }
} finally { Pop-Location }

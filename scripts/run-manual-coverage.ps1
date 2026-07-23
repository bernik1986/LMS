param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$projectRoot = Split-Path -Parent $PSScriptRoot
$coverageRoot = Join-Path $projectRoot ".coverage"
$rawCoveragePath = Join-Path $coverageRoot "v8"
$previousCoveragePath = $env:NODE_V8_COVERAGE
$previousCachePath = $env:XDG_CACHE_HOME

Set-Location $projectRoot

if (-not $SkipBuild) {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) {
    throw "Build failed before coverage collection."
  }
}

if (Test-Path -LiteralPath $coverageRoot) {
  Remove-Item -LiteralPath $coverageRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $rawCoveragePath -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $coverageRoot "cache") -Force | Out-Null

try {
  $env:NODE_V8_COVERAGE = $rawCoveragePath
  $env:XDG_CACHE_HOME = Join-Path $coverageRoot "cache"

  foreach ($script in @(
    "test:regression",
    "test:unit",
    "test:integration",
    "test:postgres",
    "test:imports"
  )) {
    Write-Host ""
    Write-Host "=== npm run $script ===" -ForegroundColor Cyan
    & npm.cmd run $script
    if ($LASTEXITCODE -ne 0) {
      throw "Coverage collection stopped because npm run $script failed."
    }
  }
}
finally {
  if ($null -eq $previousCoveragePath) {
    Remove-Item Env:NODE_V8_COVERAGE -ErrorAction SilentlyContinue
  }
  else {
    $env:NODE_V8_COVERAGE = $previousCoveragePath
  }
  if ($null -eq $previousCachePath) {
    Remove-Item Env:XDG_CACHE_HOME -ErrorAction SilentlyContinue
  }
  else {
    $env:XDG_CACHE_HOME = $previousCachePath
  }
}

Write-Host ""
Write-Host "=== Combined V8 coverage ===" -ForegroundColor Cyan
& node (Join-Path $PSScriptRoot "summarize-v8-coverage.mjs") $rawCoveragePath
if ($LASTEXITCODE -ne 0) {
  throw "Combined coverage report generation failed."
}

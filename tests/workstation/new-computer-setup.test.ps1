$ErrorActionPreference = 'Stop'
$script = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'scripts/setup-new-computer.ps1'
$directory = Join-Path ([IO.Path]::GetTempPath()) ('lms-workstation-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($directory) | Out-Null
$envPath = Join-Path $directory '.env.local'
function Assert-True($Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}
function Assert-Rejected([scriptblock]$Action, [string]$Message) {
  $rejected = $false
  try { & $Action | Out-Null } catch { $rejected = $true }
  Assert-True $rejected $Message
}
try {
  [IO.File]::WriteAllText((Join-Path $directory 'package.json'), '{"name":"workstation-fixture","private":true}')
  & $script -ProjectPath $directory -CheckOnly | Out-Null
  Assert-True (-not (Test-Path -LiteralPath $envPath)) 'CheckOnly wrote configuration.'
  & $script -ProjectPath $directory -Port 3187 | Out-Null
  $contents = [IO.File]::ReadAllText($envPath)
  foreach ($setting in @('LMS_STORAGE="json"', 'LMS_DB_PATH="data/local-development/db.json"', 'SMTP_HOST=""', 'SMTP_FROM=""', 'PUBLIC_BASE_URL="http://127.0.0.1:3187"')) {
    Assert-True ($contents.Contains($setting)) "Missing safe configuration: $setting"
  }
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $directory 'data'))) 'Setup created runtime data.'
  & $script -ProjectPath $directory -Port 3187 | Out-Null
  Assert-True ([IO.File]::ReadAllText($envPath) -ceq $contents) 'Rerun changed configuration.'
  $unsafe = $contents.Replace('SMTP_HOST=""', 'SMTP_HOST="mail.example.test"')
  [IO.File]::WriteAllText($envPath, $unsafe)
  Assert-Rejected { & $script -ProjectPath $directory -Port 3187 } 'Unsafe configuration was accepted.'
  Assert-True ([IO.File]::ReadAllText($envPath) -ceq $unsafe) 'Existing configuration was overwritten.'
  Assert-Rejected { & $script -ProjectPath $directory -Port 80 } 'Invalid port was accepted.'
  Write-Output 'PASS: check-only, isolated data, disabled SMTP, port setting, idempotence, overwrite refusal, port validation.'
} finally {
  $resolved = [IO.Path]::GetFullPath($directory)
  $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if (-not $resolved.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or -not ([IO.Path]::GetFileName($resolved).StartsWith('lms-workstation-'))) {
    throw 'Refusing to clean an unexpected path.'
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

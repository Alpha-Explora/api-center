param(
  [string]$SecretName = "api-center-prod",
  [Parameter(Mandatory = $true)]
  [string]$RollbackVersion,
  [string]$ProjectId = "",
  [string]$ApiNamespace = "api-center",
  [switch]$SkipApiRestart
)

$ErrorActionPreference = "Stop"

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

Assert-Command gcloud
Assert-Command kubectl

$projectArgs = @()
if ($ProjectId) {
  $projectArgs += "--project=$ProjectId"
}

Write-Host "Reading rollback payload from Secret Manager version $RollbackVersion"
$rollbackPayload = (& gcloud @("secrets", "versions", "access", $RollbackVersion, "--secret=$SecretName") @projectArgs) | Out-String
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($rollbackPayload)) {
  throw "Failed to access rollback version $RollbackVersion for secret $SecretName"
}

$tempFile = [System.IO.Path]::GetTempFileName()
try {
  Set-Content -Path $tempFile -Value $rollbackPayload -Encoding UTF8

  Write-Host "Creating new latest secret version from rollback payload"
  & gcloud @("secrets", "versions", "add", $SecretName, "--data-file=$tempFile") @projectArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create rollback secret version for $SecretName"
  }
}
finally {
  if (Test-Path $tempFile) {
    Remove-Item -Path $tempFile -Force
  }
}

if (-not $SkipApiRestart) {
  Write-Host "Restarting API deployment to consume restored secret version"
  & kubectl -n $ApiNamespace rollout restart deploy/api-center
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to restart api-center deployment in namespace $ApiNamespace"
  }

  & kubectl -n $ApiNamespace rollout status deploy/api-center --timeout=10m
  if ($LASTEXITCODE -ne 0) {
    throw "api-center deployment did not recover after rollback restart"
  }
}

Write-Host "Secret rollback completed successfully."

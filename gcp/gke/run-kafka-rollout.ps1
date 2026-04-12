param(
  [string]$SecretName = "api-center-prod",
  [string]$ProjectId = "",
  [switch]$WithObservability,
  [switch]$WithDr,
  [string]$KafkaTimeout = "20m",
  [string]$ApiTimeout = "10m",
  [string]$Hostname = "",
  [switch]$CheckKafkaTopicSmoke,
  [switch]$SkipSecretSync,
  [switch]$SkipDeploy,
  [switch]$SkipApiRestart,
  [switch]$SkipVerify,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

Assert-Command kubectl
Assert-Command gcloud
Assert-Command powershell

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..\..")
Set-Location $repoRoot

if ($DryRun) {
  Write-Host "DryRun mode enabled: no cluster or Secret Manager mutations will be applied."
  $SkipDeploy = $true
  $SkipApiRestart = $true
  $SkipVerify = $true
}

if (-not $SkipSecretSync) {
  Write-Host "[1/4] Syncing Kafka values into Secret Manager"
  $syncArgs = @(
    "-ExecutionPolicy", "Bypass",
    "-File", ".\gcp\gke\sync-kafka-secretmanager.ps1",
    "-SecretName", $SecretName
  )
  if ($ProjectId) {
    $syncArgs += @("-ProjectId", $ProjectId)
  }

  if ($DryRun) {
    $syncArgs += "-DryRun"
  }

  & powershell @syncArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Secret sync step failed"
  }
} else {
  Write-Host "[1/4] Secret sync skipped"
}

if (-not $SkipDeploy) {
  Write-Host "[2/4] Deploying Kafka stack"
  $deployArgs = @(
    "-ExecutionPolicy", "Bypass",
    "-File", ".\gcp\gke\deploy-kafka-stack.ps1",
    "-KafkaTimeout", $KafkaTimeout,
    "-ApiTimeout", $ApiTimeout
  )

  if ($WithObservability) {
    $deployArgs += "-WithObservability"
  }

  if ($WithDr) {
    $deployArgs += "-WithDr"
  }

  & powershell @deployArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Deploy step failed"
  }
} else {
  Write-Host "[2/4] Deployment skipped"
}

if (-not $SkipApiRestart -and -not $SkipSecretSync) {
  Write-Host "[3/4] Restarting API deployment to consume latest Secret Manager version"
  & kubectl -n api-center rollout restart deploy/api-center
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to restart api-center deployment"
  }

  & kubectl -n api-center rollout status deploy/api-center --timeout=$ApiTimeout
  if ($LASTEXITCODE -ne 0) {
    throw "api-center rollout did not complete successfully after restart"
  }
} else {
  Write-Host "[3/4] API restart skipped"
}

if (-not $SkipVerify) {
  Write-Host "[4/4] Verifying deployment health"
  $verifyArgs = @(
    "-ExecutionPolicy", "Bypass",
    "-File", ".\gcp\gke\verify-kafka-stack.ps1"
  )

  if ($WithObservability) {
    $verifyArgs += "-CheckObservability"
  }

  if ($WithDr) {
    $verifyArgs += "-CheckDr"
  }

  if ($CheckKafkaTopicSmoke) {
    $verifyArgs += "-CheckKafkaTopicSmoke"
  }

  if ($Hostname) {
    $verifyArgs += @("-Hostname", $Hostname)
  }

  & powershell @verifyArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Verification step failed"
  }
} else {
  Write-Host "[4/4] Verification skipped"
}

Write-Host "Kafka rollout workflow completed successfully."

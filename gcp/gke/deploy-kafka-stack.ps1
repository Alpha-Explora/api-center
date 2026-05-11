param(
  [switch]$WithObservability,
  [switch]$WithDr,
  [switch]$AllowSelfHostedKafka,
  [string]$KafkaTimeout = "20m",
  [string]$ApiTimeout = "10m"
)

$ErrorActionPreference = "Stop"

if (-not $AllowSelfHostedKafka) {
  Write-Host "Self-hosted Kafka rollout is disabled. Use Confluent Cloud for production Kafka."
  Write-Host "Re-run with -AllowSelfHostedKafka only for approved fallback use."
  exit 1
}

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Invoke-External {
  param(
    [string]$FilePath,
    [string[]]$Arguments = @()
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $FilePath $($Arguments -join ' ')"
  }
}

Assert-Command kubectl
Assert-Command helm

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..\..")
Set-Location $repoRoot

$null = kubectl config current-context 2>$null
if ($LASTEXITCODE -ne 0) {
  throw "kubectl context is not configured. Run gcloud container clusters get-credentials first."
}

Write-Host "[1/6] Installing or updating Strimzi operator"
Invoke-External "helm" @("repo", "add", "strimzi", "https://strimzi.io/charts/")
Invoke-External "helm" @("repo", "update")
Invoke-External "helm" @(
  "upgrade",
  "--install",
  "strimzi-kafka-operator",
  "strimzi/strimzi-kafka-operator",
  "--namespace", "strimzi-operator",
  "--create-namespace",
  "--values", "gcp/gke/kafka/20-strimzi-operator-values.yaml"
)

Write-Host "[2/6] Applying base GKE manifests"
Invoke-External "kubectl" @("apply", "-f", "gcp/gke/")

Write-Host "[3/6] Applying Kafka manifests"
Invoke-External "kubectl" @("apply", "-k", "gcp/gke/kafka")

Write-Host "[4/6] Waiting for Kafka readiness"
Invoke-External "kubectl" @("-n", "kafka", "wait", "kafka/api-center-kafka", "--for=condition=Ready", "--timeout=$KafkaTimeout")

Write-Host "[5/6] Waiting for API rollout"
Invoke-External "kubectl" @("-n", "api-center", "rollout", "status", "deploy/api-center", "--timeout=$ApiTimeout")

if ($WithObservability) {
  Write-Host "[6/6] Applying observability pack"
  Invoke-External "kubectl" @("apply", "-k", "gcp/gke/kafka/observability")
}

if ($WithDr) {
  $drManifest = "gcp/gke/kafka/dr/10-mirrormaker2.yaml"
  $placeholderFound = Select-String -Path $drManifest -Pattern "dr-kafka-bootstrap.example.internal" -Quiet
  if ($placeholderFound) {
    throw "DR manifest still uses placeholder target bootstrap server. Update $drManifest first."
  }

  foreach ($secretName in @("mirrormaker2-source-credentials", "mirrormaker2-target-credentials")) {
    & kubectl -n kafka get secret $secretName *> $null
    if ($LASTEXITCODE -ne 0) {
      throw "Required DR secret not found in kafka namespace: $secretName"
    }
  }

  Write-Host "[6/6] Applying DR pack"
  Invoke-External "kubectl" @("apply", "-k", "gcp/gke/kafka/dr")
}

Write-Host "Deployment workflow completed successfully."

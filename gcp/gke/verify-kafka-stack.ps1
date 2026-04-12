param(
  [string]$ApiNamespace = "api-center",
  [string]$KafkaNamespace = "kafka",
  [string]$ApiRolloutTimeout = "5m",
  [string]$KafkaWaitTimeout = "3m",
  [string]$Hostname = "",
  [switch]$CheckObservability,
  [switch]$CheckDr,
  [switch]$CheckKafkaTopicSmoke
)

$ErrorActionPreference = "Stop"

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Invoke-Kubectl {
  param([string[]]$Arguments)
  & kubectl @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "kubectl command failed: kubectl $($Arguments -join ' ')"
  }
}

Assert-Command kubectl

Write-Host "[1/6] Checking API deployment rollout"
Invoke-Kubectl -Arguments @("-n", $ApiNamespace, "rollout", "status", "deploy/api-center", "--timeout=$ApiRolloutTimeout")

Write-Host "[2/6] Checking Kafka cluster readiness"
Invoke-Kubectl -Arguments @("-n", $KafkaNamespace, "wait", "kafka/api-center-kafka", "--for=condition=Ready", "--timeout=$KafkaWaitTimeout")

Write-Host "[3/6] Listing Kafka resources"
Invoke-Kubectl -Arguments @("-n", $KafkaNamespace, "get", "kafkas,kafkanodepools,kafkausers,kafkatopics")

Write-Host "[4/6] Listing API resources"
Invoke-Kubectl -Arguments @("-n", $ApiNamespace, "get", "deploy,svc,hpa,pdb")

if ($CheckObservability) {
  Write-Host "[5/6] Checking observability resources"
  Invoke-Kubectl -Arguments @("-n", $KafkaNamespace, "get", "prometheusrule", "api-center-kafka-alert-rules")
  Invoke-Kubectl -Arguments @("-n", $KafkaNamespace, "get", "configmap", "api-center-kafka-dashboard")
} else {
  Write-Host "[5/6] Observability checks skipped"
}

if ($CheckDr) {
  Write-Host "[6/6] Checking DR resources"
  Invoke-Kubectl -Arguments @("-n", $KafkaNamespace, "get", "kafkamirrormaker2", "api-center-kafka-dr")
} else {
  Write-Host "[6/6] DR checks skipped"
}

if (-not [string]::IsNullOrWhiteSpace($Hostname)) {
  Write-Host "Checking public health endpoint: https://$Hostname/api/v1/health/ready"
  $response = Invoke-WebRequest -Uri "https://$Hostname/api/v1/health/ready" -Method Head -UseBasicParsing
  if ($response.StatusCode -ne 200) {
    throw "Health endpoint returned non-200 status code: $($response.StatusCode)"
  }
}

if ($CheckKafkaTopicSmoke) {
  Write-Host "Running Kafka topic produce/consume smoke probe"
  & powershell -ExecutionPolicy Bypass -File .\gcp\gke\smoke-kafka-topic.ps1 -KafkaNamespace $KafkaNamespace
  if ($LASTEXITCODE -ne 0) {
    throw "Kafka topic smoke probe failed"
  }
}

Write-Host "Kafka stack verification completed successfully."

param(
  [string]$SecretName = "api-center-prod",
  [string]$ProjectId = "",
  [string]$KafkaNamespace = "kafka",
  [string]$KafkaUserSecretName = "api-center",
  [string]$KafkaCaSecretName = "api-center-kafka-cluster-ca-cert",
  [string]$KafkaBootstrapServers = "api-center-kafka-kafka-bootstrap.kafka.svc.cluster.local:9092",
  [string]$KafkaSaslUsername = "api-center",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Invoke-GCloud {
  param([string[]]$Arguments)
  & gcloud @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "gcloud command failed: gcloud $($Arguments -join ' ')"
  }
}

function Decode-Base64 {
  param([string]$Value)
  return [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Value))
}

Assert-Command kubectl
Assert-Command gcloud

$projectArgs = @()
if ($ProjectId) {
  $projectArgs += "--project=$ProjectId"
}

Write-Host "Fetching Kafka client password from secret $KafkaNamespace/$KafkaUserSecretName"
$kafkaPasswordBase64 = & kubectl -n $KafkaNamespace get secret $KafkaUserSecretName -o "jsonpath={.data.password}"
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($kafkaPasswordBase64)) {
  throw "Unable to read Kafka password from secret: $KafkaNamespace/$KafkaUserSecretName"
}
$kafkaPassword = Decode-Base64 -Value $kafkaPasswordBase64

Write-Host "Fetching Kafka cluster CA from secret $KafkaNamespace/$KafkaCaSecretName"
$kafkaCaBase64 = & kubectl -n $KafkaNamespace get secret $KafkaCaSecretName -o "jsonpath={.data.ca\.crt}"
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($kafkaCaBase64)) {
  throw "Unable to read Kafka CA cert from secret: $KafkaNamespace/$KafkaCaSecretName"
}
$kafkaCaPem = Decode-Base64 -Value $kafkaCaBase64

Write-Host "Fetching current Secret Manager payload: $SecretName"
$accessArgs = @("secrets", "versions", "access", "latest", "--secret=$SecretName") + $projectArgs
$currentPayloadJson = (& gcloud @accessArgs) | Out-String
if ($LASTEXITCODE -ne 0) {
  throw "Failed to read current secret payload for $SecretName"
}

$payload = @{}
if (-not [string]::IsNullOrWhiteSpace($currentPayloadJson)) {
  $currentPayloadObject = $currentPayloadJson | ConvertFrom-Json
  foreach ($prop in $currentPayloadObject.PSObject.Properties) {
    $payload[$prop.Name] = $prop.Value
  }
}

$payload["KAFKA_BROKERS"] = $KafkaBootstrapServers
$payload["KAFKA_SSL_ENABLED"] = "true"
$payload["KAFKA_SSL_REJECT_UNAUTHORIZED"] = "true"
$payload["KAFKA_SSL_CA_PEM"] = $kafkaCaPem
$payload["KAFKA_SASL_MECHANISM"] = "scram-sha-512"
$payload["KAFKA_SASL_USERNAME"] = $KafkaSaslUsername
$payload["KAFKA_SASL_PASSWORD"] = $kafkaPassword

$updatedPayloadJson = $payload | ConvertTo-Json -Depth 20

if ($DryRun) {
  Write-Host "DryRun enabled. Updated payload preview:"
  Write-Output $updatedPayloadJson
  exit 0
}

$tempFile = [System.IO.Path]::GetTempFileName()
try {
  [System.IO.File]::WriteAllText($tempFile, $updatedPayloadJson, [System.Text.UTF8Encoding]::new($false))

  Write-Host "Writing updated payload as a new secret version"
  Invoke-GCloud -Arguments (@("secrets", "versions", "add", $SecretName, "--data-file=$tempFile") + $projectArgs)
}
finally {
  if (Test-Path $tempFile) {
    Remove-Item -Path $tempFile -Force
  }
}

Write-Host "Kafka Secret Manager values were updated successfully."

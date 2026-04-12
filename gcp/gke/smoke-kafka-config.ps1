param(
  [string]$SecretName = "api-center-prod",
  [string]$ProjectId = "",
  [string]$ApiNamespace = "api-center",
  [string]$KafkaNamespace = "kafka",
  [string]$KafkaUserSecretName = "api-center",
  [string]$KafkaCaSecretName = "api-center-kafka-cluster-ca-cert",
  [string]$ExpectedBroker = "api-center-kafka-kafka-bootstrap.kafka.svc.cluster.local:9092",
  [string]$Hostname = ""
)

$ErrorActionPreference = "Stop"

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Decode-Base64 {
  param([string]$Value)
  return [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Value))
}

function Assert-Condition {
  param(
    [bool]$Condition,
    [string]$ErrorMessage
  )

  if (-not $Condition) {
    throw $ErrorMessage
  }
}

Assert-Command kubectl
Assert-Command gcloud

$projectArgs = @()
if ($ProjectId) {
  $projectArgs += "--project=$ProjectId"
}

Write-Host "[1/6] Checking api-center rollout status"
& kubectl -n $ApiNamespace rollout status deploy/api-center --timeout=5m *> $null
if ($LASTEXITCODE -ne 0) {
  throw "api-center deployment is not healthy"
}

Write-Host "[2/6] Checking Kafka cluster readiness"
& kubectl -n $KafkaNamespace wait kafka/api-center-kafka --for=condition=Ready --timeout=3m *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Kafka cluster api-center-kafka is not Ready"
}

Write-Host "[3/6] Reading in-cluster Kafka credentials and CA"
$kafkaPasswordBase64 = & kubectl -n $KafkaNamespace get secret $KafkaUserSecretName -o "jsonpath={.data.password}"
Assert-Condition -Condition (-not [string]::IsNullOrWhiteSpace($kafkaPasswordBase64)) -ErrorMessage "Kafka user password secret value is empty"
$kafkaPassword = Decode-Base64 -Value $kafkaPasswordBase64

$kafkaCaBase64 = & kubectl -n $KafkaNamespace get secret $KafkaCaSecretName -o "jsonpath={.data.ca\.crt}"
Assert-Condition -Condition (-not [string]::IsNullOrWhiteSpace($kafkaCaBase64)) -ErrorMessage "Kafka CA secret value is empty"
$kafkaCaPem = Decode-Base64 -Value $kafkaCaBase64

Write-Host "[4/6] Reading latest Secret Manager payload"
$secretPayloadJson = (& gcloud @("secrets", "versions", "access", "latest", "--secret=$SecretName") @projectArgs) | Out-String
Assert-Condition -Condition (-not [string]::IsNullOrWhiteSpace($secretPayloadJson)) -ErrorMessage "Secret Manager payload is empty for $SecretName"
$secretPayload = $secretPayloadJson | ConvertFrom-Json

Assert-Condition -Condition ($secretPayload.KAFKA_BROKERS -eq $ExpectedBroker) -ErrorMessage "KAFKA_BROKERS mismatch in Secret Manager"
Assert-Condition -Condition ($secretPayload.KAFKA_SSL_ENABLED -eq "true") -ErrorMessage "KAFKA_SSL_ENABLED must be true"
Assert-Condition -Condition ($secretPayload.KAFKA_SSL_REJECT_UNAUTHORIZED -eq "true") -ErrorMessage "KAFKA_SSL_REJECT_UNAUTHORIZED must be true"
Assert-Condition -Condition ($secretPayload.KAFKA_SASL_MECHANISM -eq "scram-sha-512") -ErrorMessage "KAFKA_SASL_MECHANISM must be scram-sha-512"
Assert-Condition -Condition ($secretPayload.KAFKA_SASL_USERNAME -eq "api-center") -ErrorMessage "KAFKA_SASL_USERNAME must be api-center"
Assert-Condition -Condition ($secretPayload.KAFKA_SASL_PASSWORD -eq $kafkaPassword) -ErrorMessage "KAFKA_SASL_PASSWORD is not aligned with in-cluster Kafka user secret"
Assert-Condition -Condition ($secretPayload.KAFKA_SSL_CA_PEM -eq $kafkaCaPem) -ErrorMessage "KAFKA_SSL_CA_PEM is not aligned with in-cluster Kafka CA secret"

Write-Host "[5/6] Checking ConfigMap Kafka runtime flags"
$configSsl = & kubectl -n $ApiNamespace get configmap api-center-config -o "jsonpath={.data.KAFKA_SSL_ENABLED}"
$configVerify = & kubectl -n $ApiNamespace get configmap api-center-config -o "jsonpath={.data.KAFKA_SSL_REJECT_UNAUTHORIZED}"
$configMechanism = & kubectl -n $ApiNamespace get configmap api-center-config -o "jsonpath={.data.KAFKA_SASL_MECHANISM}"

Assert-Condition -Condition ($configSsl -eq "true") -ErrorMessage "ConfigMap KAFKA_SSL_ENABLED must be true"
Assert-Condition -Condition ($configVerify -eq "true") -ErrorMessage "ConfigMap KAFKA_SSL_REJECT_UNAUTHORIZED must be true"
Assert-Condition -Condition ($configMechanism -eq "scram-sha-512") -ErrorMessage "ConfigMap KAFKA_SASL_MECHANISM must be scram-sha-512"

Write-Host "[6/6] Optional public health check"
if (-not [string]::IsNullOrWhiteSpace($Hostname)) {
  $response = Invoke-WebRequest -Uri "https://$Hostname/api/v1/health/ready" -Method Head -UseBasicParsing
  Assert-Condition -Condition ($response.StatusCode -eq 200) -ErrorMessage "Public health endpoint did not return 200"
} else {
  Write-Host "Hostname not provided; skipping public endpoint check."
}

Write-Host "Kafka configuration smoke checks passed."

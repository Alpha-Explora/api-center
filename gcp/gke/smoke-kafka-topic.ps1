param(
  [string]$KafkaNamespace = "kafka",
  [string]$KafkaUserSecretName = "api-center",
  [string]$KafkaCaSecretName = "api-center-kafka-cluster-ca-cert",
  [string]$KafkaBootstrapServers = "api-center-kafka-kafka-bootstrap.kafka.svc.cluster.local:9092",
  [string]$KafkaUsername = "api-center",
  [string]$Topic = "api-center.smoke.runtime"
)

$ErrorActionPreference = "Stop"

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

Assert-Command kubectl

$kafkaPasswordBase64 = & kubectl -n $KafkaNamespace get secret $KafkaUserSecretName -o "jsonpath={.data.password}"
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($kafkaPasswordBase64)) {
  throw "Unable to read Kafka password from secret: $KafkaNamespace/$KafkaUserSecretName"
}
$kafkaPassword = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($kafkaPasswordBase64))

$kafkaCaBase64 = & kubectl -n $KafkaNamespace get secret $KafkaCaSecretName -o "jsonpath={.data.ca\.crt}"
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($kafkaCaBase64)) {
  throw "Unable to read Kafka CA from secret: $KafkaNamespace/$KafkaCaSecretName"
}

$probeId = [Guid]::NewGuid().ToString("N")
$message = "kafka-smoke-$probeId"

$producerPod = "kafka-smoke-producer-$($probeId.Substring(0, 8))"
$consumerPod = "kafka-smoke-consumer-$($probeId.Substring(0, 8))"

$kcatImage = "edenhill/kcat:1.7.1"

Write-Host "Producing smoke message to topic '$Topic'"
& kubectl -n $KafkaNamespace run $producerPod `
  --restart=Never `
  --rm -i `
  --image=$kcatImage `
  --env="KAFKA_BROKERS=$KafkaBootstrapServers" `
  --env="KAFKA_USERNAME=$KafkaUsername" `
  --env="KAFKA_PASSWORD=$kafkaPassword" `
  --env="KAFKA_CA_B64=$kafkaCaBase64" `
  --env="SMOKE_MESSAGE=$message" `
  --env="SMOKE_TOPIC=$Topic" `
  --command -- sh -lc "echo \"`$KAFKA_CA_B64\" | base64 -d > /tmp/ca.crt; printf '%s\n' \"`$SMOKE_MESSAGE\" | kcat -P -b \"`$KAFKA_BROKERS\" -t \"`$SMOKE_TOPIC\" -X security.protocol=SASL_SSL -X sasl.mechanisms=SCRAM-SHA-512 -X sasl.username=\"`$KAFKA_USERNAME\" -X sasl.password=\"`$KAFKA_PASSWORD\" -X ssl.ca.location=/tmp/ca.crt"
if ($LASTEXITCODE -ne 0) {
  throw "Kafka smoke producer failed"
}

Write-Host "Consuming latest smoke message from topic '$Topic'"
$consumed = & kubectl -n $KafkaNamespace run $consumerPod `
  --restart=Never `
  --rm -i `
  --image=$kcatImage `
  --env="KAFKA_BROKERS=$KafkaBootstrapServers" `
  --env="KAFKA_USERNAME=$KafkaUsername" `
  --env="KAFKA_PASSWORD=$kafkaPassword" `
  --env="KAFKA_CA_B64=$kafkaCaBase64" `
  --env="SMOKE_TOPIC=$Topic" `
  --command -- sh -lc "echo \"`$KAFKA_CA_B64\" | base64 -d > /tmp/ca.crt; kcat -C -b \"`$KAFKA_BROKERS\" -t \"`$SMOKE_TOPIC\" -o -1 -c 1 -q -X security.protocol=SASL_SSL -X sasl.mechanisms=SCRAM-SHA-512 -X sasl.username=\"`$KAFKA_USERNAME\" -X sasl.password=\"`$KAFKA_PASSWORD\" -X ssl.ca.location=/tmp/ca.crt"
if ($LASTEXITCODE -ne 0) {
  throw "Kafka smoke consumer failed"
}

if (-not ($consumed -join "`n").Contains($message)) {
  throw "Kafka smoke message mismatch. Expected marker '$message' was not observed in consumed output."
}

Write-Host "Kafka topic smoke test passed with marker: $message"

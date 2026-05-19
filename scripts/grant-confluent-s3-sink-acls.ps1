param(
  [string]$EnvFile,
  [string]$TopicPrefix = "test.",
  [string]$ConnectorServiceAccountId = $env:CONFLUENT_S3_CONNECTOR_SERVICE_ACCOUNT_ID,
  [string]$DlqTopic = $env:CONFLUENT_S3_CONNECTOR_DLQ_TOPIC
)

$ErrorActionPreference = "Stop"

function Import-DotEnvFile {
  param([string]$Path)

  if (-not $Path) {
    return
  }

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Env file not found: $Path"
  }

  Get-Content -LiteralPath $Path |
    Where-Object { $_ -match "^[A-Za-z_][A-Za-z0-9_]*\s*=" } |
    ForEach-Object {
      $parts = $_ -split "=", 2
      [Environment]::SetEnvironmentVariable(
        $parts[0].Trim(),
        $parts[1].Trim(" '"""),
        "Process"
      )
    }
}

function Require-Env {
  param([string]$Name)

  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not $value) {
    throw "$Name is required."
  }

  return $value.Trim()
}

function New-BasicAuthHeader {
  param(
    [string]$User,
    [string]$Secret
  )

  return "Basic " + [Convert]::ToBase64String(
    [Text.Encoding]::UTF8.GetBytes("${User}:${Secret}")
  )
}

function Add-ConfluentAcl {
  param(
    [string]$BaseUrl,
    [hashtable]$Headers,
    [string]$ResourceType,
    [string]$ResourceName,
    [string]$PatternType,
    [string]$Principal,
    [string]$Operation
  )

  $body = @{
    resource_type = $ResourceType
    resource_name = $ResourceName
    pattern_type = $PatternType
    principal = $Principal
    host = "*"
    operation = $Operation
    permission = "ALLOW"
  } | ConvertTo-Json

  try {
    $response = Invoke-WebRequest `
      -Uri "$BaseUrl/acls" `
      -Headers $Headers `
      -Method POST `
      -Body $body `
      -UseBasicParsing `
      -TimeoutSec 20

    return [pscustomobject]@{
      Resource = "$ResourceType/$PatternType/$ResourceName"
      Operation = $Operation
      Status = [int]$response.StatusCode
      Result = "created"
    }
  } catch {
    $status = if ($_.Exception.Response) {
      [int]$_.Exception.Response.StatusCode
    } else {
      0
    }

    if ($status -eq 409) {
      return [pscustomobject]@{
        Resource = "$ResourceType/$PatternType/$ResourceName"
        Operation = $Operation
        Status = $status
        Result = "already-exists"
      }
    }

    throw
  }
}

Import-DotEnvFile -Path $EnvFile

$environmentId = $env:CONFLUENT_ENVIRONMENT_ID
$clusterId = Require-Env -Name "CONFLUENT_KAFKA_CLUSTER_ID"
$restEndpoint = (Require-Env -Name "CONFLUENT_KAFKA_REST_ENDPOINT").TrimEnd("/")
$apiKey = Require-Env -Name "CONFLUENT_KAFKA_API_KEY"
$apiSecret = Require-Env -Name "CONFLUENT_KAFKA_API_SECRET"

if (-not $ConnectorServiceAccountId) {
  throw "ConnectorServiceAccountId or CONFLUENT_S3_CONNECTOR_SERVICE_ACCOUNT_ID is required."
}

if (-not $TopicPrefix -or -not $TopicPrefix.EndsWith(".")) {
  throw "TopicPrefix must be a Confluent topic prefix ending in '.', for example 'test.' or 'prod.'."
}

$principal = if ($ConnectorServiceAccountId.StartsWith("User:")) {
  $ConnectorServiceAccountId
} else {
  "User:$ConnectorServiceAccountId"
}

$headers = @{
  Authorization = New-BasicAuthHeader -User $apiKey -Secret $apiSecret
  "Content-Type" = "application/json"
}
$baseUrl = "$restEndpoint/kafka/v3/clusters/$clusterId"
$results = @()

foreach ($operation in @("READ", "DESCRIBE")) {
  $results += Add-ConfluentAcl `
    -BaseUrl $baseUrl `
    -Headers $headers `
    -ResourceType "TOPIC" `
    -ResourceName $TopicPrefix `
    -PatternType "PREFIXED" `
    -Principal $principal `
    -Operation $operation
}

if ($DlqTopic) {
  foreach ($operation in @("CREATE", "WRITE", "DESCRIBE")) {
    $results += Add-ConfluentAcl `
      -BaseUrl $baseUrl `
      -Headers $headers `
      -ResourceType "TOPIC" `
      -ResourceName $DlqTopic `
      -PatternType "LITERAL" `
      -Principal $principal `
      -Operation $operation
  }

  $results += Add-ConfluentAcl `
    -BaseUrl $baseUrl `
    -Headers $headers `
    -ResourceType "CLUSTER" `
    -ResourceName "kafka-cluster" `
    -PatternType "LITERAL" `
    -Principal $principal `
    -Operation "CREATE"
}

[pscustomobject]@{
  EnvironmentId = if ($environmentId) { $environmentId } else { "<unset>" }
  ClusterId = $clusterId
  TopicPrefix = $TopicPrefix
  ConnectorPrincipal = $principal
  DlqTopic = if ($DlqTopic) { $DlqTopic } else { "<skipped>" }
}

$results | Format-Table -AutoSize

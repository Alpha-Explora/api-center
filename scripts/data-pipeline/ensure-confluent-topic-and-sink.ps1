param(
  [Parameter(Mandatory = $true)][string]$EnvFile,
  [Parameter(Mandatory = $true)][string]$TopicName,
  [int]$Partitions = 1,
  [long]$RetentionMs = 604800000,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Import-DotEnvFile {
  param([string]$Path)

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

  $value.Trim()
}

function New-BasicAuthHeader {
  param(
    [string]$User,
    [string]$Secret
  )

  "Basic " + [Convert]::ToBase64String(
    [Text.Encoding]::UTF8.GetBytes("${User}:${Secret}")
  )
}

function Invoke-ConfluentJson {
  param(
    [string]$Uri,
    [hashtable]$Headers,
    [string]$Method = "GET",
    [object]$Body = $null,
    [switch]$AllowNotFound
  )

  try {
    $request = @{
      Uri = $Uri
      Headers = $Headers
      Method = $Method
      TimeoutSec = 30
    }

    if ($null -ne $Body) {
      $request.Body = $Body | ConvertTo-Json -Depth 10
    }

    Invoke-RestMethod @request
  } catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($AllowNotFound -and $statusCode -eq 404) {
      return $null
    }

    throw
  }
}

function Read-ConnectorConfig {
  param(
    [string]$Uri,
    [hashtable]$Headers
  )

  $response = Invoke-ConfluentJson -Uri $Uri -Headers $Headers
  if ($response.config) {
    return $response.config
  }

  $response
}

function Read-Topics {
  param([string]$Topics)

  @($Topics -split ",") |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ } |
    Sort-Object -Unique
}

Import-DotEnvFile -Path $EnvFile

$environmentId = Require-Env -Name "CONFLUENT_ENVIRONMENT_ID"
$clusterId = Require-Env -Name "CONFLUENT_KAFKA_CLUSTER_ID"
$restEndpoint = (Require-Env -Name "CONFLUENT_KAFKA_REST_ENDPOINT").TrimEnd("/")
$kafkaApiKey = Require-Env -Name "CONFLUENT_KAFKA_API_KEY"
$kafkaApiSecret = Require-Env -Name "CONFLUENT_KAFKA_API_SECRET"
$cloudApiKey = Require-Env -Name "CONFLUENT_CLOUD_API_KEY"
$cloudApiSecret = Require-Env -Name "CONFLUENT_CLOUD_API_SECRET"
$connectorName = Require-Env -Name "CONFLUENT_S3_CONNECTOR_NAME"

$kafkaHeaders = @{
  Authorization = New-BasicAuthHeader -User $kafkaApiKey -Secret $kafkaApiSecret
  "Content-Type" = "application/json"
}
$cloudHeaders = @{
  Authorization = New-BasicAuthHeader -User $cloudApiKey -Secret $cloudApiSecret
  "Content-Type" = "application/json"
}

$topicsUrl = "$restEndpoint/kafka/v3/clusters/$([Uri]::EscapeDataString($clusterId))/topics"
$topicUrl = "$topicsUrl/$([Uri]::EscapeDataString($TopicName))"
$connectorConfigUrl = "https://api.confluent.cloud/connect/v1/environments/$([Uri]::EscapeDataString($environmentId))/clusters/$([Uri]::EscapeDataString($clusterId))/connectors/$([Uri]::EscapeDataString($connectorName))/config"

$existingTopic = Invoke-ConfluentJson -Uri $topicUrl -Headers $kafkaHeaders -AllowNotFound
$topicCreated = $false

if (-not $existingTopic -and -not $DryRun) {
  Invoke-ConfluentJson `
    -Uri $topicsUrl `
    -Headers $kafkaHeaders `
    -Method "POST" `
    -Body @{
      topic_name = $TopicName
      partitions_count = $Partitions
      configs = @(
        @{ name = "cleanup.policy"; value = "delete" },
        @{ name = "retention.ms"; value = [string]$RetentionMs }
      )
    } | Out-Null
  $topicCreated = $true
}

$connectorConfig = Read-ConnectorConfig -Uri $connectorConfigUrl -Headers $cloudHeaders
$topics = @(Read-Topics -Topics ([string]$connectorConfig.topics))
$sinkAlreadyIncluded = $topics -contains $TopicName
$sinkUpdated = $false

if (-not $sinkAlreadyIncluded -and -not $DryRun) {
  $nextTopics = @($topics + $TopicName) | Sort-Object -Unique
  $connectorConfig.topics = ($nextTopics -join ",")

  Invoke-ConfluentJson `
    -Uri $connectorConfigUrl `
    -Headers $cloudHeaders `
    -Method "PUT" `
    -Body $connectorConfig | Out-Null

  $verifiedConfig = Read-ConnectorConfig -Uri $connectorConfigUrl -Headers $cloudHeaders
  $verifiedTopics = @(Read-Topics -Topics ([string]$verifiedConfig.topics))
  if (-not ($verifiedTopics -contains $TopicName)) {
    throw "S3 Sink connector update did not persist $TopicName."
  }
  $topics = $verifiedTopics
  $sinkUpdated = $true
}

$finalTopic = Invoke-ConfluentJson -Uri $topicUrl -Headers $kafkaHeaders -AllowNotFound
$result = [ordered]@{
  dry_run = [bool]$DryRun
  topic_name = $TopicName
  topic_exists = [bool]$finalTopic
  topic_created = $topicCreated
  connector_name = $connectorName
  s3_sink_includes_topic = [bool]($topics -contains $TopicName)
  s3_sink_updated = $sinkUpdated
  connector_topic_count = $topics.Count
}

$result | ConvertTo-Json -Depth 5

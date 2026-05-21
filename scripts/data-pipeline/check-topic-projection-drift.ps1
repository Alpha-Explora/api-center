param(
  [Parameter(Mandatory = $true)]
  [string]$TopicsFile,

  [string[]]$ExpectedTopic = @(),

  [string]$RawTopicTablesSql,

  [string]$OnboardingStateFile = $env:TOPIC_ONBOARDING_STATE_FILE,

  [string]$EnvFile,

  [switch]$SkipConfluent
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

function Get-EnvValue {
  param([string]$Name)

  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not $value) {
    return $null
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

function Get-ConnectorTopics {
  $environmentId = Get-EnvValue -Name "CONFLUENT_ENVIRONMENT_ID"
  $clusterId = Get-EnvValue -Name "CONFLUENT_KAFKA_CLUSTER_ID"
  $connectorName = Get-EnvValue -Name "CONFLUENT_S3_CONNECTOR_NAME"
  $cloudApiKey = Get-EnvValue -Name "CONFLUENT_CLOUD_API_KEY"
  $cloudApiSecret = Get-EnvValue -Name "CONFLUENT_CLOUD_API_SECRET"

  if (-not ($environmentId -and $clusterId -and $connectorName -and $cloudApiKey -and $cloudApiSecret)) {
    return @()
  }

  $headers = @{
    Authorization = New-BasicAuthHeader -User $cloudApiKey -Secret $cloudApiSecret
    "Content-Type" = "application/json"
  }

  $url = "https://api.confluent.cloud/connect/v1/environments/$([Uri]::EscapeDataString($environmentId))/clusters/$([Uri]::EscapeDataString($clusterId))/connectors/$([Uri]::EscapeDataString($connectorName))/config"
  $response = Invoke-RestMethod -Uri $url -Headers $headers -Method GET -TimeoutSec 30
  $config = if ($response.config) { $response.config } else { $response }
  $topics = [string]$config.topics

  if (-not $topics) {
    return @()
  }

  return $topics.Split(",") |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ } |
    Sort-Object -Unique
}

function Get-KafkaRestTopics {
  $clusterId = Get-EnvValue -Name "CONFLUENT_KAFKA_CLUSTER_ID"
  $restEndpoint = Get-EnvValue -Name "CONFLUENT_KAFKA_REST_ENDPOINT"
  $kafkaApiKey = Get-EnvValue -Name "CONFLUENT_KAFKA_API_KEY"
  $kafkaApiSecret = Get-EnvValue -Name "CONFLUENT_KAFKA_API_SECRET"

  if (-not ($clusterId -and $restEndpoint -and $kafkaApiKey -and $kafkaApiSecret)) {
    return @()
  }

  $headers = @{
    Authorization = New-BasicAuthHeader -User $kafkaApiKey -Secret $kafkaApiSecret
    "Content-Type" = "application/json"
  }

  $baseUrl = $restEndpoint.TrimEnd("/")
  $url = "$baseUrl/kafka/v3/clusters/$([Uri]::EscapeDataString($clusterId))/topics"
  $response = Invoke-RestMethod -Uri $url -Headers $headers -Method GET -TimeoutSec 30

  return @($response.data) |
    ForEach-Object { $_.topic_name } |
    Where-Object { $_ } |
    Sort-Object -Unique
}

Import-DotEnvFile -Path $EnvFile

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$nodeScript = Join-Path $repoRoot "scripts\data-pipeline\resolve-athena-topic-projection.js"

if (-not $RawTopicTablesSql) {
  $RawTopicTablesSql = Join-Path $repoRoot "infra\aws-data-pipeline\catalog\raw-topic-tables.sql"
}

$confluentTopicsFile = $null
try {
  if (-not $SkipConfluent) {
    $confluentTopics = @(Get-ConnectorTopics)
    if ($confluentTopics.Count -eq 0) {
      $confluentTopics = @(Get-KafkaRestTopics)
    }

    if ($confluentTopics.Count -gt 0) {
      $confluentTopicsFile = [System.IO.Path]::GetTempFileName()
      Set-Content -LiteralPath $confluentTopicsFile -Value $confluentTopics -Encoding UTF8
    } else {
      Write-Warning "Confluent topic source skipped. Configure connector credentials or Kafka REST credentials to compare live topics."
    }
  }

  $nodeArgs = @(
    $nodeScript,
    "--check",
    "-TopicsFile",
    $TopicsFile,
    "-RawTopicTablesSql",
    $RawTopicTablesSql
  )

  foreach ($topic in $ExpectedTopic) {
    $nodeArgs += @("-ExpectedTopic", $topic)
  }

  if ($OnboardingStateFile) {
    $nodeArgs += @("-OnboardingStateFile", $OnboardingStateFile)
  }

  if ($confluentTopicsFile) {
    $nodeArgs += @("-ConfluentTopicsFile", $confluentTopicsFile)
  }

  & node @nodeArgs
  exit $LASTEXITCODE
} finally {
  if ($confluentTopicsFile -and (Test-Path -LiteralPath $confluentTopicsFile)) {
    Remove-Item -LiteralPath $confluentTopicsFile -Force
  }
}

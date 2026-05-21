param(
  [Parameter(Mandatory=$true)]
  [ValidateSet(
    "common_silver.tribe_event_envelope",
    "gold_platform.pipeline_health_daily",
    "gold_platform.event_quality_daily",
    "gold_platform.shared_service_usage_daily",
    "gold_platform.gateway_decision_daily",
    "gold_platform.athena_query_cost_daily"
  )]
  [string]$Dataset,

  [ValidateSet("test", "prod")]
  [string]$Environment = "test",

  [Parameter(Mandatory=$true)]
  [ValidatePattern("^\d{4}$")]
  [string]$Year,

  [Parameter(Mandatory=$true)]
  [ValidatePattern("^\d{2}$")]
  [string]$Month,

  [Parameter(Mandatory=$true)]
  [ValidatePattern("^\d{2}$")]
  [string]$Day,

  [string]$TargetDatabase = "materialized_platform",
  [string]$OutputBucket = "api-center-curated-data",
  [string]$Workgroup = $env:ATHENA_WORKGROUP,
  [ValidatePattern("^[a-z0-9][a-z0-9._-]*[a-z0-9]$")]
  [string]$TribeId,
  [string]$Profile = $env:AWS_PROFILE,
  [switch]$Replace,
  [switch]$ConfirmReplaceCleanup,
  [switch]$DryRun,
  [switch]$Wait
)

$ErrorActionPreference = "Stop"

if (-not $Workgroup) {
  $Workgroup = "api-center-materialization-$Environment"
}

function Get-DatasetConfig {
  param([string]$Name)

  switch ($Name) {
    "common_silver.tribe_event_envelope" {
      return @{
        Source = "common_silver.tribe_event_envelope"
        Layer = "silver"
        Folder = "common_silver/tribe_event_envelope"
        SupportsTribeScope = $true
      }
    }
    "gold_platform.pipeline_health_daily" {
      return @{
        Source = "gold_platform.pipeline_health_daily"
        Layer = "gold"
        Folder = "platform/pipeline_health_daily"
        SupportsTribeScope = $false
      }
    }
    "gold_platform.event_quality_daily" {
      return @{
        Source = "gold_platform.event_quality_daily"
        Layer = "gold"
        Folder = "platform/event_quality_daily"
        SupportsTribeScope = $false
      }
    }
    "gold_platform.shared_service_usage_daily" {
      return @{
        Source = "gold_platform.shared_service_usage_daily"
        Layer = "gold"
        Folder = "platform/shared_service_usage_daily"
        SupportsTribeScope = $false
      }
    }
    "gold_platform.gateway_decision_daily" {
      return @{
        Source = "gold_platform.gateway_decision_daily"
        Layer = "gold"
        Folder = "platform/gateway_decision_daily"
        SupportsTribeScope = $false
      }
    }
    "gold_platform.athena_query_cost_daily" {
      return @{
        Source = "gold_platform.athena_query_cost_daily"
        Layer = "gold"
        Folder = "platform/athena_query_cost_daily"
        SupportsTribeScope = $false
      }
    }
    default {
      throw "Unsupported materialization dataset: $Name"
    }
  }
}

function Convert-ToTableName {
  param(
    [string]$Name,
    [string]$Env,
    [string]$Y,
    [string]$M,
    [string]$D
  )

  $safeName = $Name.Replace(".", "_").Replace("-", "_")
  return "${safeName}_${Env}_${Y}${M}${D}".ToLowerInvariant()
}

$config = Get-DatasetConfig -Name $Dataset
if ($TribeId -and -not $config.SupportsTribeScope) {
  throw "-TribeId is only supported for common_silver.tribe_event_envelope materialization."
}

$tableDatasetName = if ($TribeId) { "$Dataset.$TribeId" } else { $Dataset }
$tableName = Convert-ToTableName -Name $tableDatasetName -Env $Environment -Y $Year -M $Month -D $Day
$scopePath = if ($TribeId) { "tribe_id=$TribeId/" } else { "" }
$externalLocation = "s3://$OutputBucket/$($config.Layer)/$($config.Folder)/${scopePath}environment=$Environment/year=$Year/month=$Month/day=$Day/"
$tribePredicate = if ($TribeId) { "`n  AND tribe_id = '$TribeId'" } else { "" }

$statements = @(
  "CREATE DATABASE IF NOT EXISTS $TargetDatabase"
)

if ($Replace) {
  $statements += "DROP TABLE IF EXISTS $TargetDatabase.$tableName"
}

$statements += @"
CREATE TABLE $TargetDatabase.$tableName
WITH (
  format = 'PARQUET',
  parquet_compression = 'SNAPPY',
  external_location = '$externalLocation'
) AS
SELECT *
FROM $($config.Source)
WHERE environment = '$Environment'
  AND year = '$Year'
  AND month = '$Month'
  AND day = '$Day'$tribePredicate
"@

$query = ($statements -join ";`n`n") + ";`n"

$summary = [ordered]@{
  dataset = $Dataset
  environment = $Environment
  partition = "$Year-$Month-$Day"
  tribe_id = if ($TribeId) { $TribeId } else { $null }
  target_database = $TargetDatabase
  target_table = "$TargetDatabase.$tableName"
  external_location = $externalLocation
  workgroup = $Workgroup
  mode = if ($DryRun) { "dry-run" } else { "execute" }
  replace = [bool]$Replace
  confirm_replace_cleanup = [bool]$ConfirmReplaceCleanup
  replace_cleanup_required = [bool]($Replace -and -not $ConfirmReplaceCleanup)
  replace_cleanup_location = if ($Replace) { $externalLocation } else { $null }
  query = $query
}

if ($DryRun) {
  $summary | ConvertTo-Json -Depth 6
  exit 0
}

if ($Replace -and -not $ConfirmReplaceCleanup) {
  throw "-Replace deletes and recreates $($summary.target_table). Pass -ConfirmReplaceCleanup to also delete existing objects under $externalLocation before CTAS."
}

if ($Replace) {
  $cleanupArgs = @("s3", "rm", $externalLocation, "--recursive")
  if ($Profile) {
    $cleanupArgs += @("--profile", $Profile)
  }

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $cleanupOutput = & aws @cleanupArgs 2>&1
    $cleanupExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($cleanupExitCode -ne 0) {
    throw "aws $($cleanupArgs -join ' ') failed: $cleanupOutput"
  }
}

$queryRunner = Join-Path $PSScriptRoot "run-athena-query.ps1"
$tempFile = New-TemporaryFile
try {
  Set-Content -LiteralPath $tempFile.FullName -Value $query -Encoding UTF8

  $args = @{
    QueryFile = $tempFile.FullName
    Database = $TargetDatabase
    Workgroup = $Workgroup
    ResultPurpose = "platform-materialization"
    Environment = $Environment
  }

  if ($Profile) {
    $args.Profile = $Profile
  }

  if ($Wait) {
    & $queryRunner @args -Wait
  } else {
    & $queryRunner @args
  }
} finally {
  Remove-Item -LiteralPath $tempFile.FullName -Force -ErrorAction SilentlyContinue
}

param(
  [ValidateSet("test", "prod")]
  [string]$Environment = "test",

  [string]$Database = $env:ATHENA_DATABASE,

  [string]$Workgroup = $env:ATHENA_WORKGROUP,

  [string]$Profile = $env:AWS_PROFILE,

  [switch]$DryRun,

  [switch]$Wait
)

$ErrorActionPreference = "Stop"

if (-not $Database) {
  $Database = "api_center_raw"
}

if (-not $Workgroup) {
  $Workgroup = "api-center-platform-validation-$Environment"
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$queryRunner = Join-Path $PSScriptRoot "run-athena-query.ps1"
$sqlFiles = @(
  "infra/aws-data-pipeline/catalog/raw-topic-tables.sql",
  "infra/aws-data-pipeline/catalog/bronze-tribe-events.sql",
  "infra/aws-data-pipeline/catalog/bronze-shared-service-events.sql",
  "infra/aws-data-pipeline/catalog/bronze-apicenter-ops-events.sql",
  "infra/aws-data-pipeline/catalog/common-silver-events.sql",
  "infra/aws-data-pipeline/catalog/event-schema-registry.sql",
  "infra/aws-data-pipeline/catalog/gold-platform-health.sql",
  "infra/aws-data-pipeline/catalog/gold-shared-service-usage.sql",
  "infra/aws-data-pipeline/catalog/gold-platform-governance.sql",
  "infra/aws-data-pipeline/catalog/gold-platform-decision-signals.sql"
)

$resolvedOutputLocation = & (Join-Path $PSScriptRoot "resolve-athena-output-location.ps1") `
  -Purpose platform-validation `
  -Environment $Environment

$steps = foreach ($relativePath in $sqlFiles) {
  $fullPath = Join-Path $repoRoot $relativePath
  if (-not (Test-Path -LiteralPath $fullPath)) {
    throw "Catalog SQL file not found: $relativePath"
  }

  [ordered]@{
    query_file = $relativePath
    database = $Database
    workgroup = $Workgroup
    result_purpose = "platform-validation"
    environment = $Environment
    output_location = $resolvedOutputLocation
  }
}

if ($DryRun) {
  [ordered]@{
    mode = "dry-run"
    steps = $steps
  } | ConvertTo-Json -Depth 6
  exit 0
}

foreach ($step in $steps) {
  $args = @{
    QueryFile = (Join-Path $repoRoot $step.query_file)
    Database = $step.database
    Workgroup = $step.workgroup
    ResultPurpose = $step.result_purpose
    Environment = $step.environment
  }

  if ($Profile) {
    $args.Profile = $Profile
  }

  if ($Wait) {
    & $queryRunner @args -Wait
  } else {
    & $queryRunner @args
  }
}

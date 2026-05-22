param(
  [Parameter(Mandatory=$true)][string]$ApprovalFile,
  [string]$TopicsFile = "infra/aws-data-pipeline/topic-projection-values.txt",
  [string]$RawTopicTablesSql = "infra/aws-data-pipeline/catalog/raw-topic-tables.sql",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$promoter = Join-Path $PSScriptRoot "promote-production-pilot-projection.js"
$nodeArgs = @(
  $promoter,
  "-ApprovalFile",
  $ApprovalFile,
  "-TopicsFile",
  $TopicsFile,
  "-RawTopicTablesSql",
  $RawTopicTablesSql
)

if ($DryRun) {
  $nodeArgs += "-DryRun"
}

node @nodeArgs
exit $LASTEXITCODE

param(
  [Parameter(Mandatory=$true)][string]$TribeId,

  [Parameter(Mandatory=$true)]
  [ValidateSet("test", "prod")]
  [string]$Environment,

  [Parameter(Mandatory=$true)][string]$EventType,

  [Parameter(Mandatory=$true)][string]$MetricName,

  [Parameter(Mandatory=$true)][string]$Owner,

  [Parameter(Mandatory=$true)][string]$Steward,

  [Parameter(Mandatory=$true)][string]$ApprovedReaderGroup,

  [string]$Year = (Get-Date).ToUniversalTime().ToString("yyyy"),

  [string]$Month = (Get-Date).ToUniversalTime().ToString("MM"),

  [string]$Day = (Get-Date).ToUniversalTime().ToString("dd"),

  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

if (-not $DryRun) {
  throw "Only -DryRun is implemented. Review generated SQL before applying through the approved Athena catalog workflow."
}

$generator = Join-Path $PSScriptRoot "generate-tribe-curated-sql.js"

node $generator `
  -TribeId $TribeId `
  -Environment $Environment `
  -EventType $EventType `
  -MetricName $MetricName `
  -Owner $Owner `
  -Steward $Steward `
  -ApprovedReaderGroup $ApprovedReaderGroup `
  -Year $Year `
  -Month $Month `
  -Day $Day `
  -DryRun

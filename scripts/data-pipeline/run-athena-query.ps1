param(
  [Parameter(Mandatory=$true)][string]$QueryFile,
  [string]$Database = $env:ATHENA_DATABASE,
  [string]$Workgroup = $env:ATHENA_WORKGROUP,
  [string]$OutputLocation = $env:ATHENA_OUTPUT_LOCATION,
  [ValidateSet("platform-validation", "management", "tribe")]
  [string]$ResultPurpose = "platform-validation",
  [ValidateSet("test", "prod")]
  [string]$Environment = "test",
  [string]$TribeId,
  [string]$Profile = $env:AWS_PROFILE,
  [hashtable]$Parameters = @{},
  [switch]$Wait,
  [int]$PollSeconds = 2,
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"

if (-not $Database) { throw "ATHENA_DATABASE is required" }
if (-not $Workgroup) { throw "ATHENA_WORKGROUP is required" }

if (-not $OutputLocation) {
  $resolver = Join-Path $PSScriptRoot "resolve-athena-output-location.ps1"
  $resolverArgs = @{
    Purpose = $ResultPurpose
    Environment = $Environment
  }

  if ($TribeId) {
    $resolverArgs.TribeId = $TribeId
  }

  $OutputLocation = & $resolver @resolverArgs
}

if (-not $OutputLocation) { throw "ATHENA_OUTPUT_LOCATION is required" }

function Invoke-AwsJson {
  param([string[]]$Arguments)

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $raw = & aws @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($exitCode -ne 0) {
    throw "aws $($Arguments -join ' ') failed: $raw"
  }

  if (-not $raw) {
    return $null
  }

  return $raw | ConvertFrom-Json
}

function Split-SqlStatements {
  param([string]$Sql)

  $statements = @()
  $current = New-Object System.Text.StringBuilder
  foreach ($line in ($Sql -split "`r?`n")) {
    $trimmed = $line.Trim()
    if ($trimmed.StartsWith("--") -or $trimmed.Length -eq 0) {
      continue
    }

    [void]$current.AppendLine($line)
    if ($trimmed.EndsWith(";")) {
      $statements += $current.ToString().Trim().TrimEnd(";")
      $current.Clear() | Out-Null
    }
  }

  $tail = $current.ToString().Trim()
  if ($tail) {
    $statements += $tail.TrimEnd(";")
  }

  return $statements
}

$query = Get-Content -LiteralPath $QueryFile -Raw
foreach ($key in $Parameters.Keys) {
  $query = $query.Replace('${' + $key + '}', [string]$Parameters[$key])
}

$executions = @()
foreach ($statement in (Split-SqlStatements -Sql $query)) {
  $args = @(
    "athena", "start-query-execution",
    "--query-string", $statement,
    "--query-execution-context", "Database=$Database",
    "--work-group", $Workgroup,
    "--result-configuration", "OutputLocation=$OutputLocation"
  )

  if ($Profile) {
    $args += @("--profile", $Profile)
  }

  $started = Invoke-AwsJson -Arguments $args
  $queryExecutionId = $started.QueryExecutionId

  $result = [ordered]@{
    query_execution_id = $queryExecutionId
    state = "SUBMITTED"
  }

  if ($Wait) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
      Start-Sleep -Seconds $PollSeconds
      $statusArgs = @("athena", "get-query-execution", "--query-execution-id", $queryExecutionId)
      if ($Profile) {
        $statusArgs += @("--profile", $Profile)
      }
      $status = Invoke-AwsJson -Arguments $statusArgs
      $state = $status.QueryExecution.Status.State
    } while (($state -in @("QUEUED", "RUNNING")) -and (Get-Date) -lt $deadline)

    $result.state = $state
    $result.state_change_reason = $status.QueryExecution.Status.StateChangeReason

    if ($state -eq "SUCCEEDED") {
      $result.output_location = $status.QueryExecution.ResultConfiguration.OutputLocation
    } elseif ($state -in @("FAILED", "CANCELLED")) {
      throw "Athena query $queryExecutionId ended with $state`: $($result.state_change_reason)"
    } else {
      throw "Athena query $queryExecutionId timed out after $TimeoutSeconds seconds"
    }
  }

  $executions += [pscustomobject]$result
}

$executions | ConvertTo-Json -Depth 5

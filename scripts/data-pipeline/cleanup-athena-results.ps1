param(
  [string]$Bucket = $env:ATHENA_RESULTS_BUCKET,
  [string]$Profile = $env:AWS_PROFILE,
  [int]$OlderThanDays = 7,
  [switch]$MoveToLegacy,
  [switch]$Delete,
  [switch]$ConfirmCleanup
)

$ErrorActionPreference = "Stop"

if (-not $Bucket) {
  $Bucket = "api-center-athena-results"
}

if (($MoveToLegacy -or $Delete) -and -not $ConfirmCleanup) {
  throw "ConfirmCleanup is required for MoveToLegacy or Delete."
}

$cutoff = (Get-Date).ToUniversalTime().AddDays(-1 * $OlderThanDays)
$inventoryArgs = @{
  Bucket = $Bucket
}

if ($Profile) {
  $inventoryArgs.Profile = $Profile
}

$inventory = .\scripts\data-pipeline\validate-athena-results-layout.ps1 @inventoryArgs | ConvertFrom-Json
$targets = @($inventory.rows | Where-Object {
  -not $_.approved_prefix -and ([datetime]$_.last_modified) -lt $cutoff
})
$legacyDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd")

$actions = foreach ($target in $targets) {
  $action = "dry-run"
  $destination = $null

  if ($MoveToLegacy) {
    $destination = "athena-results/legacy-unclassified/$legacyDate/$($target.key.Substring('athena-results/'.Length))"
    $copySource = "$Bucket/$($target.key)"
    $copyArgs = @("s3api", "copy-object", "--bucket", $Bucket, "--copy-source", $copySource, "--key", $destination)
    $deleteArgs = @("s3api", "delete-object", "--bucket", $Bucket, "--key", $target.key)
    if ($Profile) {
      $copyArgs += @("--profile", $Profile)
      $deleteArgs += @("--profile", $Profile)
    }
    & aws @copyArgs | Out-Null
    & aws @deleteArgs | Out-Null
    $action = "moved-to-legacy"
  } elseif ($Delete) {
    $deleteArgs = @("s3api", "delete-object", "--bucket", $Bucket, "--key", $target.key)
    if ($Profile) {
      $deleteArgs += @("--profile", $Profile)
    }
    & aws @deleteArgs | Out-Null
    $action = "deleted"
  }

  [pscustomobject]@{
    action = $action
    bucket = $Bucket
    key = $target.key
    destination = $destination
    last_modified = $target.last_modified
    size = $target.size
  }
}

[pscustomobject]@{
  bucket = $Bucket
  older_than_days = $OlderThanDays
  target_count = $targets.Count
  mode = if ($MoveToLegacy) { "move-to-legacy" } elseif ($Delete) { "delete" } else { "dry-run" }
  actions = @($actions)
} | ConvertTo-Json -Depth 5

param(
  [string]$Bucket = $env:ATHENA_RESULTS_BUCKET,
  [string]$Profile = $env:AWS_PROFILE,
  [int]$MaxKeys = 1000
)

$ErrorActionPreference = "Stop"

if (-not $Bucket) {
  $Bucket = $env:API_CENTER_RAW_BUCKET
}

if (-not $Bucket) {
  $Bucket = "api-center-raw-data"
}

$args = @(
  "s3api", "list-objects-v2",
  "--bucket", $Bucket,
  "--prefix", "athena-results/",
  "--max-keys", "$MaxKeys"
)

if ($Profile) {
  $args += @("--profile", $Profile)
}

$json = & aws @args | ConvertFrom-Json
$objects = @($json.Contents | Where-Object { $_ })
$approvedPrefixes = @(
  "athena-results/platform/validation/test/",
  "athena-results/platform/validation/prod/",
  "athena-results/management/test/",
  "athena-results/management/prod/",
  "athena-results/tribe/",
  "athena-results/legacy-unclassified/"
)

$rows = $objects | ForEach-Object {
  $key = $_.Key
  $approved = $false
  foreach ($prefix in $approvedPrefixes) {
    if ($key.StartsWith($prefix)) {
      $approved = $true
      break
    }
  }

  [pscustomobject]@{
    bucket = $Bucket
    key = $key
    size = $_.Size
    last_modified = $_.LastModified
    approved_prefix = $approved
  }
}

[pscustomobject]@{
  bucket = $Bucket
  scanned = $rows.Count
  unclassified_count = @($rows | Where-Object { -not $_.approved_prefix }).Count
  rows = $rows
} | ConvertTo-Json -Depth 5

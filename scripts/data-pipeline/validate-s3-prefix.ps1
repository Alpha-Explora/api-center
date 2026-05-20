param(
  [Parameter(Mandatory=$true)][string]$Bucket,
  [Parameter(Mandatory=$true)][string]$PhysicalTopic,
  [string]$Profile = $env:AWS_PROFILE,
  [int]$MaxKeys = 20
)

$ErrorActionPreference = "Stop"

$aws = "aws"
$prefix = "topics/$PhysicalTopic/"
$args = @("s3api", "list-objects-v2", "--bucket", $Bucket, "--prefix", $prefix, "--max-keys", "$MaxKeys")

if ($Profile) {
  $args += @("--profile", $Profile)
}

$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
  $raw = & $aws @args 2>&1
  $exitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousErrorActionPreference
}

if ($exitCode -ne 0) {
  throw "aws s3api list-objects-v2 failed: $raw"
}

$json = $raw | ConvertFrom-Json
$objects = @($json.Contents | Where-Object { $_ })

[pscustomobject]@{
  bucket = $Bucket
  physical_topic = $PhysicalTopic
  prefix = "s3://$Bucket/$prefix"
  object_count_returned = $objects.Count
  latest_key = ($objects | Sort-Object LastModified -Descending | Select-Object -First 1).Key
  latest_object_at = ($objects | Sort-Object LastModified -Descending | Select-Object -First 1).LastModified
} | ConvertTo-Json -Depth 5

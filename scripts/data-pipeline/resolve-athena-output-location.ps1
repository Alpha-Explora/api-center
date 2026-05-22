param(
  [ValidateSet("platform-validation", "platform-materialization", "management", "tribe")]
  [string]$Purpose = "platform-validation",

  [ValidateSet("test", "prod")]
  [string]$Environment = "test",

  [string]$TribeId,

  [string]$ResultsBucket = $env:ATHENA_RESULTS_BUCKET,

  [string]$FallbackBucket = $env:API_CENTER_RAW_BUCKET
)

$ErrorActionPreference = "Stop"

# Prefer ATHENA_RESULTS_BUCKET=api-center-athena-results before granting BI or
# tribe-facing access. API_CENTER_RAW_BUCKET remains a pilot fallback only.
if (-not $ResultsBucket) {
  $ResultsBucket = "api-center-athena-results"
}

if (-not $ResultsBucket) {
  $ResultsBucket = $FallbackBucket
}

if ($Purpose -eq "tribe") {
  if (-not $TribeId) {
    throw "TribeId is required when Purpose is tribe."
  }

  if ($TribeId -notmatch "^[a-z0-9][a-z0-9._-]*[a-z0-9]$") {
    throw "TribeId must use lowercase letters, numbers, dot, underscore, or hyphen."
  }

  "s3://$ResultsBucket/athena-results/tribe/$TribeId/$Environment/"
  exit 0
}

if ($Purpose -eq "platform-validation") {
  "s3://$ResultsBucket/athena-results/platform/validation/$Environment/"
  exit 0
}

if ($Purpose -eq "platform-materialization") {
  "s3://$ResultsBucket/athena-results/platform/materialization/$Environment/"
  exit 0
}

"s3://$ResultsBucket/athena-results/management/$Environment/"

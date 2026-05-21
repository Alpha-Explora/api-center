param(
  [ValidateSet("test", "prod")]
  [string]$Environment = "test",

  [string]$ResultsBucket = $env:ATHENA_RESULTS_BUCKET,

  [string]$RawBucket = $env:API_CENTER_RAW_BUCKET,

  [string]$TribeId,

  [string]$Profile = $env:AWS_PROFILE,

  [string]$Region = $env:AWS_REGION,

  [long]$BytesScannedCutoffBytes = 1073741824,

  [switch]$Apply,

  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

if (-not $ResultsBucket) {
  $ResultsBucket = "api-center-athena-results"
}

if (-not $RawBucket) {
  $RawBucket = "api-center-raw-data"
}

if ($Apply -and $DryRun) {
  throw "Use either -Apply or -DryRun, not both."
}

if (-not $Region) {
  $Region = if ($Profile) {
    (& aws configure get region --profile $Profile 2>$null)
  } else {
    (& aws configure get region 2>$null)
  }
}

if (-not $Region) {
  $Region = "ap-southeast-2"
}

if ($TribeId -and $TribeId -notmatch "^[a-z0-9][a-z0-9._-]*[a-z0-9]$") {
  throw "TribeId must use lowercase letters, numbers, dot, underscore, or hyphen."
}

$isDryRun = -not $Apply
$platformValidationWorkgroup = "api-center-platform-validation-$Environment"
$platformMaterializationWorkgroup = "api-center-materialization-$Environment"
$managementWorkgroup = "api-center-management-$Environment"
$tribeWorkgroup = if ($TribeId) { "api-center-tribe-$TribeId-$Environment" } else { "api-center-tribe-<tribe_id>-$Environment" }

$plan = [ordered]@{
  mode = if ($isDryRun) { "dry-run" } else { "apply" }
  environment = $Environment
  raw_bucket = $RawBucket
  results_bucket = $ResultsBucket
  lifecycle_days = @{
    platform_validation = 7
    platform_materialization = 7
    management = 14
    tribe = 30
  }
  workgroups = @(
    @{
      name = $platformValidationWorkgroup
      output_location = "s3://$ResultsBucket/athena-results/platform/validation/$Environment/"
      purpose = "platform validation"
      enforce_output_location = $true
    },
    @{
      name = $platformMaterializationWorkgroup
      output_location = "s3://$ResultsBucket/athena-results/platform/materialization/$Environment/"
      purpose = "platform materialization"
      enforce_output_location = $false
    },
    @{
      name = $managementWorkgroup
      output_location = "s3://$ResultsBucket/athena-results/management/$Environment/"
      purpose = "management"
      enforce_output_location = $true
    },
    @{
      name = $tribeWorkgroup
      output_location = if ($TribeId) {
        "s3://$ResultsBucket/athena-results/tribe/$TribeId/$Environment/"
      } else {
        "s3://$ResultsBucket/athena-results/tribe/<tribe_id>/$Environment/"
      }
      purpose = "approved tribe readers"
      enforce_output_location = $true
    }
  )
  reader_policy_template = "infra/aws-data-pipeline/policies/athena-results-bucket-policy.json"
  lifecycle_template = "infra/aws-data-pipeline/policies/athena-results-lifecycle.json"
  region = $Region
  bytes_scanned_cutoff_bytes = $BytesScannedCutoffBytes
  raw_topics_reader_access = "denied for BI and tribe result reader roles"
}

if ($isDryRun) {
  $plan | ConvertTo-Json -Depth 8
  exit 0
}

if (-not $Profile) {
  throw "AWS_PROFILE or -Profile is required when using -Apply."
}

function Invoke-Aws {
  param([string[]]$Arguments, [switch]$AllowFailure)

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $raw = & aws @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($exitCode -ne 0 -and -not $AllowFailure) {
    throw "aws $($Arguments -join ' ') failed: $raw"
  }

  [pscustomobject]@{
    exit_code = $exitCode
    output = $raw
  }
}

function New-TempJsonFile {
  param([object]$Value)

  $file = New-TemporaryFile
  $json = $Value | ConvertTo-Json -Depth 10
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($file.FullName, $json, $utf8NoBom)
  $file.FullName
}

$actions = @()
$headBucket = Invoke-Aws -Arguments @("s3api", "head-bucket", "--bucket", $ResultsBucket, "--profile", $Profile) -AllowFailure
if ($headBucket.exit_code -ne 0) {
  $createArgs = @("s3api", "create-bucket", "--bucket", $ResultsBucket, "--region", $Region, "--profile", $Profile)
  if ($Region -ne "us-east-1") {
    $createArgs += @("--create-bucket-configuration", "LocationConstraint=$Region")
  }
  $created = Invoke-Aws -Arguments $createArgs -AllowFailure
  if ($created.exit_code -eq 0) {
    $actions += "created results bucket $ResultsBucket"
  } elseif (($created.output -join "`n") -match "BucketAlreadyOwnedByYou") {
    $actions += "results bucket $ResultsBucket already exists"
  } else {
    throw "aws $($createArgs -join ' ') failed: $($created.output)"
  }
} else {
  $actions += "results bucket $ResultsBucket already exists"
}

Invoke-Aws -Arguments @(
  "s3api", "put-public-access-block",
  "--bucket", $ResultsBucket,
  "--public-access-block-configuration", "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true",
  "--profile", $Profile
) | Out-Null
$actions += "applied public access block to $ResultsBucket"

$encryptionFile = New-TempJsonFile -Value @{
  Rules = @(
    @{
      ApplyServerSideEncryptionByDefault = @{
        SSEAlgorithm = "AES256"
      }
    }
  )
}
Invoke-Aws -Arguments @(
  "s3api", "put-bucket-encryption",
  "--bucket", $ResultsBucket,
  "--server-side-encryption-configuration", "file://$encryptionFile",
  "--profile", $Profile
) | Out-Null
$actions += "enabled SSE-S3 encryption on $ResultsBucket"

Invoke-Aws -Arguments @(
  "s3api", "put-bucket-lifecycle-configuration",
  "--bucket", $ResultsBucket,
  "--lifecycle-configuration", "file://infra/aws-data-pipeline/policies/athena-results-lifecycle.json",
  "--profile", $Profile
) | Out-Null
$actions += "applied athena results lifecycle policy to $ResultsBucket"

foreach ($workgroup in $plan.workgroups) {
  if ($workgroup.name -like "*<tribe_id>*") {
    $actions += "skipped template tribe workgroup; pass -TribeId to create a concrete tribe workgroup"
    continue
  }

  $createConfigFile = New-TempJsonFile -Value @{
    ResultConfiguration = @{
      OutputLocation = $workgroup.output_location
      EncryptionConfiguration = @{
        EncryptionOption = "SSE_S3"
      }
    }
    EnforceWorkGroupConfiguration = [bool]$workgroup.enforce_output_location
    PublishCloudWatchMetricsEnabled = $true
    BytesScannedCutoffPerQuery = $BytesScannedCutoffBytes
  }
  $updateConfigFile = New-TempJsonFile -Value @{
    ResultConfigurationUpdates = @{
      OutputLocation = $workgroup.output_location
      EncryptionConfiguration = @{
        EncryptionOption = "SSE_S3"
      }
    }
    EnforceWorkGroupConfiguration = [bool]$workgroup.enforce_output_location
    PublishCloudWatchMetricsEnabled = $true
    BytesScannedCutoffPerQuery = $BytesScannedCutoffBytes
  }

  $existing = Invoke-Aws -Arguments @(
    "athena", "get-work-group",
    "--work-group", $workgroup.name,
    "--region", $Region,
    "--profile", $Profile
  ) -AllowFailure
  if ($existing.exit_code -eq 0) {
    Invoke-Aws -Arguments @(
      "athena", "update-work-group",
      "--work-group", $workgroup.name,
      "--configuration-updates", "file://$updateConfigFile",
      "--region", $Region,
      "--profile", $Profile
    ) | Out-Null
    $actions += "updated Athena workgroup $($workgroup.name)"
  } else {
    Invoke-Aws -Arguments @(
      "athena", "create-work-group",
      "--name", $workgroup.name,
      "--configuration", "file://$createConfigFile",
      "--region", $Region,
      "--profile", $Profile
    ) | Out-Null
    $actions += "created Athena workgroup $($workgroup.name)"
  }
}

[ordered]@{
  mode = "apply"
  environment = $Environment
  results_bucket = $ResultsBucket
  region = $Region
  actions = $actions
} | ConvertTo-Json -Depth 6

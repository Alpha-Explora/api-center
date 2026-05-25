param(
  [ValidateSet("test", "prod")]
  [string]$Environment = "test",

  [Parameter(Mandatory = $true)]
  [string]$TribeId,

  [string]$UserName,

  [string]$RawBucket = $env:API_CENTER_RAW_BUCKET,

  [string]$ResultsBucket = $env:ATHENA_RESULTS_BUCKET,

  [string]$Profile = $env:AWS_PROFILE,

  [string]$Region = $env:AWS_REGION,

  [long]$BytesScannedCutoffBytes = 1073741824,

  [switch]$AllowDirectUpload,

  [switch]$CreateAccessKey,

  [string]$AccessKeyOutputPath,

  [switch]$Apply,

  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

if ($Apply -and $DryRun) {
  throw "Use either -Apply or -DryRun, not both."
}

if ($TribeId -notmatch "^[a-z0-9][a-z0-9._-]*[a-z0-9]$") {
  throw "TribeId must use lowercase letters, numbers, dot, underscore, or hyphen."
}

if (-not $RawBucket) {
  $RawBucket = "api-center-raw-data"
}

if (-not $ResultsBucket) {
  $ResultsBucket = "api-center-athena-results"
}

if (-not $UserName) {
  $UserName = "api-center-tribe-$TribeId-athena"
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

$isDryRun = -not $Apply
$workgroup = "api-center-tribe-$TribeId-$Environment"
$directUploadPrefix = "direct-upload/$Environment/$TribeId/"
$topicPrefix = "topics/$Environment.tribe.$TribeId.events/"
$resultsPrefix = "athena-results/tribe/$TribeId/$Environment/"
$policyName = "ApiCenterTribe$($TribeId -replace '[^a-zA-Z0-9]', '')S3Athena$($Environment.ToUpperInvariant())Access"
$notes = @(
  "No delete permissions are granted.",
  "Raw S3 read is scoped to the tribe topic prefix only."
)

if ($AllowDirectUpload) {
  $notes += "Direct upload write/read is scoped to the dedicated tribe prefix only."
} else {
  $notes += "Direct upload write/read is not granted."
}

$plan = [ordered]@{
  mode = if ($isDryRun) { "dry-run" } else { "apply" }
  environment = $Environment
  tribe_id = $TribeId
  user_name = $UserName
  policy_name = $policyName
  region = $Region
  raw_bucket = $RawBucket
  direct_upload_prefix = if ($AllowDirectUpload) { "s3://$RawBucket/$directUploadPrefix" } else { $null }
  readable_topic_prefix = "s3://$RawBucket/$topicPrefix"
  results_bucket = $ResultsBucket
  athena_workgroup = $workgroup
  athena_results_prefix = "s3://$ResultsBucket/$resultsPrefix"
  create_access_key = [bool]$CreateAccessKey
  access_key_output_path = $AccessKeyOutputPath
  notes = $notes
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
  $json = $Value | ConvertTo-Json -Depth 20
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($file.FullName, $json, $utf8NoBom)
  $file.FullName
}

if ($isDryRun) {
  $plan | ConvertTo-Json -Depth 8
  exit 0
}

if (-not $Profile) {
  throw "AWS_PROFILE or -Profile is required when using -Apply."
}

$accountId = (Invoke-Aws -Arguments @(
  "sts", "get-caller-identity",
  "--query", "Account",
  "--output", "text",
  "--profile", $Profile
)).output | Select-Object -First 1

$policy = @{
  Version = "2012-10-17"
  Statement = @(
    @{
      Sid = "ListAthenaWorkgroupsForConsole"
      Effect = "Allow"
      Action = @("athena:ListWorkGroups")
      Resource = "*"
    },
    @{
      Sid = "RunTribeAthenaQueries"
      Effect = "Allow"
      Action = @(
        "athena:GetWorkGroup",
        "athena:StartQueryExecution",
        "athena:GetQueryExecution",
        "athena:GetQueryResults",
        "athena:ListQueryExecutions",
        "athena:StopQueryExecution"
      )
      Resource = "arn:aws:athena:$($Region):$($accountId):workgroup/$workgroup"
    },
    @{
      Sid = "ReadGlueCatalogForTribeAthena"
      Effect = "Allow"
      Action = @(
        "glue:GetDatabase",
        "glue:GetDatabases",
        "glue:GetTable",
        "glue:GetTables",
        "glue:GetPartition",
        "glue:GetPartitions"
      )
      Resource = @(
        "arn:aws:glue:$($Region):$($accountId):catalog",
        "arn:aws:glue:$($Region):$($accountId):database/api_center_raw",
        "arn:aws:glue:$($Region):$($accountId):database/bronze",
        "arn:aws:glue:$($Region):$($accountId):database/common_silver",
        "arn:aws:glue:$($Region):$($accountId):database/silver_$TribeId",
        "arn:aws:glue:$($Region):$($accountId):database/gold_$TribeId",
        "arn:aws:glue:$($Region):$($accountId):table/api_center_raw/*",
        "arn:aws:glue:$($Region):$($accountId):table/bronze/*",
        "arn:aws:glue:$($Region):$($accountId):table/common_silver/*",
        "arn:aws:glue:$($Region):$($accountId):table/silver_$TribeId/*",
        "arn:aws:glue:$($Region):$($accountId):table/gold_$TribeId/*"
      )
    },
    @{
      Sid = "ReadOwnRawTopicObjectsOnly"
      Effect = "Allow"
      Action = @("s3:GetObject")
      Resource = "arn:aws:s3:::$RawBucket/$topicPrefix*"
    },
    @{
      Sid = "ListOwnRawTopicPrefixOnly"
      Effect = "Allow"
      Action = @("s3:ListBucket")
      Resource = "arn:aws:s3:::$RawBucket"
      Condition = @{
        StringLike = @{
          "s3:prefix" = @(
            "$topicPrefix*"
          )
        }
      }
    },
    @{
      Sid = "ReadAthenaResultsBucketLocation"
      Effect = "Allow"
      Action = @("s3:GetBucketLocation")
      Resource = "arn:aws:s3:::$ResultsBucket"
    },
    @{
      Sid = "ListAthenaResultBucketMultipartUploads"
      Effect = "Allow"
      Action = @("s3:ListBucketMultipartUploads")
      Resource = "arn:aws:s3:::$ResultsBucket"
    },
    @{
      Sid = "ReadWriteOwnAthenaResultsPrefixOnly"
      Effect = "Allow"
      Action = @(
        "s3:GetObject",
        "s3:PutObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      )
      Resource = "arn:aws:s3:::$ResultsBucket/$resultsPrefix*"
    },
    @{
      Sid = "ListOwnAthenaResultsPrefixOnly"
      Effect = "Allow"
      Action = @("s3:ListBucket")
      Resource = "arn:aws:s3:::$ResultsBucket"
      Condition = @{
        StringLike = @{
          "s3:prefix" = @("$resultsPrefix*")
        }
      }
    }
  )
}

if ($AllowDirectUpload) {
  $policy.Statement += @(
    @{
      Sid = "ReadWriteOwnDirectUploadPrefixOnly"
      Effect = "Allow"
      Action = @(
        "s3:GetObject",
        "s3:PutObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      )
      Resource = "arn:aws:s3:::$RawBucket/$directUploadPrefix*"
    },
    @{
      Sid = "ListOwnDirectUploadPrefixOnly"
      Effect = "Allow"
      Action = @("s3:ListBucket")
      Resource = "arn:aws:s3:::$RawBucket"
      Condition = @{
        StringLike = @{
          "s3:prefix" = @("$directUploadPrefix*")
        }
      }
    }
  )
}

$actions = @()

& "$PSScriptRoot\provision-athena-results-controls.ps1" `
  -Environment $Environment `
  -TribeId $TribeId `
  -ResultsBucket $ResultsBucket `
  -RawBucket $RawBucket `
  -Profile $Profile `
  -Region $Region `
  -BytesScannedCutoffBytes $BytesScannedCutoffBytes `
  -Apply | Out-Null
$actions += "ensured Athena workgroup $workgroup and result prefix $resultsPrefix"

if ($AllowDirectUpload) {
  Invoke-Aws -Arguments @(
    "s3api", "put-object",
    "--bucket", $RawBucket,
    "--key", "$directUploadPrefix.keep",
    "--profile", $Profile
  ) | Out-Null
  $actions += "created placeholder object s3://$RawBucket/$directUploadPrefix.keep"
}

$existingUser = Invoke-Aws -Arguments @(
  "iam", "get-user",
  "--user-name", $UserName,
  "--profile", $Profile
) -AllowFailure

if ($existingUser.exit_code -eq 0) {
  $actions += "IAM user $UserName already exists"
} else {
  Invoke-Aws -Arguments @(
    "iam", "create-user",
    "--user-name", $UserName,
    "--tags", "Key=Application,Value=api-center", "Key=TribeId,Value=$TribeId", "Key=Environment,Value=$Environment",
    "--profile", $Profile
  ) | Out-Null
  $actions += "created IAM user $UserName"
}

$policyFile = New-TempJsonFile -Value $policy
$policyArn = "arn:aws:iam::$($accountId):policy/$policyName"
$existingPolicy = Invoke-Aws -Arguments @(
  "iam", "get-policy",
  "--policy-arn", $policyArn,
  "--profile", $Profile
) -AllowFailure

if ($existingPolicy.exit_code -eq 0) {
  $versions = (Invoke-Aws -Arguments @(
    "iam", "list-policy-versions",
    "--policy-arn", $policyArn,
    "--profile", $Profile
  )).output -join "`n" | ConvertFrom-Json

  $nonDefaultVersions = @($versions.Versions | Where-Object { -not $_.IsDefaultVersion } | Sort-Object CreateDate)
  if (@($versions.Versions).Count -ge 5 -and $nonDefaultVersions.Count -gt 0) {
    Invoke-Aws -Arguments @(
      "iam", "delete-policy-version",
      "--policy-arn", $policyArn,
      "--version-id", $nonDefaultVersions[0].VersionId,
      "--profile", $Profile
    ) | Out-Null
  }

  Invoke-Aws -Arguments @(
    "iam", "create-policy-version",
    "--policy-arn", $policyArn,
    "--policy-document", "file://$policyFile",
    "--set-as-default",
    "--profile", $Profile
  ) | Out-Null
  $actions += "updated managed policy $policyArn"
} else {
  Invoke-Aws -Arguments @(
    "iam", "create-policy",
    "--policy-name", $policyName,
    "--policy-document", "file://$policyFile",
    "--tags", "Key=Application,Value=api-center", "Key=TribeId,Value=$TribeId", "Key=Environment,Value=$Environment",
    "--profile", $Profile
  ) | Out-Null
  $actions += "created managed policy $policyArn"
}

Invoke-Aws -Arguments @(
  "iam", "attach-user-policy",
  "--user-name", $UserName,
  "--policy-arn", $policyArn,
  "--profile", $Profile
) | Out-Null
$actions += "attached managed policy $policyName"

$accessKey = $null
if ($CreateAccessKey) {
  $createdAccessKey = (Invoke-Aws -Arguments @(
    "iam", "create-access-key",
    "--user-name", $UserName,
    "--profile", $Profile
  )).output -join "`n" | ConvertFrom-Json

  if ($AccessKeyOutputPath) {
    if (Test-Path -LiteralPath $AccessKeyOutputPath) {
      throw "Access key output path already exists: $AccessKeyOutputPath"
    }

    $outputDirectory = Split-Path -Parent $AccessKeyOutputPath
    if ($outputDirectory -and -not (Test-Path -LiteralPath $outputDirectory)) {
      New-Item -ItemType Directory -Path $outputDirectory | Out-Null
    }

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText(
      $AccessKeyOutputPath,
      ($createdAccessKey | ConvertTo-Json -Depth 10),
      $utf8NoBom
    )

    $accessKey = [ordered]@{
      AccessKeyId = $createdAccessKey.AccessKey.AccessKeyId
      Status = $createdAccessKey.AccessKey.Status
      SecretAccessKeyStoredAt = $AccessKeyOutputPath
    }
  } else {
    $accessKey = $createdAccessKey
  }

  $actions += "created one IAM access key for $UserName"
}

[ordered]@{
  mode = "apply"
  environment = $Environment
  tribe_id = $TribeId
  user_name = $UserName
  policy_name = $policyName
  region = $Region
  account_id = $accountId
  direct_upload_prefix = if ($AllowDirectUpload) { "s3://$RawBucket/$directUploadPrefix" } else { $null }
  readable_topic_prefix = "s3://$RawBucket/$topicPrefix"
  athena_workgroup = $workgroup
  athena_results_prefix = "s3://$ResultsBucket/$resultsPrefix"
  actions = $actions
  access_key = $accessKey
} | ConvertTo-Json -Depth 10

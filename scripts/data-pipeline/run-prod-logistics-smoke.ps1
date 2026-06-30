param(
  [string]$EnvFile = "..\apicenter-management\.env.live",
  [string]$GcpProject = "apicenter-alpha-20260623",
  [string]$ApiCenterSecretName = "api-center-prod",
  [string]$TribeId = "logistics",
  [string]$SourceServiceId = "logistics-orders",
  [string]$TopicName = "prod.tribe.logistics.events",
  [string]$EventType = "order.created",
  [string]$SchemaVersion = "1.0.0",
  [string]$PlaintextTribeSecret,
  [string]$RuntimeEnvironment,
  [switch]$RotateSmokeSecret,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Import-DotEnvFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Env file not found: $Path"
  }

  Get-Content -LiteralPath $Path |
    Where-Object { $_ -match "^[A-Za-z_][A-Za-z0-9_]*\s*=" } |
    ForEach-Object {
      $parts = $_ -split "=", 2
      [Environment]::SetEnvironmentVariable(
        $parts[0].Trim(),
        $parts[1].Trim(" '"""),
        "Process"
      )
    }
}

function New-SmokeSecret {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Get-Sha256Hex {
  param([string]$Value)

  $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash($bytes)
    -join ($hash | ForEach-Object { $_.ToString("x2") })
  } finally {
    $sha.Dispose()
  }
}

function Invoke-JsonRequest {
  param(
    [string]$Uri,
    [string]$Method,
    [hashtable]$Headers = @{},
    [object]$Body = $null
  )

  $request = @{
    Uri = $Uri
    Method = $Method
    Headers = $Headers
    TimeoutSec = 30
    ContentType = "application/json"
  }
  if ($null -ne $Body) {
    $request.Body = $Body | ConvertTo-Json -Depth 12
  }

  try {
    Invoke-RestMethod @request
  } catch {
    $statusCode = if ($_.Exception.Response) {
      $_.Exception.Response.StatusCode.value__
    } else {
      $null
    }
    $responseBody = ""
    if ($_.Exception.Response) {
      $stream = $_.Exception.Response.GetResponseStream()
      if ($stream) {
        $reader = New-Object System.IO.StreamReader($stream)
        try {
          $responseBody = $reader.ReadToEnd()
        } finally {
          $reader.Dispose()
        }
      }
    }
    $responseSuffix = if ($responseBody) { " body=$responseBody" } else { "" }
    throw "HTTP $Method $Uri failed with $statusCode`: $($_.Exception.Message)$responseSuffix"
  }
}

function Get-ApiCenterBaseUrl {
  $value = [Environment]::GetEnvironmentVariable("APICENTER_URL", "Process")
  if (-not $value) {
    throw "APICENTER_URL is required."
  }
  $value.TrimEnd("/")
}

Import-DotEnvFile -Path $EnvFile
$baseUrl = Get-ApiCenterBaseUrl
if (-not $RuntimeEnvironment) {
  $RuntimeEnvironment = [Environment]::GetEnvironmentVariable("APICENTER_ENVIRONMENT", "Process")
}
if ($RuntimeEnvironment -ne "live") {
  throw "APICENTER_ENVIRONMENT or -RuntimeEnvironment must be live for this production smoke."
}
$secretPrefix = [Environment]::GetEnvironmentVariable("TRIBE_SECRET_GCP_PREFIX", "Process")
if (-not $secretPrefix) {
  $secretPrefix = "api-center-tribe-secret-"
}
$tribeSecretName = "$secretPrefix$TribeId-$RuntimeEnvironment"
$smokeId = "prod-logistics-smoke-$(Get-Date -Format 'yyyyMMddHHmmss')"

$apiCenterPayload = gcloud secrets versions access latest `
  --secret $ApiCenterSecretName `
  --project $GcpProject | ConvertFrom-Json
$platformAdminSecret = $apiCenterPayload.PLATFORM_ADMIN_SECRET
if (-not $platformAdminSecret) {
  throw "PLATFORM_ADMIN_SECRET is missing from $ApiCenterSecretName."
}

$secretExists = $true
try {
  $describeOutput = gcloud secrets describe $tribeSecretName `
    --project $GcpProject `
    --format json 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $describeOutput) {
    $secretExists = $false
  }
} catch {
  if ($_.Exception.Message -match "NOT_FOUND") {
    $secretExists = $false
  } else {
    throw
  }
}

$generatedSmokeSecret = $false
if (-not $PlaintextTribeSecret) {
  if ($secretExists -and -not $RotateSmokeSecret) {
    throw "$tribeSecretName already exists. Pass -PlaintextTribeSecret or -RotateSmokeSecret."
  }
  $PlaintextTribeSecret = New-SmokeSecret
  $generatedSmokeSecret = $true
}

$secretCreated = $false
$secretVersionAdded = $false
if ((-not $secretExists -or $RotateSmokeSecret) -and -not $DryRun) {
  $hash = Get-Sha256Hex -Value $PlaintextTribeSecret
  $payload = @{
    tribeId = $TribeId
    environment = $RuntimeEnvironment
    status = "active"
    secretHashSha256 = $hash
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    createdBy = "codex-prod-logistics-smoke"
    purpose = "prod logistics data-pipeline smoke"
  } | ConvertTo-Json -Depth 8

  $tempFile = New-TemporaryFile
  try {
    [System.IO.File]::WriteAllText(
      $tempFile.FullName,
      $payload,
      [System.Text.UTF8Encoding]::new($false)
    )
    if ($secretExists) {
      gcloud secrets versions add $tribeSecretName `
        --project $GcpProject `
        --data-file $tempFile.FullName | Out-Null
      $secretVersionAdded = $true
    } else {
      gcloud secrets create $tribeSecretName `
        --project $GcpProject `
        --replication-policy automatic `
        --data-file $tempFile.FullName | Out-Null
      $secretCreated = $true
    }
  } finally {
    if (Test-Path -LiteralPath $tempFile.FullName) {
      Remove-Item -LiteralPath $tempFile.FullName -Force
    }
  }
}

$ownerManifest = @{
  serviceId = $TribeId
  ownerTribeId = $TribeId
  name = "Logistics Tribe"
  baseUrl = "https://logistics.example.invalid"
  requiredScopes = @("logistics:read")
  exposes = @("/health")
  consumes = @("kafka")
  serviceType = "tribe"
  version = "1.0.0"
  ownerTeam = "logistics-platform"
  contact = "logistics-platform@example.invalid"
}
$sourceManifest = @{
  serviceId = $SourceServiceId
  ownerTribeId = $TribeId
  name = "Logistics Orders"
  baseUrl = "https://logistics-orders.example.invalid"
  requiredScopes = @("orders:read")
  exposes = @("/orders", "/health")
  consumes = @()
  serviceType = "tribe"
  version = "1.0.0"
  ownerTeam = "logistics-platform"
  contact = "logistics-platform@example.invalid"
}

if ($DryRun) {
  [ordered]@{
    dry_run = $true
    base_url = $baseUrl
    tribe_secret_name = $tribeSecretName
    tribe_secret_exists = $secretExists
    would_generate_smoke_secret = $generatedSmokeSecret
    would_register = @($TribeId, $SourceServiceId)
    would_publish_topic = $TopicName
    event_type = $EventType
    schema_version = $SchemaVersion
  } | ConvertTo-Json -Depth 6
  exit 0
}

$adminHeaders = @{ "X-Platform-Secret" = $platformAdminSecret }
Invoke-JsonRequest -Uri "$baseUrl/api/v1/registry/register" -Method "POST" -Headers $adminHeaders -Body $ownerManifest | Out-Null
Invoke-JsonRequest -Uri "$baseUrl/api/v1/registry/register" -Method "POST" -Headers $adminHeaders -Body $sourceManifest | Out-Null

$tokenResponse = Invoke-JsonRequest `
  -Uri "$baseUrl/api/v1/auth/token" `
  -Method "POST" `
  -Body @{
    tribeId = $TribeId
    secret = $PlaintextTribeSecret
    environment = $RuntimeEnvironment
  }
$accessToken = $tokenResponse.data.accessToken
if (-not $accessToken) {
  throw "Token response did not include data.accessToken."
}

$publishResponse = Invoke-JsonRequest `
  -Uri "$baseUrl/api/v1/kafka/publish" `
  -Method "POST" `
  -Headers @{ Authorization = "Bearer $accessToken" } `
  -Body @{
    topic = $TopicName
    key = $smokeId
    eventType = $EventType
    schemaVersion = $SchemaVersion
    sourceServiceId = $SourceServiceId
    payload = @{
      orderId = $smokeId
      smokeId = $smokeId
      ownerTribeId = $TribeId
      sourceServiceId = $SourceServiceId
      occurredAt = (Get-Date).ToUniversalTime().ToString("o")
    }
  }

[ordered]@{
  dry_run = $false
  smoke_id = $smokeId
  base_url = $baseUrl
  tribe_secret_name = $tribeSecretName
  tribe_secret_created = $secretCreated
  tribe_secret_version_added = $secretVersionAdded
  generated_smoke_secret = $generatedSmokeSecret
  registered_services = @($TribeId, $SourceServiceId)
  topic = $publishResponse.data.topic
  event_type = $publishResponse.data.eventType
  accepted = $publishResponse.data.accepted
  schema_validation_status = $publishResponse.data.schemaValidationStatus
  schema_registry_version = $publishResponse.data.schemaRegistryVersion
} | ConvertTo-Json -Depth 6

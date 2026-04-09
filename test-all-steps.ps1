#Requires -Version 5.0

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "API CENTER SANDBOX - COMPREHENSIVE TEST SUITE" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$failedChecks = @()

function Test-LogisticsHealth {
    $result = docker exec logistics-service wget --no-verbose --tries=1 -O - http://127.0.0.1:4000/health 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "logistics-service health check failed: $result"
    }

    return $result
}

function Write-StepSummary {
    param(
        [int]$Step,
        [string]$Label
    )

    $stepPrefix = "Step ${Step}:"
    $hasFailure = @($failedChecks | Where-Object { $_ -like "$stepPrefix*" }).Count -gt 0

    if ($hasFailure) {
        Write-Host "  [FAIL] Step ${Step}: $Label" -ForegroundColor Red
    } else {
        Write-Host "  [PASS] Step ${Step}: $Label" -ForegroundColor Green
    }
}

# STEP 1: Baseline Health Checks
Write-Host "STEP 1: BASELINE HEALTH CHECKS" -ForegroundColor Green
Write-Host "---" -ForegroundColor Gray
try {
    $gateway = Invoke-RestMethod -Uri 'http://localhost:3000/api/v1/health/live' -Method Get
    Write-Host "[PASS] Gateway (api-center): UP" -ForegroundColor Green
    Write-Host "  Status: $($gateway.status)" -ForegroundColor Gray
} catch {
    Write-Host "[FAIL] Gateway: DOWN" -ForegroundColor Red
    $failedChecks += 'Step 1: Gateway health check'
}

try {
    $demand = Invoke-RestMethod -Uri 'http://localhost:4100/health' -Method Get
    Write-Host "[PASS] Demand Service: UP" -ForegroundColor Green
    Write-Host "  Service: $($demand.service)" -ForegroundColor Gray
} catch {
    Write-Host "[FAIL] Demand Service: DOWN" -ForegroundColor Red
    $failedChecks += 'Step 1: Demand service health check'
}

try {
    [void](Test-LogisticsHealth)
    Write-Host "[PASS] Logistics Service: UP" -ForegroundColor Green
} catch {
    Write-Host "[FAIL] Logistics Service: DOWN" -ForegroundColor Red
    $failedChecks += 'Step 1: Logistics service health check'
}

# STEP 2: Service Registration Bootstrap
Write-Host "`nSTEP 2: SERVICE REGISTRATION (sandbox bootstrap)" -ForegroundColor Green
Write-Host "---" -ForegroundColor Gray
$platformSecret = if ([string]::IsNullOrWhiteSpace($env:PLATFORM_ADMIN_SECRET)) {
    if (Test-Path '.env') {
        $envLine = Get-Content '.env' | Where-Object { $_ -match '^\s*PLATFORM_ADMIN_SECRET\s*=' } | Select-Object -First 1
        if ($envLine) {
            ($envLine -split '=', 2)[1].Trim()
        } else {
            'change-me-in-production'
        }
    } else {
        'change-me-in-production'
    }
} else {
    $env:PLATFORM_ADMIN_SECRET
}

$manifests = @(
    @{ ServiceId = 'logistics-service'; Path = 'examples/logistics-manifest.json' },
    @{ ServiceId = 'demand-service'; Path = 'examples/demand-manifest.json' }
)

$registrationSucceeded = $true

foreach ($manifest in $manifests) {
    try {
        $manifestBody = Get-Content -Raw -Path $manifest.Path
        $registerResult = Invoke-RestMethod `
            -Uri 'http://localhost:3000/api/v1/registry/register' `
            -Method Post `
            -Headers @{ 'Content-Type' = 'application/json'; 'X-Platform-Secret' = $platformSecret } `
            -Body $manifestBody

        Write-Host "[PASS] Registered $($registerResult.data.serviceId)" -ForegroundColor Green
    } catch {
        Write-Host "[FAIL] Registration failed for $($manifest.ServiceId): $_" -ForegroundColor Red
        $registrationSucceeded = $false
        $failedChecks += "Step 2: Registration failed for $($manifest.ServiceId)"
    }
}

Write-Host "Waiting for registry propagation across gateway instances..." -ForegroundColor Cyan
$probeBody = @{ tribeId = 'demand-service'; secret = 'demand-secret' } | ConvertTo-Json
$successStreak = 0
$requiredStreak = 6

for ($attempt = 1; $attempt -le 30; $attempt++) {
    try {
        Invoke-RestMethod `
            -Uri 'http://localhost:3000/api/v1/auth/token' `
            -Method Post `
            -ContentType 'application/json' `
            -Body $probeBody `
            -ErrorAction Stop | Out-Null

        $successStreak++
        Write-Host "  Probe $attempt : [200 OK] (streak $successStreak/$requiredStreak)" -ForegroundColor Gray

        if ($successStreak -ge $requiredStreak) {
            Write-Host "[PASS] Registry propagation stabilized across gateway pool" -ForegroundColor Green
            break
        }
    } catch {
        $statusCode = if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $_.Exception.Response.StatusCode.value__
        } else {
            'ERR'
        }

        $successStreak = 0
        Write-Host "  Probe $attempt : [$statusCode] waiting..." -ForegroundColor Yellow
    }

    Start-Sleep -Seconds 2
}

if ($successStreak -lt $requiredStreak) {
    Write-Host "[FAIL] Registry propagation did not fully stabilize before smoke tests" -ForegroundColor Red
    $failedChecks += 'Step 2: Registry propagation did not stabilize'
}

if (-not $registrationSucceeded) {
    Write-Host "[FAIL] One or more registrations failed during bootstrap" -ForegroundColor Red
}

# STEP 3: Smoke Test - Front-door flow
Write-Host "`nSTEP 3: SMOKE TEST - Front-door flow" -ForegroundColor Green
Write-Host "---" -ForegroundColor Gray
try {
    $smoke = Invoke-RestMethod -Uri 'http://localhost:4100/demand/SMOKE-001' -Method Get
    Write-Host "[PASS] Front-door pattern: WORKING" -ForegroundColor Green
    Write-Host "  Shipment ID: $($smoke.shipment.shipmentId)" -ForegroundColor Gray
    Write-Host "  Status: $($smoke.shipment.status)" -ForegroundColor Gray
    Write-Host "  Handled By Instance: $($smoke.shipment.handledBy)" -ForegroundColor Gray
    Write-Host "  Correlation ID: $($smoke.correlationId)" -ForegroundColor Gray
} catch {
    Write-Host "[FAIL] Front-door failed: $_" -ForegroundColor Red
    $failedChecks += 'Step 3: Front-door smoke test failed'
}

# STEP 4: Correlation ID Propagation
Write-Host "`nSTEP 4: CORRELATION ID PROPAGATION" -ForegroundColor Green
Write-Host "---" -ForegroundColor Gray
$allMatch = $true
for ($i = 1; $i -le 3; $i++) {
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:4100/demand/CORR-$i" -Method Get
        $demandId = $response.correlationId
        $logisticsId = $response.shipment.correlationId
        $match = ($demandId -eq $logisticsId)
        
        if (-not $match) {
            $allMatch = $false
        }
        
        $indicator = if ($match) { "[PASS]" } else { "[FAIL]" }
        $color = if ($match) { "Green" } else { "Red" }
        Write-Host "$indicator Request $i : Demand=$($demandId.Substring(0,8))... | Logistics=$($logisticsId.Substring(0,8))... | Match=$match" -ForegroundColor $color
    } catch {
        Write-Host "[FAIL] Request $i failed: $_" -ForegroundColor Red
        $allMatch = $false
    }
}
$summary = if ($allMatch) { "[PASS] ALL CORRELATED" } else { "[FAIL] SOME MISMATCHED" }
Write-Host $summary -ForegroundColor $(if ($allMatch) { "Green" } else { "Red" })
if (-not $allMatch) {
    $failedChecks += 'Step 4: Correlation ID propagation mismatch'
}

# STEP 5: Rate Limiting
Write-Host "`nSTEP 5: RATE LIMITING (5 requests per minute)" -ForegroundColor Green
Write-Host "---" -ForegroundColor Gray
Write-Host "Sending 6 rapid requests..." -ForegroundColor Cyan
$rateLimitHit = $false
$successCount = 0

for ($i = 1; $i -le 6; $i++) {
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:4100/demand/RATE-$i" -Method Get -ErrorAction Stop
        $successCount++
        Write-Host "  Request $i : [200 OK]" -ForegroundColor Green
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode -eq 429) {
            $rateLimitHit = $true
            Write-Host "  Request $i : [429 TOO MANY REQUESTS]" -ForegroundColor Yellow
        } else {
            Write-Host "  Request $i : [$statusCode]" -ForegroundColor Yellow
        }
    }
    Start-Sleep -Milliseconds 100
}
$result = if ($rateLimitHit) { "[PASS] Rate limit enforced" } else { "[WARNING] No 429 observed" }
Write-Host $result -ForegroundColor $(if ($rateLimitHit) { "Green" } else { "Yellow" })

# STEP 6: Round-robin Load Balancing
Write-Host "`nSTEP 6: ROUND-ROBIN LOAD BALANCING (12 requests)" -ForegroundColor Green
Write-Host "---" -ForegroundColor Gray
Write-Host "Distributing requests..." -ForegroundColor Cyan
$logCaptureSince = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')

for ($i = 1; $i -le 12; $i++) {
    try {
        Invoke-RestMethod -Uri "http://localhost:4100/demand/LB-RR-$i" -Method Get | Out-Null
        Write-Host "  Request $i : OK" -ForegroundColor Cyan
    } catch {
        Write-Host "  Request $i : FAILED" -ForegroundColor Red
    }
    Start-Sleep -Milliseconds 50
}

$logLines = docker logs nginx-lb --since $logCaptureSince 2>&1
$entries = @()
foreach ($line in $logLines) {
    if ($line -match 'LB-RR-') {
        try {
            $jsonStart = $line.IndexOf('{')
            if ($jsonStart -ge 0) {
                $entries += ($line.Substring($jsonStart) | ConvertFrom-Json)
            }
        } catch {
            # Ignore malformed/non-JSON lines
        }
    }
}

$distribution = $entries | Group-Object upstream | Sort-Object Name
$backendCount = @($distribution).Count
$totalRequests = ($distribution | Measure-Object -Property Count -Sum).Sum
if ($null -eq $totalRequests) {
    $totalRequests = 0
}

Write-Host "`nDistribution Summary:" -ForegroundColor Green
foreach ($bucket in $distribution) {
    Write-Host "  $($bucket.Name) : $($bucket.Count) requests" -ForegroundColor Gray
}

if ($backendCount -ge 2) {
    Write-Host "[PASS] Load balanced across $backendCount upstreams (Total: $totalRequests requests)" -ForegroundColor Green
} else {
    Write-Host "[WARNING] Only $backendCount upstream observed (Total: $totalRequests requests)" -ForegroundColor Yellow
    $failedChecks += 'Step 6: Load balancing did not spread across at least 2 upstreams'
}

# STEP 7: Circuit Breaker
Write-Host "`nSTEP 7: CIRCUIT BREAKER VALIDATION" -ForegroundColor Green
Write-Host "---" -ForegroundColor Gray
Write-Host "Stopping logistics service..." -ForegroundColor Cyan

$logisticsStopped = $false
$restartAttempted = $false

try {
    docker compose stop logistics-service 2>&1 | Out-Null
    $logisticsStopped = $true
    Start-Sleep -Seconds 2
    
    Write-Host "Testing requests with logistics down..." -ForegroundColor Cyan
    $expectedFailureStatuses = @(500, 502, 503, 504)
    $expectedFailures = 0
    $unexpectedFailures = @()

    for ($i = 1; $i -le 3; $i++) {
        try {
            $response = Invoke-RestMethod -Uri "http://localhost:4100/demand/CB-FAIL-$i" -Method Get -ErrorAction Stop
            Write-Host "  Request $i : [200 OK - unexpected]" -ForegroundColor Yellow
            $unexpectedFailures += "request $i returned 200"
        } catch {
            $statusCode = if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
                $_.Exception.Response.StatusCode.value__
            } else {
                0
            }

            if ($expectedFailureStatuses -contains $statusCode) {
                $expectedFailures++
                Write-Host "  Request $i : [FAILED - expected status $statusCode]" -ForegroundColor Green
            } else {
                $unexpectedFailures += "request $i failed with unexpected status $statusCode"
                Write-Host "  Request $i : [FAILED - unexpected status $statusCode]" -ForegroundColor Yellow
            }
        }
    }

    if ($expectedFailures -eq 3 -and $unexpectedFailures.Count -eq 0) {
        Write-Host "[PASS] Circuit breaker triggered expected upstream failures" -ForegroundColor Green
    } else {
        $failedChecks += 'Step 7: Circuit breaker failure signature mismatch'
        Write-Host "[FAIL] Circuit breaker failure signature mismatch" -ForegroundColor Red
        $unexpectedFailures | ForEach-Object {
            Write-Host "  - $_" -ForegroundColor Red
        }
    }
} catch {
    Write-Host "[FAIL] Circuit breaker test error: $_" -ForegroundColor Red
    $failedChecks += 'Step 7: Circuit breaker test execution error'
} finally {
    if ($logisticsStopped) {
        Write-Host "Restarting logistics service..." -ForegroundColor Cyan
        try {
            docker compose start logistics-service 2>&1 | Out-Null
            $restartAttempted = $true
        } catch {
            Write-Host "[FAIL] Failed to restart logistics service: $_" -ForegroundColor Red
            $failedChecks += 'Step 7: Logistics restart command failed'
        }

        if ($restartAttempted) {
            Start-Sleep -Seconds 2

            $recovered = $false
            for ($attempt = 1; $attempt -le 10; $attempt++) {
                try {
                    [void](Test-LogisticsHealth)
                    $recovered = $true
                    break
                } catch {
                    Start-Sleep -Seconds 2
                }
            }

            if ($recovered) {
                Write-Host "[PASS] Logistics recovered successfully" -ForegroundColor Green
            } else {
                Write-Host "[FAIL] Logistics failed to recover after restart" -ForegroundColor Red
                $failedChecks += 'Step 7: Logistics recovery check failed after restart'
            }
        }
    }
}

# STEP 8: Kafka Audit Topic
Write-Host "`nSTEP 8: KAFKA AUDIT TOPIC" -ForegroundColor Green
Write-Host "---" -ForegroundColor Gray
try {
    Write-Host "Checking Kafka topics..." -ForegroundColor Cyan
    $topics = docker exec kafka kafka-topics --list --bootstrap-server localhost:9092 2>&1
    if ($topics -match "api-center\.audit\.log") {
        Write-Host "[PASS] Audit topic exists: api-center.audit.log" -ForegroundColor Green
        docker exec kafka kafka-topics --describe --bootstrap-server localhost:9092 --topic api-center.audit.log 2>&1 | ForEach-Object {
            if ($_ -match "replicas|isr|lever") {
                Write-Host "  $_" -ForegroundColor Gray
            }
        }
    } else {
        Write-Host "[INFO] Available topics: $topics" -ForegroundColor Yellow
        $failedChecks += 'Step 8: Kafka audit topic not found'
    }
} catch {
    Write-Host "[WARNING] Kafka inspection failed: $_" -ForegroundColor Yellow
    $failedChecks += 'Step 8: Kafka audit topic inspection failed'
}

# STEP 9: Geo Context via SDK Helpers (through demand-service)
Write-Host "`nSTEP 9: GEOLOCATION + GEOFENCING + GEOTAGGING" -ForegroundColor Green
Write-Host "---" -ForegroundColor Gray
try {
    $geo = Invoke-RestMethod -Uri 'http://localhost:4100/demand/GEO-001/geo-context?ip=8.8.8.8' -Method Get
    $lat = $geo.geoContext.geolocation.latitude
    $lng = $geo.geoContext.geolocation.longitude
    $inside = $geo.geoContext.geofencing.inside
    $tagCount = @($geo.geoContext.geotagging.tags).Count

    Write-Host "[PASS] Geo context flow: WORKING" -ForegroundColor Green
    Write-Host "  Lat/Lng: $lat, $lng" -ForegroundColor Gray
    Write-Host "  Inside geofence: $inside" -ForegroundColor Gray
    Write-Host "  Resolved tags: $tagCount" -ForegroundColor Gray
} catch {
    Write-Host "[FAIL] Geo context flow failed: $_" -ForegroundColor Red
    $failedChecks += 'Step 9: Geo context flow failed'
}

# STEP 10: Kafka publish via SDK Helpers (through demand-service)
Write-Host "`nSTEP 10: KAFKA PRODUCE (TENANT TOPIC)" -ForegroundColor Green
Write-Host "---" -ForegroundColor Gray
try {
    $publishBody = @{ 
        topicSuffix = 'events'
        eventType = 'demand.test.event'
        metadata = @{ test = 'sandbox'; source = 'test-all-steps.ps1' }
    } | ConvertTo-Json -Depth 5

    $publish = Invoke-RestMethod -Uri 'http://localhost:4100/demand/GEO-001/kafka-publish' -Method Post -ContentType 'application/json' -Body $publishBody

    Write-Host "[PASS] Kafka publish flow: WORKING" -ForegroundColor Green
    Write-Host "  Cluster: $($publish.clusterId)" -ForegroundColor Gray
    Write-Host "  Topic:   $($publish.topic)" -ForegroundColor Gray
    Write-Host "  Correlation ID: $($publish.correlationId)" -ForegroundColor Gray
} catch {
    Write-Host "[FAIL] Kafka publish flow failed: $_" -ForegroundColor Red
    $failedChecks += 'Step 10: Kafka produce flow failed'
}

# FINAL SUMMARY
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "TEST SUITE COMPLETE" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "VALIDATION SUMMARY:" -ForegroundColor Green
Write-StepSummary -Step 1 -Label 'Baseline health checks'
Write-StepSummary -Step 2 -Label 'Service registration bootstrap'
Write-StepSummary -Step 3 -Label 'Smoke test (front-door)'
Write-StepSummary -Step 4 -Label 'Correlation ID propagation'
Write-StepSummary -Step 5 -Label 'Rate limiting'
Write-StepSummary -Step 6 -Label 'Round-robin load balancing'
Write-StepSummary -Step 7 -Label 'Circuit breaker'
Write-StepSummary -Step 8 -Label 'Kafka audit topics'
Write-StepSummary -Step 9 -Label 'Geo context flow'
Write-StepSummary -Step 10 -Label 'Kafka produce flow'

if ($failedChecks.Count -gt 0) {
    Write-Host "`nFAILED CHECKS:" -ForegroundColor Red
    $failedChecks | Select-Object -Unique | ForEach-Object {
        Write-Host "  - $_" -ForegroundColor Red
    }

    Write-Host "`nSandbox validation completed with failures." -ForegroundColor Red
    exit 1
}

Write-Host "`nAll core features validated. Sandbox is operational." -ForegroundColor Green

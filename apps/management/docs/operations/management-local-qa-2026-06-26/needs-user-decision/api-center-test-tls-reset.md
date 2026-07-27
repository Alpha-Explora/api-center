# User Decision - API Center Test TLS Reset

## Status

Decision required before claiming the test deployment is healthy.

## Evidence

- Management is configured to call `https://api-center-test.itsandbox.site`.
- DNS resolves `api-center-test.itsandbox.site` to `34.8.14.214`.
- TCP port 443 is reachable.
- HTTPS requests fail during TLS/connection setup:
  - Node fetch: `ECONNRESET` / `fetch failed`.
  - curl: Schannel TLS handshake receive failure.
- Local Management page routes return HTTP 200, so this is not a local Next.js routing issue.
- Source-backed Management API routes return 504 or 500 because the test API Center upstream cannot be reached.
- The API responses now include `meta.sourceMetadata`, so the degraded source is visible to Management and route smoke checks.

## Recommended Checks

- Inspect the GKE test `ManagedCertificate` for `api-center-test.itsandbox.site` and confirm it is active.
- Inspect the test Ingress host and SNI configuration for `api-center-test.itsandbox.site`.
- Confirm the DNS A record still points to the current test load balancer IP.
- Confirm the static IP name `api-center-test-ip` is attached to the intended test ingress.
- Reapply or roll out the test GKE overlay if the certificate, ingress, or IP binding drifted.
- Do not remove existing services while fixing this; this is an availability/configuration issue, not a cleanup instruction.

## Acceptance Criteria

- `https://api-center-test.itsandbox.site/api/v1/health/ready` returns a normal API Center response over HTTPS.
- Management readiness no longer shows registry/API Center unavailable for the test environment.
- Source-backed Management local API routes return live data or intentional empty durable responses instead of upstream fetch failures.

# API Center Management UI QA Checklist

Last updated: 2026-05-14

Use this after UI or workflow changes. The console is still local/private, so
checks focus on operator flow, secret safety, and destructive-action guardrails.

## Desktop And Mobile Navigation

- Open `/`.
- Confirm sidebar groups are visible on desktop:
  - Operate
  - Registry
  - Shared services
  - Setup
- Resize to mobile width.
- Confirm the hamburger opens navigation.
- Confirm nested routes keep the correct active state:
  - `/tribes/<service-id>`
  - `/shared-services/setup`

## Readiness

- Open `/readiness`.
- Confirm API Center base URL and platform secret checks render.
- Confirm failures are shown as setup-required or action-failed states, not raw
  stack traces.

## Register Smoke Tribe

- Open `/tribes/new`.
- Apply the smoke preset.
- Register `smoke-tribe`.
- Confirm the detail page opens after registration.

## Service Detail Sections

- Open `/tribes/<service-id>`.
- Confirm the visible sections are:
  - Overview
  - Onboarding
  - Observability
  - Lifecycle
  - Developer tools
- Open `/tribes/<service-id>?section=onboarding`.
- Confirm the onboarding tab is selected.
- Open `/tribes/<service-id>?section=observability`.
- Confirm the observability tab is selected.

## Secret Safety

- In the Onboarding tab, confirm the tribe secret card renders.
- Generate a plaintext secret.
- Confirm plaintext appears only in the local UI and the card says Secret
  Manager receives only the hash.
- Confirm the provision action is disabled until a hash exists.

## Confluent Provisioning

- In the Onboarding tab, confirm the Confluent provisioning card renders.
- Confirm "Provision topic" and "Add to S3 sink" are separate actions.
- Confirm S3 sink inclusion does not imply topic deletion or historical S3
  deletion.

## Lifecycle Guardrails

- Open `/tribes/<service-id>?section=lifecycle`.
- Confirm deprovisioning is separate from registry deregistration.
- Confirm destructive actions require typing the exact service ID.
- Confirm deregistration copy says external resources are not deleted.

## Smoke Tests

- Open `/smoke-tests?tribeId=<service-id>`.
- Confirm token request is at the top.
- Confirm safe checks are visible first.
- Confirm provider-impacting checks are inside an expandable section.
- Confirm provider-impacting checks stay disabled until the explicit checkbox is
  checked.

## Shared-Service Catalog

- Open `/shared-services`.
- Confirm each shared service shows:
  - registered or not registered
  - owner/team if registered
  - health path if registered
  - required secret signal
  - register/update or detail action

## Shared Usage Matrix

- Open `/shared-services/usage`.
- Change the time window.
- Confirm declared usage and runtime usage remain aligned and do not shift
  layout.

## Alerts To Audit Handoff

- Open `/alerts`.
- Confirm each alert has direct action links.
- Open an audit action link.
- Confirm `/audit?serviceId=<service-id>` pre-fills the service filter.

## Manifest Tools

- Open `/manifest-tools`.
- Confirm registry JSON can be copied and downloaded.
- Paste a manifest.
- Confirm import is disabled before dry-run validation.
- Confirm dry run shows create/update counts.




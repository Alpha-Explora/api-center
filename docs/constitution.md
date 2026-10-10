---
title: Documentation maintenance rules
status: canonical
authority: normative
owner: platform-maintainers
audience: [maintainers, engineers, agents]
last_verified: "2026-10-10"
verification: repository
sources: [AGENTS.md, scripts/check-documentation.mjs, apps/docs/content/guides.json]
---
# Documentation maintenance rules

APICenter maintains internal repository knowledge and a separately curated consumer documentation site. The internal bundle starts at [the index](index.md). The public site publishes only registered guides and public payment/event contracts.

## Authority

1. [AGENTS.md](../AGENTS.md) defines repository workflow and boundaries. `CLAUDE.md` points to it.
2. This document defines documentation ownership, evidence, and maintenance.
3. [Current architecture](architecture/current-architecture.md), [payment ownership](payments-platform-current.md), accepted [ADRs](adr/index.md), and the [public contracts](../contracts/public/apicenter.openapi.yaml) define their respective scope. Runtime behavior must match the contracts; a discrepancy requires a fix or explicit contract migration.
4. Operator runbooks describe procedures. Recorded deployments and test results prove only the stated revision, date, and environment.
5. [Capability evidence](product/capability-evidence.md) tracks documentation coverage and validation limits.
6. Working plans and historical evidence provide context. They do not override maintained rules or prove delivery.

Fix conflicting lower-authority prose in the same change. Architecture belongs in the architecture record or an ADR; consumer instructions belong in public guides; provider credentials never belong in either.

## Metadata

Maintained internal concept documents use YAML frontmatter with `title`, `status`, `authority`, `owner`, `audience`, `last_verified`, `verification`, and `sources`.

- Status is `canonical` for a maintained source of truth, `active` for work in progress, or `reference` for historical material.
- Authority is `normative`, `informative`, `operational`, or `reference`. Authority and status have different meanings.
- Owners name the maintaining role. `platform-maintainers` means the repository maintainers; operational documents use `platform-operators`. PR authors must identify changes and request appropriate review. These labels do not claim configured CODEOWNERS enforcement.
- `last_verified` is an ISO date or `unverified`. `verification` is `repository`, `runtime`, or `unverified`. A repository audit covers paths, links, and documentation structure. It does not refresh historical test results or deployment state.
- Sources are existing repository-relative files or directories. Keep the source list focused on the authority for the document.

Directory indexes and change logs are navigation/history rather than concept documents and do not need this metadata. Public guides use consumer-facing `title` and `description`; internal metadata must not be copied into consumer flows.

## Update and retirement

Update the affected contract, guide, runbook, or architecture record in the same PR as the behavior it documents. Record user-visible changes in [CHANGELOG.md](../CHANGELOG.md) and documentation-bundle changes in [log.md](log.md).

Keep the [working-document register](superpowers/plans/README.md) accurate. Promote durable decisions and validated procedures out of completed plans, then remove those plans and their pointers. Git history preserves them. Retain incomplete work with explicit verification gaps; do not infer completion from age or checked boxes. Accepted ADRs remain as decision records, with a new ADR superseding a changed decision.

## Public references and verification

- `apps/docs/content/guides.json` defines guide membership, sections, and aliases. Native MDX frontmatter provides headings. Every guide file has exactly one canonical registration.
- Endpoint parameters, authentication, response schemas, examples, and errors come from the public OpenAPI document. Presentation titles and grouping may format those facts without adding HTTP behavior.
- Shared services currently have authored guides, not a complete downloadable public OpenAPI contract. Old shared-reference bookmarks link to those guides. Do not invent a schema or endpoint to fill a reference gap.
- Gateway Swagger describes a separately generated runtime/control-plane view. It is not the source for the curated consumer reference.
- `npm run check:documentation` checks links, sources, internal metadata, guide membership, aliases, and public route targets. `npm run test:documentation` exercises the checker and contract rendering. `npm run docs:build && npm run docs:test` checks exported pages and links.
- The lightweight PR workflow runs these checks for relevant changes. Expensive full CI and release artifact publication remain manually triggered. A build artifact is not proof of deployment or provider behavior.

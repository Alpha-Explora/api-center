# API Center Management Command Center Redesign Design

Date: 2026-06-14
Status: Approved design direction, pending user review of written spec
Scope: `apicenter-management` UI and information architecture

## Purpose

Redesign API Center Management into a command center that helps users answer four questions quickly:

1. What is unhealthy or risky right now?
2. Which service, tribe, pipeline, or dependency is affected?
3. What is the safest next action?
4. What evidence proves the action worked?

The redesign keeps the current product identity and technical foundation, but changes how information is organized and presented. The app should feel like a mature operational workspace, not a decorative dashboard and not a generic CRUD console.

## Non-Goals

- Do not remove existing routes in the first redesign pass.
- Do not introduce separate audience-specific modes.
- Do not replace the current mint/black API Center identity.
- Do not move full workflows into dashboard cards or the overview detail rail.
- Do not redesign backend APIs as part of the UI design spec.

## Visual Identity

The visual identity should be mature command center:

- Mint and black remain the signature colors.
- Dark teal/mint gradients are reserved for the main platform health band and major status moments.
- Most operational surfaces stay white or light gray with restrained borders.
- Amber and red are reserved for real risk.
- Cards are flat, dense, and purposeful.
- Every visual element should communicate status, impact, action, or evidence.

Avoid decorative patterns that do not support operational understanding.

## Product Language

Use product objects and workflow states rather than audience labels.

Approved labels:

- Platform health
- Action queue
- Evidence
- Selected service
- Readiness
- Issues
- Impact
- Owner
- Action

Avoid audience-role labels for page names or mode names.

The app can serve different audiences through layering, but the UI language should stay neutral and product-focused.

## Information Architecture

The approved sidebar structure is:

```text
Command
- Overview
- Issues
- Readiness

Services
- Registry
- Requests
- Dependencies
- Marketplace

Operations
- Quotas
- Reliability
- Pipeline
- Cost

Governance
- Compliance
- Audit
- Operational Trust
- Promotions

Tools
- Manifest tools
- Smoke tests
- Settings
```

Rules:

- Keep direct routes for existing pages during the redesign.
- Rename visible navigation to match the approved structure.
- Cross-link advanced tools from workflows instead of making every tool feel equally important.
- Preserve active-state behavior for nested routes such as service detail, shared services, and workflow drill-ins.

## Overview Page

The Overview page is the primary command surface.

Structure:

1. Platform health band
2. Severity-first Action queue
3. Persistent detail rail on desktop
4. Slide-over detail drawer on mobile

### Platform Health Band

The top band should provide a fast read of the platform state.

Include:

- Environment
- Overall platform posture
- Service count
- Active issues
- Readiness
- Quota risk
- Pipeline state
- Last checked timestamp
- Primary action to review the queue

The band should be visually strong but compact. It should not push the queue out of the first useful viewport.

### Action Queue

The Action queue is the primary daily-use object on the dashboard.

Default sort:

```text
severity -> impact -> time waiting
```

Severity levels:

- Critical
- High
- Medium
- Info

Domain filters remain available:

- Runtime
- Registry
- Quotas
- Pipeline
- Governance

Each queue item should show:

- Severity
- Issue title
- Domain
- Impact
- Owner
- Time waiting
- Primary action

Selecting a row updates the detail rail. It should not force navigation.

### Detail Rail

Desktop: persistent right rail.

Mobile: slide-over drawer opened after selecting a queue item.

The rail is for decision support only.

Include:

- Selected issue
- Affected service or services
- Evidence
- Next action
- Links to full drill-in pages

Do not put full workflows in the rail. Full workflows belong on drill-in pages.

## Service Detail

Service Detail is the primary drill-in object.

This avoids fragmenting work across separate issue-type pages. Runtime, registry, quota, pipeline, and governance issues all attach back to services, so the service remains the right center of gravity.

Approved sections:

```text
Summary
Health
Dependencies
Quotas
Pipeline
Governance
Evidence
Actions
```

Desktop navigation:

- Use left-side section navigation.
- Keep it sticky where practical.
- Keep the service identity and status summary at the top.

Mobile navigation:

- Use a compact section switcher.
- Show the most common sections first.
- Use a More control for the full section list.

### Service Detail Content Rules

Summary:

- Current issue
- Service identity
- Owner
- Consumers
- Latest evidence
- Recommended next action

Health:

- Gateway/proxy state
- Token/auth state
- Readiness state
- Contract/smoke state

Dependencies:

- Consumed services
- Consumers
- Broken edges
- Owner handoff
- Link back to global dependency map

Quotas:

- Current policy
- Usage
- Forecast risk
- Pending quota requests

Pipeline:

- Topic publishing
- S3 export
- Gateway decisions
- Quality signals
- Cost handoff when relevant

Governance:

- Compliance posture
- Audit coverage
- Operational trust indicators
- Promotion/lifecycle status

Evidence:

- Readiness events
- Audit events
- Smoke/contract test events
- Pipeline events
- Quota events

Actions:

- Safe diagnostic actions
- Guarded mutation actions
- Lifecycle controls
- Manifest actions
- Destructive actions only with explicit confirmation

## Page-Level Templates

### Dashboard / Overview

Use:

- Platform health
- Severity-first Action queue
- Persistent detail rail on desktop
- Drawer on mobile

### Service Detail

Use:

- Service identity header
- Left-side section navigation on desktop
- Compact mobile section switcher
- Summary, Health, Dependencies, Quotas, Pipeline, Governance, Evidence, Actions

### List Pages

Applies to Registry, Requests, Dependencies, Issues, Audit, and Marketplace.

Use:

- Compact page heading
- Search and filters
- Dense table or list
- Optional detail drawer
- Row-card mobile fallback

### Workflow Pages

Applies to Readiness, Smoke tests, Manifest tools, Settings, and Promotions.

Use:

- Step groups
- Clear prerequisites
- Guarded actions
- Evidence after action
- Copy/run helpers where useful

### Analytics Pages

Applies to Quotas, Reliability, Pipeline, Cost, Compliance, and Operational Trust.

Use:

- Summary strip
- Anomalies first
- Trend/detail sections below
- Links back to affected services

### Mobile

Use:

- Action-oriented first viewport
- Drawers instead of persistent rails
- Row cards instead of wide tables
- Compact section switcher plus More for dense detail pages

## Component Standards

### Cards

- Flat cards with 1px border.
- 8px radius for compact cards.
- 12px radius for larger panels.
- Avoid nested card stacks.
- Use shadows sparingly, mainly for focused dashboard panels.

### Tables and Lists

- Dense rows.
- Clear severity and owner columns.
- Sticky action column where the table is wide.
- Row-card fallback on mobile.
- Keep filters close to the table.

### Severity Chips

Approved levels:

- Critical
- High
- Medium
- Info

Use severity consistently across queue rows, issue pages, detail rail, and service detail evidence.

### Buttons

- Mint: primary safe action.
- Black: primary navigation or neutral command.
- Outline: secondary action.
- Red: destructive confirmation only.

Do not use red for ordinary warnings or non-destructive navigation.

### Evidence Timelines

Evidence timelines should include dated proof from:

- Readiness
- Audit
- Smoke tests
- Contract tests
- Pipeline checks
- Quota checks

Evidence should answer what happened, when it happened, and whether it supports or contradicts the current platform state.

### Empty and Error States

Empty and error states should explain:

- What is missing or unavailable
- Whether it blocks work
- What action can fix it
- Which page or setting owns the fix

Avoid raw stack traces or vague unavailable copy.

### Destructive Actions

Destructive or high-impact actions require:

- Exact service ID confirmation where applicable
- Preview or dry-run where possible
- Clear statement of what will and will not be changed
- Evidence after action

## UX Guardrails

- Low cognitive load: the dashboard shows the most important current state, not every metric.
- Progressive disclosure: queue row -> detail rail -> service detail -> specialist workflow.
- Stable context: selecting a queue item should not move the user away from the queue.
- Object-centered work: services remain the main drill-in object.
- No hidden risk: critical issues and destructive actions stay visible, labeled, and guarded.
- Mobile parity: mobile may change layout, but it must preserve the same work path.

## Implementation Boundaries

The design should be implemented in phases later:

1. Navigation and shell IA.
2. Overview dashboard restructuring.
3. Service Detail section model.
4. Page-template consolidation.
5. Component standardization.
6. Mobile and visual QA.

Those phases are not implementation instructions yet. They define likely plan boundaries for the next planning step.

## Acceptance Criteria

The redesign is successful when:

- The first useful viewport shows platform health and the action queue.
- Critical and high severity work cannot be visually missed.
- Users can inspect evidence without losing queue context.
- Service Detail is the primary drill-in from issues, services, quotas, pipeline, and governance.
- Existing routes remain reachable.
- Mobile users can complete the same triage path without horizontal scrolling.
- Destructive actions remain guarded and explicit.
- The UI uses approved product language and avoids audience labels.

## Open Decisions

No product-shaping decisions remain open in this design. Implementation planning may still discover technical sequencing questions.

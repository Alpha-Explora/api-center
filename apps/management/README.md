# APICenter Management

Management is the operator console in `apps/management`.

It provisions APICenter consumer registrations, scoped API keys, service registry
records, readiness checks, and payment-event delivery configuration. It does not
own PayMongo credentials and does not provision Confluent, GKE, or AWS pipeline
resources.

## Local Checks

```powershell
npm install
npm run typecheck --workspace @apicenter/management
npm test --workspace @apicenter/management
npm run build --workspace @apicenter/management
```

## Current Operator Sources

- `docs/operations/apicenter-management-runbook.md`
- `docs/apicenter-platform-setup.md`
- `docs/payments-platform-current.md`

The old standalone management repository and historical plan archive are removed.
Use the active deprovisioning plan only when a cloud IAM deletion decision is still
pending.
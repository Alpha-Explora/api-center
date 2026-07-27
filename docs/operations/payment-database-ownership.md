# APICenter Payment Database Ownership

APICenter payments and the gateway use one Supabase/Postgres database. The
payment runtime owns the `shared_payment` schema; the gateway owns the
APICenter control-plane schemas. This is one physical database with separate
schemas and least-privilege roles, not a second payments database.

The gateway uses `DATABASE_URL`. The private payment runtime uses
`SHARED_SERVICES_DATABASE_URL`, pointing at the same database with the
`shared_services_app` role. The payment runtime must not receive the gateway's
control-plane credentials or PayMongo credentials.

The canonical migration authority is `supabase/migrations` in this repository.
The payment runtime Prisma migrations remain useful for schema validation, but
production changes are applied through the APICenter Supabase migration flow:

```powershell
npx supabase link --project-ref <project-ref>
npx supabase db push --dry-run
npx supabase db push
```

The `api-shared-services` repository is legacy migration source during the
transition and is not the target for new payment schema changes.

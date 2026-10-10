# gauth operations

This runbook covers the Google OAuth setup used by the Cloud Run `gauth` service.

## Runtime identity and secrets

Deploy `gauth` as `apicenter-gauth-runtime@apicenter-alpha-20260623.iam.gserviceaccount.com`. Do not reuse the shared-services runtime identity. The service reads `GAUTH_DATABASE_URL`, `GOOGLE_OAUTH_STATE_SECRET`, and `GAUTH_ADMIN_TOKEN` from Secret Manager. Keep the admin token secret named `apicenter-gauth-admin-token`; the gateway uses the same secret to authenticate its administrative calls to gauth.

Grant the gauth identity `roles/secretmanager.secretAccessor` on each configuration secret individually in the project that holds the gauth configuration:

```sh
CONFIG_PROJECT_ID=apicenter-alpha-20260623
GAUTH_SERVICE_ACCOUNT=apicenter-gauth-runtime@apicenter-alpha-20260623.iam.gserviceaccount.com

gcloud secrets add-iam-policy-binding apicenter-gauth-database-url-live \
  --project="$CONFIG_PROJECT_ID" \
  --member="serviceAccount:$GAUTH_SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding apicenter-gauth-google-oauth-state-secret \
  --project="$CONFIG_PROJECT_ID" \
  --member="serviceAccount:$GAUTH_SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding apicenter-gauth-admin-token \
  --project="$CONFIG_PROJECT_ID" \
  --member="serviceAccount:$GAUTH_SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor"
```

### Per-project OAuth client secrets

The admin API creates, updates, and deletes secrets named `apic-gauth-<projectId>-<environment>`. Set `GAUTH_SECRETS_PROJECT_ID` to the Google Cloud project ID that owns these secrets; it takes precedence over `GOOGLE_CLOUD_PROJECT` and `GCLOUD_PROJECT`. The service manifest sets it to `apicenter-alpha-20260623` to preserve the current behavior.

Grant conditional `roles/secretmanager.secretAccessor` access for the per-project secrets. IAM condition resource names use the numeric project number. Look it up, then use the number in the prefix condition:

```sh
GAUTH_SECRETS_PROJECT_ID=apicenter-alpha-20260623
PROJECT_NUMBER=$(gcloud projects describe "$GAUTH_SECRETS_PROJECT_ID" --format='value(projectNumber)')

gcloud projects add-iam-policy-binding "$GAUTH_SECRETS_PROJECT_ID" \
  --member="serviceAccount:$GAUTH_SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor" \
  --condition="expression=resource.name.startsWith(\"projects/${PROJECT_NUMBER}/secrets/apic-gauth-\"),title=gauth-oauth-client-secrets,description=Access per-project gauth OAuth client secrets"
```

Do not add a `resource.type == "secretmanager.googleapis.com/Secret"` clause. Secret Manager checks reads against the SecretVersion resource, whose resource name starts with the parent secret name.

Secret Manager checks `secretmanager.secrets.create` on the project, so a resource-name condition cannot restrict the names gauth creates. The recommended setup is a dedicated Google Cloud project used only for per-project OAuth client secrets: set `GAUTH_SECRETS_PROJECT_ID` to that project and grant the gauth service account `roles/secretmanager.admin` only in that project. This project-level admin grant also permits access to every secret in that dedicated project, so keep unrelated secrets out of it. Keep the three configuration secrets in their configuration project with the individual accessor grants above.

```sh
gcloud projects add-iam-policy-binding "$GAUTH_SECRETS_PROJECT_ID" \
  --member="serviceAccount:$GAUTH_SERVICE_ACCOUNT" \
  --role="roles/secretmanager.admin"
```

If you keep per-project secrets in a project shared with other secrets, gauth can create secrets with any name there. The prefix condition only limits access to existing secrets when access comes from the conditional accessor grant; it does not restrict secret creation, and any separate project-level admin grant bypasses that read boundary. Treat the project accordingly.

Verify the grants by impersonating the gauth service account. The operator running these commands needs permission to impersonate that account. Use an existing `apic-gauth-*` client secret in the dedicated secrets project for the allowed read, and an existing unrelated secret in a different project with no gauth grants for the denied read; values go to `/dev/null` rather than the terminal:

```sh
GAUTH_SERVICE_ACCOUNT=apicenter-gauth-runtime@apicenter-alpha-20260623.iam.gserviceaccount.com
GAUTH_SECRETS_PROJECT_ID=apicenter-gauth-secrets
UNRELATED_PROJECT_ID=apicenter-alpha-20260623
ALLOWED_SECRET=apic-gauth-example-live
UNRELATED_SECRET=some-other-existing-secret

gcloud secrets versions access latest \
  --secret="$ALLOWED_SECRET" --project="$GAUTH_SECRETS_PROJECT_ID" \
  --impersonate-service-account="$GAUTH_SERVICE_ACCOUNT" --out-file=/dev/null

if gcloud secrets versions access latest \
  --secret="$UNRELATED_SECRET" --project="$UNRELATED_PROJECT_ID" \
  --impersonate-service-account="$GAUTH_SERVICE_ACCOUNT" --out-file=/dev/null; then
  echo "ERROR: gauth unexpectedly read an unrelated secret" >&2
  exit 1
else
  echo "Verified: gauth cannot read the unrelated secret"
fi
```

Ensure the database URL points to the gauth database and that the state secret is a high-entropy value. Deploy a new revision after changing a secret version.

## Google OAuth consent screen

In Google Cloud Console, configure the OAuth consent screen for the project that owns APICenter's shared OAuth client. Before accepting general sign-ins, publish the consent screen and move it out of **Testing**. While the app remains in testing, Google limits sign-ins to 100 test users. Add the intended test accounts while validating the integration.

Choose **Internal** as the user type when only users in your Google Workspace organization should sign in. Use **External** only when sign-in by users outside that organization is intended, and complete Google's applicable verification requirements before broad release.

## Register redirect URIs

Each OAuth app registered for a project in APICenter has an explicit list of allowed redirect URIs. For every URI registered in APICenter, open the credentials for APICenter's shared OAuth client in Google Cloud Console and add the exact same URI under **Authorized redirect URIs**. Scheme, host, path, and trailing slash must match. Repeat this whenever an app's registered redirect URI changes; otherwise Google rejects the OAuth flow even when APICenter has accepted the URI.

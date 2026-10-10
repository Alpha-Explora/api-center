# gauth operations

This runbook covers the Google OAuth setup used by the Cloud Run `gauth` service. The deploy setup wizard, [`scripts/setup/deploy-setup-wizard.sh`](../../scripts/setup/deploy-setup-wizard.sh), applies the identity, secret, and IAM steps below with a confirmation before each change (stages 2 to 4) and walks through the consent screen and redirect URIs (stage 10).

## Runtime identity and secrets

Deploy `gauth` as `apicenter-gauth-runtime@apicenter-alpha-20260623.iam.gserviceaccount.com`. Do not reuse the shared-services runtime identity. Cloud Build deploys gauth as this account, so the deployer, `apicenter-cloudbuild-deployer@apicenter-alpha-20260623.iam.gserviceaccount.com`, needs `roles/iam.serviceAccountUser` on it unless it already holds that role, Editor, or Owner on the project:

```sh
gcloud iam service-accounts add-iam-policy-binding apicenter-gauth-runtime@apicenter-alpha-20260623.iam.gserviceaccount.com \
  --project=apicenter-alpha-20260623 \
  --member="serviceAccount:apicenter-cloudbuild-deployer@apicenter-alpha-20260623.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

`infra/gcp/cloud-run/gauth.yaml` reads six secrets. `GAUTH_DATABASE_URL`, `GOOGLE_OAUTH_STATE_SECRET`, and `GAUTH_ADMIN_TOKEN` come from `apicenter-gauth-database-url-live`, `apicenter-gauth-google-oauth-state-secret`, and `apicenter-gauth-admin-token`. `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` come from the shared Google client secrets `apicenter-shared-google-client-id-prod`, `apicenter-shared-google-client-secret-prod`, and `apicenter-shared-google-redirect-uri-prod`. A revision cannot start unless the gauth identity can read all six. Keep the admin token secret named `apicenter-gauth-admin-token`; the gateway uses the same secret to authenticate its administrative calls to gauth, so the gateway identity needs read access to it as well.

Grant `roles/secretmanager.secretAccessor` on each secret individually in the project that holds the configuration:

```sh
CONFIG_PROJECT_ID=apicenter-alpha-20260623
GAUTH_SERVICE_ACCOUNT=apicenter-gauth-runtime@apicenter-alpha-20260623.iam.gserviceaccount.com
GATEWAY_SERVICE_ACCOUNT=api-center-cloud-run@apicenter-alpha-20260623.iam.gserviceaccount.com

for secret in \
  apicenter-gauth-database-url-live \
  apicenter-gauth-google-oauth-state-secret \
  apicenter-gauth-admin-token \
  apicenter-shared-google-client-id-prod \
  apicenter-shared-google-client-secret-prod \
  apicenter-shared-google-redirect-uri-prod; do
  gcloud secrets add-iam-policy-binding "$secret" \
    --project="$CONFIG_PROJECT_ID" \
    --member="serviceAccount:$GAUTH_SERVICE_ACCOUNT" \
    --role="roles/secretmanager.secretAccessor"
done

gcloud secrets add-iam-policy-binding apicenter-gauth-admin-token \
  --project="$CONFIG_PROJECT_ID" \
  --member="serviceAccount:$GATEWAY_SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor"
```

### Per-project OAuth client secrets

The admin API creates, updates, and deletes secrets named `apic-gauth-<projectId>-<environment>` for projects that use their own Google client. Set `GAUTH_SECRETS_PROJECT_ID` to the Google Cloud project ID that owns these secrets; it takes precedence over `GOOGLE_CLOUD_PROJECT` and `GCLOUD_PROJECT`. The service manifest sets it to the main project, `apicenter-alpha-20260623`.

Do not grant `roles/secretmanager.admin` in the main project: it would give gauth every secret there. Use one of the two options below.

#### Option 1: custom roles in the main project

Secret Manager checks `secretmanager.secrets.create` on the project, so a resource-name condition cannot restrict the names gauth creates. Everything else can be limited to the `apic-gauth-` prefix. Create two custom roles. Bind the creator role without a condition and the other role with a prefix condition. IAM condition resource names use the numeric project number:

```sh
GAUTH_SECRETS_PROJECT_ID=apicenter-alpha-20260623
PROJECT_NUMBER=$(gcloud projects describe "$GAUTH_SECRETS_PROJECT_ID" --format='value(projectNumber)')

gcloud iam roles create apicenterGauthSecretCreator \
  --project="$GAUTH_SECRETS_PROJECT_ID" \
  --title="APICenter gauth secret creator" \
  --permissions=secretmanager.secrets.create \
  --stage=GA
gcloud iam roles create apicenterGauthClientSecrets \
  --project="$GAUTH_SECRETS_PROJECT_ID" \
  --title="APICenter gauth client secrets" \
  --permissions=secretmanager.secrets.get,secretmanager.secrets.delete,secretmanager.versions.add,secretmanager.versions.access,secretmanager.versions.get \
  --stage=GA

gcloud projects add-iam-policy-binding "$GAUTH_SECRETS_PROJECT_ID" \
  --member="serviceAccount:$GAUTH_SERVICE_ACCOUNT" \
  --role="projects/$GAUTH_SECRETS_PROJECT_ID/roles/apicenterGauthSecretCreator" \
  --condition=None
gcloud projects add-iam-policy-binding "$GAUTH_SECRETS_PROJECT_ID" \
  --member="serviceAccount:$GAUTH_SERVICE_ACCOUNT" \
  --role="projects/$GAUTH_SECRETS_PROJECT_ID/roles/apicenterGauthClientSecrets" \
  --condition="expression=resource.name.startsWith(\"projects/${PROJECT_NUMBER}/secrets/apic-gauth-\"),title=gauth-client-secrets,description=Only secrets named apic-gauth-*"
```

With these roles, gauth can create secrets with any name, but it can only read, update, or delete `apic-gauth-*` secrets. A project-level `roles/secretmanager.admin` grant to gauth would bypass that boundary, so remove any such grant. Do not add a `resource.type == "secretmanager.googleapis.com/Secret"` clause. Secret Manager checks reads against the SecretVersion resource, whose resource name starts with the parent secret name. The `apicenterGauthClientSecrets` binding replaces the conditional `roles/secretmanager.secretAccessor` grant that earlier versions of this runbook used.

#### Option 2: a dedicated secrets project

Alternatively, use a Google Cloud project that holds only per-project OAuth client secrets. Set `GAUTH_SECRETS_PROJECT_ID` in `gauth.yaml` to that project and grant the gauth service account `roles/secretmanager.admin` only there. This project-level admin grant permits access to every secret in that project, so keep unrelated secrets out of it. Keep the six configuration secrets in the main project with the individual grants above.

```sh
GAUTH_SECRETS_PROJECT_ID=apicenter-gauth-secrets

gcloud projects add-iam-policy-binding "$GAUTH_SECRETS_PROJECT_ID" \
  --member="serviceAccount:$GAUTH_SERVICE_ACCOUNT" \
  --role="roles/secretmanager.admin"
```

#### Verify the grants

Verify either option by impersonating the gauth service account. The operator running these commands needs permission to impersonate that account. Use an existing `apic-gauth-*` client secret for the allowed read. For the denied read, use an existing secret that gauth has no grant on: with option 1, another secret in the main project such as `apicenter-payments-live-secret-key`; with option 2, a secret in a different project. Values go to `/dev/null` rather than the terminal:

```sh
GAUTH_SERVICE_ACCOUNT=apicenter-gauth-runtime@apicenter-alpha-20260623.iam.gserviceaccount.com
GAUTH_SECRETS_PROJECT_ID=apicenter-alpha-20260623
UNRELATED_PROJECT_ID=apicenter-alpha-20260623
ALLOWED_SECRET=apic-gauth-example-live
UNRELATED_SECRET=apicenter-payments-live-secret-key

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

In Google Cloud Console, open **Google Auth Platform** for the project that owns APICenter's shared OAuth client and go to **Audience**.

Choose **Internal** as the user type when only users in your Google Workspace organization should sign in; it is available only for projects that belong to an organization. Use **External** only when sign-in by users outside that organization is intended, and complete Google's applicable verification requirements before broad release.

Before accepting general sign-ins, select **Publish app** to move the app from **Testing** to **In production**. While the app is in testing, only the test users you add can sign in, at most 100, and each test user's authorization expires seven days after they consent, so they have to sign in again. Add the intended test accounts while validating the integration.

## Register redirect URIs

Each project registers its allowed redirect URLs per environment on the management console's **Google sign-in** page. For every URL registered there, open the credentials for APICenter's shared OAuth client in Google Cloud Console and add the exact same URI under **Authorized redirect URIs**. Scheme, host, path, and trailing slash must match. Repeat this whenever a registered redirect URL changes; otherwise Google rejects the OAuth flow even when APICenter has accepted the URI. A project that saves its own Google client ID on that page adds its redirect URLs to its own client instead.

# gauth operations

This runbook covers the Google OAuth setup used by the Cloud Run `gauth` service.

## Runtime identity and secrets

Deploy `gauth` as `apicenter-gauth-runtime@apicenter-alpha-20260623.iam.gserviceaccount.com`. Do not reuse the shared-services runtime identity. The service reads `GAUTH_DATABASE_URL`, `GOOGLE_OAUTH_STATE_SECRET`, and `GAUTH_ADMIN_TOKEN` from Secret Manager. Keep the admin token secret named `apicenter-gauth-admin-token`; the gateway uses the same secret to authenticate its administrative calls to gauth.

The service also reads per-project OAuth client secrets at runtime. Grant the gauth identity `roles/secretmanager.secretAccessor` on those secrets with a resource-name condition restricted to the `apic-gauth-*` namespace. For example, create this conditional binding in the project that owns the secrets:

```sh
gcloud projects add-iam-policy-binding apicenter-alpha-20260623 \
  --member="serviceAccount:apicenter-gauth-runtime@apicenter-alpha-20260623.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --condition='expression=resource.type == "secretmanager.googleapis.com/Secret" && resource.name.startsWith("projects/apicenter-alpha-20260623/secrets/apic-gauth-"),title=gauth-oauth-client-secrets,description=Access only per-project gauth OAuth client secrets'
```

The Cloud Run revision also needs Secret Manager access to the three explicitly configured environment secrets. Grant access to only those required secrets, including `apicenter-gauth-admin-token`; keep the conditional binding above limited to `apic-gauth-*` client-secret names. Ensure the database URL points to the gauth database and that the state secret is a high-entropy value. Deploy a new revision after changing a secret version.

## Google OAuth consent screen

In Google Cloud Console, configure the OAuth consent screen for the project that owns APICenter's shared OAuth client. Before accepting general sign-ins, publish the consent screen and move it out of **Testing**. While the app remains in testing, Google limits sign-ins to 100 test users. Add the intended test accounts while validating the integration.

Choose **Internal** as the user type when only users in your Google Workspace organization should sign in. Use **External** only when sign-in by users outside that organization is intended, and complete Google's applicable verification requirements before broad release.

## Register redirect URIs

Each OAuth app registered for a project in APICenter has an explicit list of allowed redirect URIs. For every URI registered in APICenter, open the credentials for APICenter's shared OAuth client in Google Cloud Console and add the exact same URI under **Authorized redirect URIs**. Scheme, host, path, and trailing slash must match. Repeat this whenever an app's registered redirect URI changes; otherwise Google rejects the OAuth flow even when APICenter has accepted the URI.

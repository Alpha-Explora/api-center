# Tenant-Branded Google OAuth

Tenant-branded Google OAuth gives a tenant its own Google consent screen name,
such as `Campus One`, while APICenter continues to broker authorization through
the `gauth` shared service.

## Folder Model

Use the product-first customer runtime folder:

```text
20-customer-runtime
  apicenter
    dedicated
      tenant-<tenant-slug>
        <auth-project-id>
```

Example:

```text
20-customer-runtime/apicenter/dedicated/tenant-campus-one/ae-apic-auth-campus-one-prod
```

Long tenant slugs are truncated only in the GCP project ID segment so generated
project IDs stay within Google's 30-character limit. The tenant folder and
central secret can keep the full tenant slug.

## Secret Location

Runtime secrets are stored centrally in the APICenter project Secret Manager
payload consumed by shared services.

Do not store tenant OAuth client secrets in the tenant auth project unless a
future isolation requirement explicitly changes this rule.

## Tenant Client Config

Add tenant client config to `GOOGLE_OAUTH_TENANT_CLIENTS_JSON` in
`api-shared-services-prod` or the matching test secret:

```json
{
  "campus-one": {
    "status": "active",
    "displayName": "Campus One",
    "clientId": "TENANT_GOOGLE_CLIENT_ID",
    "clientSecret": "TENANT_GOOGLE_CLIENT_SECRET",
    "redirectUri": "https://api-center.itsandbox.site/api/v1/shared/gauth/oauth/callback",
    "allowSharedOauthFallback": false,
    "authProjectId": "ae-apic-auth-campus-one-prod"
  }
}
```

## Google Manual Boundary

APICenter can create or preview the GCP folder/project shell, labels, billing
link, and Secret Manager target.

Google Auth Platform branding remains a guided manual step:

1. Open the tenant auth GCP project.
2. Configure Google Auth Platform branding.
3. Set app name to the tenant product name.
4. Add logo, support email, homepage, privacy policy, and terms links.
5. Create a Web OAuth client.
6. Add the APICenter callback URL.
7. Copy the one-time client secret into central APICenter Secret Manager.
8. Mark the tenant OAuth record `active` only after validation.

## Activation Checks

Before marking a tenant OAuth client active:

- The tenant folder exists.
- The tenant auth project exists and is billing-linked.
- Google Auth Platform branding is configured.
- Web OAuth client exists.
- Redirect URI exactly matches APICenter callback URL.
- `clientId` and `clientSecret` are present in central Secret Manager.
- `allowSharedOauthFallback` is `false` for production tenants.
- Authorization URL generation returns the tenant client ID.
- Token exchange has been smoke-tested or manually verified.

## Disable

Set tenant status to `disabled` in `GOOGLE_OAUTH_TENANT_CLIENTS_JSON`, sync the
shared-services secret, and restart the affected `gauth` deployment.

## Rotate

1. Create a new OAuth client secret in Google Auth Platform.
2. Add a new central Secret Manager version with the updated tenant JSON.
3. Restart `gauth`.
4. Validate authorization URL generation and token exchange.
5. Remove or disable the old secret in Google Console after successful
   validation.

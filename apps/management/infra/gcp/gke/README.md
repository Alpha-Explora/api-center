# API Center Management GKE Identity

Private GKE is a fallback deployment path for the management UI. Vercel remains
the default when API Center admin endpoints are reachable from Vercel and
server-only secrets can stay private there.

These manifests prepare `apicenter-management` for private deployment in the
existing `api-center` GKE namespace.

Do not expose the management UI publicly until admin authentication and
authorization are implemented.

## What This Sets Up

- Kubernetes service account: `api-center/apicenter-management`
- Google service account expected by Workload Identity:
  `apicenter-mgmt-provisioner@apicenter-alpha-20260623.iam.gserviceaccount.com`
- Secret Manager access through GKE Workload Identity, without service account
  JSON keys.
- Narrow Kubernetes RBAC so the restart button can only `get` and `patch` the
  `api-center` deployment.

## One-Time GCP IAM Setup

Run these once from an authenticated operator shell:

```powershell
gcloud config set project apicenter-alpha-20260623

gcloud iam service-accounts create apicenter-mgmt-provisioner `
  --project apicenter-alpha-20260623 `
  --display-name "API Center Management Provisioner"

gcloud iam roles create apiCenterManagementProvisioner `
  --project apicenter-alpha-20260623 `
  --title "API Center Management Provisioner" `
  --description "Create and rotate API Center per-tribe Secret Manager secrets" `
  --permissions "secretmanager.secrets.create,secretmanager.secrets.get,secretmanager.versions.add" `
  --stage GA

gcloud projects add-iam-policy-binding apicenter-alpha-20260623 `
  --member "serviceAccount:apicenter-mgmt-provisioner@apicenter-alpha-20260623.iam.gserviceaccount.com" `
  --role "projects/apicenter-alpha-20260623/roles/apiCenterTribeSecretProvisioner"
```

The custom role matches the route's actual Secret Manager calls:

- create a per-tribe secret if it does not exist
- read secret metadata to avoid duplicate create attempts
- add a new secret version during secret rotation

It does not allow deleting secrets, destroying versions, reading secret payloads,
or changing Secret Manager IAM policies.

Bind the Kubernetes service account to the Google service account:

```powershell
gcloud iam service-accounts add-iam-policy-binding `
  apicenter-mgmt-provisioner@apicenter-alpha-20260623.iam.gserviceaccount.com `
  --project apicenter-alpha-20260623 `
  --role roles/iam.workloadIdentityUser `
  --member "serviceAccount:apicenter-alpha-20260623.svc.id.goog[api-center/apicenter-management]"
```

## Apply Kubernetes Identity And RBAC

```powershell
kubectl apply -f infra/gcp/gke/10-service-account.yaml
kubectl apply -f infra/gcp/gke/20-api-center-restart-rbac.yaml
```

The deployment must set:

```yaml
serviceAccountName: apicenter-management
```

See `30-deployment.example.yaml` for the relevant deployment shape.

## Required Runtime Environment

The deployed app still needs normal server env:

```env
API_CENTER_BASE_URL=https://api-center.itsandbox.site
API_CENTER_PLATFORM_ADMIN_SECRET=<platform-admin-secret>
NEXT_PUBLIC_API_CENTER_BASE_URL=https://api-center.itsandbox.site
GOOGLE_CLOUD_PROJECT=apicenter-alpha-20260623
TRIBE_SECRET_GCP_PREFIX=api-center-tribe-secret-
ALLOW_DEPLOYMENT_RESTARTS=true
K8S_NAMESPACE=api-center
K8S_API_CENTER_DEPLOYMENT=api-center
```

Do not set `GOOGLE_APPLICATION_CREDENTIALS` in GKE. The Google client library
will use the pod identity from Workload Identity.

## Local Development

Local dev still uses Application Default Credentials:

```powershell
gcloud config set project apicenter-alpha-20260623
gcloud auth application-default login `
  --impersonate-service-account=apicenter-mgmt-provisioner@apicenter-alpha-20260623.iam.gserviceaccount.com
```

If impersonation is not available yet, use:

```powershell
gcloud auth application-default login
```

Then restart `npm run dev`.



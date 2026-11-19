# Google Cloud Infrastructure

Google Cloud deployment assets for the management UI.

The console runs on Cloud Run (`apicenter-management-test`, region `asia-southeast1`), serving
`https://apicenter.itsandbox.site`. Its image is built by `infra/gcp/cloud-build/apicenter-workspace-images.json` at the
repository root and deployed with `gcloud run services update --image`.
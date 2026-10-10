# Google Cloud Infrastructure

Google Cloud deployment assets for API Center.

- `cloud-build/` - Cloud Build pipeline configs used with `gcloud builds submit --config ...`.
- `cloud-run/` - Cloud Run service manifest for the legacy/simple deployment option.
- `gke/` - Current GKE Autopilot production and test manifests.

Run provider commands from the repository root unless a runbook says otherwise.

## Deploy setup

Before deploying changes that need new service accounts, secrets, IAM grants, or provider settings, run the deploy setup wizard from the repository root:

```bash
bash scripts/setup/deploy-setup-wizard.sh
```

It checks what already exists, asks before every change, and never prints a secret value. It covers the gauth identity and secrets ([GAUTH_OPERATIONS.md](GAUTH_OPERATIONS.md)), the email admin token, the Resend, Twilio, and PayMongo webhooks, the GitHub smoke secrets, Google sign-in, the history purge job, the database baseline, and the deploy order. Non-secret answers are kept in `.env.deploy-wizard`, which git ignores.

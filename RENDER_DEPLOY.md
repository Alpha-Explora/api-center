# APICenter — Render Deployment Guide

This guide walks a developer from zero to a fully running APICenter platform on Render,
with all six services registered and healthy.

---

## Architecture on Render

```
Internet
   |
   +--> api-center          (NestJS gateway, port 3000 → Render HTTPS)
           |
           | self-registration on startup (POST /api/v1/registry/register)
           |
   +--> payment-service     (PayMongo, port 4010)
   +--> email-service       (Resend email, port 4012)
   +--> sms-service         (Mock SMS, port 4011)
   +--> gauth-service       (Google OAuth, port 4013)
   +--> otp-service         (OTP generate/verify, port 4014)
```

Each shared service calls back to api-center on startup to self-register.
api-center must be healthy before shared services can register.

---

## Prerequisites

### 1. Redis (required)

api-center needs two Redis instances:

- `REDIS_CACHE_URL` — service registry + token store
- `REDIS_RATE_LIMIT_URL` — distributed rate-limit counters

Options:

**Option A — Render Redis add-on (easiest)**
Dashboard → New → Redis → create two instances (`cache` and `rate-limit`).
Render provides an internal Redis URL in the format `redis://...`.

**Option B — Upstash Redis (free tier, external)**
Create two databases at https://upstash.com → copy the `REDIS_URL` for each.

### 2. Kafka (optional)

api-center tolerates a missing or empty Kafka configuration and degrades gracefully
(audit log events are dropped, all other features remain functional).

If you want Kafka:
- Upstash Kafka: https://upstash.com/kafka → copy the bootstrap server URL.
  Set `KAFKA_BROKERS` to `<host>:<port>` and leave `KAFKA_REST_PROXY_URL` empty
  unless you need the REST proxy.

If you do not want Kafka, set `KAFKA_BROKERS` to an empty string `""`.

### 3. Vault (optional)

In production you should run a properly unsealed Vault cluster.
For an initial Render deployment you can disable Vault:
- Set `VAULT_DEV_MODE` to `false` and leave `VAULT_ADDR` / `VAULT_TOKEN` empty.
- api-center falls back to in-process key storage when Vault is unreachable.

### 4. JWT keypair

Generate an RSA-2048 keypair:

```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

You will paste the contents of these files into Render environment variables.
The PEM values must include the `-----BEGIN...-----` headers.
On Render you can paste multiline PEM values directly into the secret field.

### 5. Google OAuth credentials (for gauth-service)

1. Go to https://console.cloud.google.com → APIs & Services → Credentials.
2. Create an OAuth 2.0 Client ID (Web application).
3. Under "Authorized redirect URIs", add:
   `https://gauth-service-xxxx.onrender.com/oauth/callback`
   (Replace `xxxx` with your Render service slug — visible after first deploy.)
4. Copy Client ID and Client Secret.

---

## Step-by-Step Deployment

### Step 1 — Push your repo to GitHub

Make sure `api-center/render.yaml` is committed and pushed to your GitHub repository.
Render reads the blueprint from this file.

```
repo-root/
  api-center/
    render.yaml        ← Render reads this
    ...
  api-shared/
    shared-services/
      paymongo/
      email-gateway/
      sms-gateway/
      gauth-gateway/
      otp-gateway/
```

### Step 2 — Connect via Blueprint

1. Go to https://dashboard.render.com → **New** → **Blueprint**.
2. Connect your GitHub account if not already connected.
3. Select your repository.
4. Set **Blueprint file path** to: `api-center/render.yaml`
5. Click **Apply Blueprint**.

Render will detect all six services defined in `render.yaml` but will not deploy
them yet — you need to fill in environment variables first.

### Step 3 — Deploy api-center first

Deploy api-center before any shared service. The shared services call back to
api-center on startup to self-register.

1. In the Render dashboard, find the **api-center** service.
2. Go to **Environment** tab and fill in all required secrets (see table below).
3. Click **Manual Deploy → Deploy latest commit**.
4. Wait until the health check at `/api/v1/health/live` returns 200.
   You will see the status turn to **Live** in the dashboard.

### Step 4 — Note the api-center URL

Once api-center is live, copy its Render URL from the dashboard header:
`https://api-center-xxxx.onrender.com`

You will set this as `API_CENTER_URL` on all five shared services.

### Step 5 — Fill in env vars for shared services and deploy

For each shared service (payment, email, sms, gauth, otp):

1. Go to the service in the Render dashboard → **Environment**.
2. Set `API_CENTER_URL` to the api-center URL from Step 4.
3. Set `PLATFORM_ADMIN_SECRET` to the same value used in api-center.
4. Set any service-specific secrets (see table below).
5. Deploy the service.
6. Once the service is live, copy its own Render URL.
7. Set `SERVICE_BASE_URL` to the service's own Render URL.
8. Trigger a manual redeploy so the service re-registers with the correct base URL.

### Step 6 — Verify registration

After all services are running, call the registry endpoint:

```bash
curl https://api-center-xxxx.onrender.com/api/v1/registry/services \
  -H "X-Platform-Secret: <your-PLATFORM_ADMIN_SECRET>"
```

You should see all five shared services listed with `status: registered`.

---

## Environment Variables Reference

### api-center

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | yes | Set to `production` |
| `JWT_PRIVATE_KEY` | yes | RSA-2048 private key PEM (with headers) |
| `JWT_PUBLIC_KEY` | yes | RSA-2048 public key PEM (with headers) |
| `PLATFORM_ADMIN_SECRET` | yes | Shared secret used by all platform services to register. Use a long random string. |
| `REDIS_CACHE_URL` | yes | Redis URL for service registry and token store |
| `REDIS_RATE_LIMIT_URL` | yes | Redis URL for rate-limit counters (can be the same Redis instance as a different DB number, e.g. `redis://host:6379/1`) |
| `KAFKA_BROKERS` | no | Kafka bootstrap server(s). Set to `""` to disable Kafka. |
| `KAFKA_REST_PROXY_URL` | no | Kafka REST proxy URL. Leave empty if not using REST proxy. |
| `VAULT_ADDR` | no | Vault server address. Leave empty to disable Vault. |
| `VAULT_TOKEN` | no | Vault root or AppRole token. |
| `VAULT_DEV_MODE` | no | Set to `false` in production. |
| `GEOLOCATION_API_URL` | no | External geo provider URL. Leave empty to disable geo routes. |
| `GEOLOCATION_API_KEY` | no | API key for geo provider. |
| `GEOTAGGING_API_URL` | no | External geotagging provider URL. |
| `GEOTAGGING_API_KEY` | no | API key for geotagging provider. |
| `GEOFENCING_API_URL` | no | External geofencing provider URL. |
| `GEOFENCING_API_KEY` | no | API key for geofencing provider. |
| `EXTERNAL_ALLOWLIST_GEOLOCATION` | no | Comma-separated tribe IDs or `*` for all. |
| `EXTERNAL_ALLOWLIST_GEOTAGGING` | no | Comma-separated tribe IDs or `*` for all. |
| `EXTERNAL_ALLOWLIST_GEOFENCING` | no | Comma-separated tribe IDs or `*` for all. |
| `EXTERNAL_ALLOWLIST_KAFKA` | no | Comma-separated tribe IDs or `*` for all. |
| `TRIBE_SECRET_<TRIBE_ID>` | yes (per tribe) | sha256 hash of the tribe's raw secret. See Tribe Onboarding below. |

### payment-service

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | yes | `4010` (pre-set in render.yaml) |
| `NODE_ENV` | yes | `production` |
| `PAYMONGO_SECRET_KEY` | yes | PayMongo secret key (`sk_live_...`) from PayMongo dashboard |
| `API_CENTER_URL` | yes | api-center Render URL |
| `PLATFORM_ADMIN_SECRET` | yes | Must match api-center |
| `SERVICE_BASE_URL` | yes | This service's own Render URL (set after first deploy) |

### email-service

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | yes | `4012` (pre-set) |
| `NODE_ENV` | yes | `production` |
| `RESEND_API_KEY` | yes | Resend API key (`re_...`) from resend.com |
| `EMAIL_FROM_ADDRESS` | yes | From address on a verified Resend domain |
| `API_CENTER_URL` | yes | api-center Render URL |
| `PLATFORM_ADMIN_SECRET` | yes | Must match api-center |
| `SERVICE_BASE_URL` | yes | This service's own Render URL |

### sms-service

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | yes | `4011` (pre-set) |
| `NODE_ENV` | yes | `production` |
| `API_CENTER_URL` | yes | api-center Render URL |
| `PLATFORM_ADMIN_SECRET` | yes | Must match api-center |
| `SERVICE_BASE_URL` | yes | This service's own Render URL |

Note: sms-service is a mock — it does not call any real SMS carrier.

### gauth-service

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | yes | `4013` (pre-set) |
| `NODE_ENV` | yes | `production` |
| `GOOGLE_CLIENT_ID` | yes | OAuth 2.0 Client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | yes | OAuth 2.0 Client Secret |
| `GOOGLE_REDIRECT_URI` | yes | Must exactly match the URI registered in Google Cloud Console. Format: `https://gauth-service-xxxx.onrender.com/oauth/callback` |
| `API_CENTER_URL` | yes | api-center Render URL |
| `PLATFORM_ADMIN_SECRET` | yes | Must match api-center |
| `SERVICE_BASE_URL` | yes | This service's own Render URL |

### otp-service

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | yes | `4014` (pre-set) |
| `NODE_ENV` | yes | `production` |
| `API_CENTER_URL` | yes | api-center Render URL |
| `PLATFORM_ADMIN_SECRET` | yes | Must match api-center |
| `SERVICE_BASE_URL` | yes | This service's own Render URL |

---

## Tribe Onboarding

Each tribe that wants to use the APICenter gateway must be registered with a secret.

### 1. Generate the hashed secret

Choose a raw secret string for the tribe (e.g. `my-tribe-raw-secret`).
Hash it with sha256:

```bash
echo -n "my-tribe-raw-secret" | sha256sum
# Output: <64-char hex hash>
```

### 2. Add the env var to api-center on Render

In the api-center service → Environment, add:

```
TRIBE_SECRET_<TRIBE_ID> = <64-char sha256 hash>
```

Where `<TRIBE_ID>` is the tribe's `serviceId` in uppercase with underscores.
Example: tribe `demand-service` → env var `TRIBE_SECRET_DEMAND_SERVICE`.

### 3. Redeploy api-center

Trigger a manual deploy so the new env var is loaded.

### 4. Register the tribe

The tribe then calls:

```bash
curl -X POST https://api-center-xxxx.onrender.com/api/v1/registry/register \
  -H "Content-Type: application/json" \
  -H "X-Platform-Secret: <PLATFORM_ADMIN_SECRET>" \
  -d '{
    "serviceId": "demand-service",
    "baseUrl": "https://demand-service.example.com",
    "name": "Demand Service",
    "version": "1.0.0"
  }'
```

---

## Google OAuth — gauth-service Setup

The `gauth-service` server.js correctly reads all Google credentials from environment
variables. No hardcoding is present. The redirect URI used in the OAuth flow is
read from `GOOGLE_REDIRECT_URI` at runtime.

Critical: the value of `GOOGLE_REDIRECT_URI` must exactly match (character for character)
one of the Authorized Redirect URIs registered in your Google Cloud Console OAuth client.

Common mistake: registering `https://gauth-service-xxxx.onrender.com/oauth/callback`
in Google but setting `GOOGLE_REDIRECT_URI` to the same URL without `/oauth/callback`.
The paths must match exactly.

When calling the authorize endpoint, callers may also pass `redirectUri` in the
request body to override the default. That override value must also be registered
in Google Cloud Console.

---

## Render Free Plan Considerations

- Free web services spin down after 15 minutes of inactivity.
- A cold-start spin-up takes 30–60 seconds.
- When a spun-down shared service receives a request, it starts up and immediately
  re-registers with api-center. This re-registration is safe and idempotent.
- If you need always-on availability, upgrade to the Render Starter plan ($7/month
  per service).

---

## Troubleshooting

**Shared service logs show "failed to register with api-center"**
- Verify `API_CENTER_URL` is set to the full Render URL including `https://`.
- Verify `PLATFORM_ADMIN_SECRET` matches the value set on api-center.
- Confirm api-center is healthy: `curl https://api-center-xxxx.onrender.com/api/v1/health/live`

**api-center build fails on Render**
- Render runs `npm ci && npm run build` in the `api-center/` directory.
- If `@nestjs/cli` is a devDependency, `npm ci` installs it (devDeps are included
  in a standard `npm ci`). The build uses `node_modules/.bin/nest` directly.
- Check the Render build log for TypeScript compilation errors.

**gauth-service returns GOOGLE_CONFIG_ERROR**
- `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` is not set. Add them in the
  Render dashboard under gauth-service → Environment.

**Redis connection refused**
- Confirm Redis is running and the URL format is `redis://host:port` (no trailing slash).
- If using Upstash, use the `rediss://` (TLS) URL they provide, not the plain `redis://`.

**TRIBE_SECRET env var not recognized**
- The env var name must be `TRIBE_SECRET_` followed by the tribe serviceId in
  SCREAMING_SNAKE_CASE. Example: `demand-service` → `TRIBE_SECRET_DEMAND_SERVICE`.

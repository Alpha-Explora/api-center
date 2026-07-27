# Internal Tribe Token Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move tribe machine-to-machine authentication away from Descope per-tribe app provisioning and make API Center issue its own signed internal JWTs after validating `TRIBE_SECRET_*`.

**Architecture:** API Center remains the source of truth for tribe registration, secret validation, scopes, refresh-token state, revocation, and audit events. Descope stays available for human/user authentication and future management-console login, but tribe-to-API-Center tokens are signed by API Center using a persistent RS256 key pair stored in Secret Manager. Validation accepts API Center-issued tribe tokens first and optionally Descope tokens second during migration.

**Tech Stack:** NestJS, jose, Redis token store, GCP Secret Manager JSON payloads, GKE, Next.js management console.

**Implementation status (2026-05-14):** Internal tribe token auth is implemented, deployed to GKE, documented, and pushed. `AUTH_PROVIDER=composite` is live, JWKS is reachable, and the old OIDC provider path has been removed from the API Center code/config surface. The next phase is local smoke testing from `docs/operations/local-smoke-testing.md`; production readiness follows after smoke tests pass.

**Superseded secret-storage note (2026-05-14):** Later work moved tribe secret
hashes out of `api-center-prod`. New tribes should use one Secret Manager secret
per owning tribe named `api-center-tribe-secret-<tribe-id>`. Any `TRIBE_SECRET_*`
steps below are historical context or rollback-only.

---

## Current Problem

The current production token flow is:

```text
POST /api/v1/auth/token
  -> validate TRIBE_SECRET_<TRIBE>
  -> call Descope /oauth2/v1/apps/token with client_id=<tribeId>
  -> return Descope access token
```

This makes every tribe depend on a matching Descope Inbound App or OAuth app. That is brittle and can become expensive because Descope counts M2M exchanges and may limit federated/inbound apps by plan.

The target flow is:

```text
POST /api/v1/auth/token
  -> validate TRIBE_SECRET_<TRIBE>
  -> derive permissions and scopes from registry
  -> API Center signs an internal RS256 JWT
  -> API Center stores refresh-token metadata in Redis
  -> return API Center access token and refresh token
```

Descope remains separate:

```text
Descope = human/user identity provider
GAuth = shared Google OAuth wrapper for tribe product features
API Center internal JWT = tribe/backend M2M authentication
```

---

## File Structure

### API Center

- Modify: `api-center/src/auth/auth-provider.interface.ts`
  - Clarify that providers may be issuers, validators, or both.
- Create: `api-center/src/auth/providers/internal-jwt.provider.ts`
  - Production-safe API Center JWT issuer and validator.
- Create: `api-center/src/auth/providers/composite-auth.provider.ts`
  - Issues tribe tokens through `InternalJwtProvider`.
  - Validates API Center JWTs first, then optional Descope tokens.
  - Exposes API Center JWKS.
- Modify: `api-center/src/auth/auth.module.ts`
  - Register `InternalJwtProvider` and `CompositeAuthProvider`.
  - Add provider selector for `AUTH_PROVIDER=composite` and `AUTH_PROVIDER=internal-jwt`.
- Modify: `api-center/src/config/config.service.ts`
  - Add `internalJwt` config block.
  - Allow provider values `descope`, `dev-jwt`, `internal-jwt`, `composite`.
  - Enforce persistent signing keys in production for `internal-jwt` and `composite`.
- Modify: `api-center/src/auth/auth.controller.ts`
  - Keep endpoint shape unchanged.
  - Update JWKS comments/error copy so `.well-known/jwks.json` is not described as dev-only.
- Modify: `api-center/src/auth/auth.service.ts`
  - Preserve Redis refresh-token lifecycle.
  - Ensure refresh/revoke works with internal JWT refresh tokens.
- Modify/Create tests:
  - `api-center/src/auth/providers/internal-jwt.provider.spec.ts`
  - `api-center/src/auth/providers/composite-auth.provider.spec.ts`
  - `api-center/src/auth/auth.module.spec.ts` if module selection is currently untested.
  - Update existing `auth.controller.spec.ts` only if expectations mention Descope-specific behavior.
- Modify docs:
  - `api-center/docs/apicenter-platform-setup.md`
  - `api-center/docs/deployment-gke.md`
  - `api-center/docs/developer/shared-service-team-workflow.md`
  - `apicenter-management/docs/operations/local-smoke-testing.md`

### API Center Management

- Modify: `apicenter-management/src/app/settings/page.tsx`
  - Explain that Descope client secrets are no longer required per tribe for internal token mode.
- Modify: `apicenter-management/src/components/shared-service-smoke-tests.tsx`
  - Keep request-token UX unchanged.
- Modify docs:
  - `apicenter-management/docs/operations/local-smoke-testing.md`
  - `apicenter-management/docs/superpowers/plans/2026-05-14-production-readiness-next-phases.md`

---

## Phase 1: Design And Config Contract

**Outcome:** API Center has an explicit, documented auth mode for internal tribe JWTs, without changing runtime behavior yet.

- [ ] **Step 1: Add config names to the plan checklist**

Use these environment variables:

```json
{
  "AUTH_PROVIDER": "composite",
  "INTERNAL_JWT_ISSUER": "https://api-center.itsandbox.site",
  "INTERNAL_JWT_AUDIENCE": "api-center",
  "INTERNAL_JWT_ACCESS_TTL_SECONDS": "3600",
  "INTERNAL_JWT_REFRESH_TTL_SECONDS": "86400",
  "JWT_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----",
  "JWT_PUBLIC_KEY": "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----"
}
```

`TRIBE_SECRET_<TRIBE>` remains the SHA-256 hash of the plaintext tribe secret.

- [ ] **Step 2: Modify `api-center/src/config/config.service.ts`**

Add an `internalJwt` config block:

```ts
readonly internalJwt = {
  issuer: process.env.INTERNAL_JWT_ISSUER || "api-center",
  audience: process.env.INTERNAL_JWT_AUDIENCE || "api-center",
  accessTtlSeconds: parseInt(
    process.env.INTERNAL_JWT_ACCESS_TTL_SECONDS || "3600",
    10,
  ),
  refreshTtlSeconds: parseInt(
    process.env.INTERNAL_JWT_REFRESH_TTL_SECONDS || "86400",
    10,
  ),
  privateKey: process.env.JWT_PRIVATE_KEY || "",
  publicKey: process.env.JWT_PUBLIC_KEY || "",
};
```

Update the provider allowlist:

```ts
const validProviders = [
  "descope",
  "dev-jwt",
  "internal-jwt",
  "composite",
];
```

Add production validation:

```ts
if (
  ["internal-jwt", "composite"].includes(this.authProvider) &&
  this.isProduction
) {
  if (!this.internalJwt.privateKey || !this.internalJwt.publicKey) {
    errors.push(
      "JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must be set for production internal JWT auth",
    );
  }
}
```

- [ ] **Step 3: Run config tests**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/config/config.service.spec.ts
```

Expected: existing tests pass or fail only where provider allowlist expectations need updating.

- [ ] **Step 4: Update config tests**

Add test coverage for:

```ts
process.env.AUTH_PROVIDER = "composite";
process.env.JWT_PRIVATE_KEY = "present";
process.env.JWT_PUBLIC_KEY = "present";
```

Expected assertion:

```ts
expect(config.authProvider).toBe("composite");
expect(config.internalJwt.issuer).toBeDefined();
```

Commit:

```powershell
git add src/config/config.service.ts src/config/config.service.spec.ts
git commit -m "feat: add internal jwt auth config"
```

---

## Phase 2: Internal JWT Provider

**Outcome:** API Center can issue and validate its own persistent RS256 tribe tokens.

- [ ] **Step 1: Create failing provider tests**

Create `api-center/src/auth/providers/internal-jwt.provider.spec.ts`.

Core tests:

```ts
it("issues a tribe access token with scopes and permissions", async () => {
  const provider = await createProviderWithGeneratedKeys();
  const issued = await provider.issueToken(
    "smoke-tribe",
    ["tribe:smoke-tribe:read"],
    ["geo:read"],
  );

  const claims = await provider.validateToken(issued.accessToken);

  expect(claims.sub).toBe("smoke-tribe");
  expect(claims.tribeId).toBe("smoke-tribe");
  expect(claims.permissions).toContain("tribe:smoke-tribe:read");
  expect(claims.scopes).toContain("geo:read");
  expect(issued.refreshToken).toBeTruthy();
});

it("rejects tokens with the wrong audience", async () => {
  const provider = await createProviderWithGeneratedKeys({
    audience: "api-center",
  });
  const token = await signTokenWithAudience("other-audience");

  await expect(provider.validateToken(token)).rejects.toThrow();
});
```

- [ ] **Step 2: Implement `InternalJwtProvider`**

Create `api-center/src/auth/providers/internal-jwt.provider.ts`.

Required behavior:

```ts
@Injectable()
export class InternalJwtProvider implements AuthProvider, OnModuleInit {
  async onModuleInit(): Promise<void> {
    this.privateKey = await importPKCS8(
      this.config.internalJwt.privateKey.replace(/\\n/g, "\n"),
      "RS256",
    );
    this.publicKey = await importSPKI(
      this.config.internalJwt.publicKey.replace(/\\n/g, "\n"),
      "RS256",
    );
    this.publicJwk = await exportJWK(this.publicKey);
    this.publicJwk.kid = "api-center-internal-1";
    this.publicJwk.use = "sig";
    this.publicJwk.alg = "RS256";
  }

  async issueToken(
    serviceId: string,
    permissions: string[],
    scopes: string[],
  ): Promise<IssuedToken> {
    const accessToken = await this.signJwt(
      { tribeId: serviceId, permissions, scopes, tokenType: "access" },
      serviceId,
      this.config.internalJwt.accessTtlSeconds,
    );
    const refreshToken = await this.signJwt(
      { tribeId: serviceId, tokenType: "refresh" },
      serviceId,
      this.config.internalJwt.refreshTtlSeconds,
    );
    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.internalJwt.accessTtlSeconds,
    };
  }
}
```

The final implementation must include:

```ts
.setIssuer(this.config.internalJwt.issuer)
.setAudience(this.config.internalJwt.audience)
.setIssuedAt()
.setExpirationTime(`${ttlSeconds}s`)
```

Validation must enforce:

```ts
issuer: this.config.internalJwt.issuer,
audience: this.config.internalJwt.audience,
algorithms: ["RS256"],
```

- [ ] **Step 3: Run provider tests**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/auth/providers/internal-jwt.provider.spec.ts
```

Expected: all internal provider tests pass.

Commit:

```powershell
git add src/auth/providers/internal-jwt.provider.ts src/auth/providers/internal-jwt.provider.spec.ts
git commit -m "feat: add internal jwt auth provider"
```

---

## Phase 3: Composite Auth Provider

**Outcome:** API Center can issue internal tribe tokens while still validating Descope tokens during migration.

- [ ] **Step 1: Create failing composite-provider tests**

Create `api-center/src/auth/providers/composite-auth.provider.spec.ts`.

Required tests:

```ts
it("issues tokens through the internal provider", async () => {
  const internal = mockInternalProvider();
  const descope = mockDescopeProvider();
  const provider = new CompositeAuthProvider(internal, descope);

  await provider.issueToken("smoke-tribe", ["read"], ["geo:read"]);

  expect(internal.issueToken).toHaveBeenCalledWith(
    "smoke-tribe",
    ["read"],
    ["geo:read"],
  );
  expect(descope.issueToken).not.toHaveBeenCalled();
});

it("validates internal tokens before falling back to Descope", async () => {
  const internal = mockInternalProvider({ validateTokenResult: { sub: "a" } });
  const descope = mockDescopeProvider();
  const provider = new CompositeAuthProvider(internal, descope);

  await expect(provider.validateToken("token")).resolves.toMatchObject({
    sub: "a",
  });
  expect(descope.validateToken).not.toHaveBeenCalled();
});

it("falls back to Descope validation when internal validation fails", async () => {
  const internal = mockInternalProvider({ validateTokenError: new Error("bad") });
  const descope = mockDescopeProvider({ validateTokenResult: { sub: "user" } });
  const provider = new CompositeAuthProvider(internal, descope);

  await expect(provider.validateToken("token")).resolves.toMatchObject({
    sub: "user",
  });
});
```

- [ ] **Step 2: Implement `CompositeAuthProvider`**

Create `api-center/src/auth/providers/composite-auth.provider.ts`.

Required behavior:

```ts
@Injectable()
export class CompositeAuthProvider implements AuthProvider {
  constructor(
    private readonly internalJwt: InternalJwtProvider,
    private readonly descope: DescopeProvider,
  ) {}

  issueToken(serviceId: string, permissions: string[], scopes: string[]) {
    return this.internalJwt.issueToken(serviceId, permissions, scopes);
  }

  async validateToken(token: string): Promise<JwtClaims> {
    try {
      return await this.internalJwt.validateToken(token);
    } catch (internalError) {
      return this.descope.validateToken(token);
    }
  }

  refreshToken(refreshToken: string) {
    return this.internalJwt.refreshToken(refreshToken);
  }

  getJwksJson() {
    return this.internalJwt.getJwksJson();
  }
}
```

- [ ] **Step 3: Wire `AuthModule`**

Modify `api-center/src/auth/auth.module.ts`.

Register:

```ts
import { InternalJwtProvider } from "./providers/internal-jwt.provider";
import { CompositeAuthProvider } from "./providers/composite-auth.provider";
```

Factory shape:

```ts
inject: [
  ConfigService,
  DescopeProvider,
  DevJwtProvider,
  InternalJwtProvider,
  CompositeAuthProvider,
],
useFactory: (
  config,
  descope,
  devJwt,
  internalJwt,
  composite,
) => {
  if (config.authProvider === "descope") return descope;
  if (config.authProvider === "internal-jwt") return internalJwt;
  if (config.authProvider === "composite") return composite;
  return devJwt;
}
```

- [ ] **Step 4: Run auth tests**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/auth/providers/internal-jwt.provider.spec.ts src/auth/providers/composite-auth.provider.spec.ts src/auth/auth.controller.spec.ts src/auth/auth.service.spec.ts
```

Expected: all pass.

Commit:

```powershell
git add src/auth
git commit -m "feat: route tribe auth through internal jwt provider"
```

---

## Phase 4: Secret Manager And Deployment Migration

**Outcome:** Production can issue tribe tokens without Descope client apps.

- [ ] **Step 1: Generate RS256 keys locally**

Use Node or OpenSSL and store PEM strings in a temporary local file outside git.

Example with OpenSSL:

```powershell
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out api-center-internal-jwt-private.pem
openssl rsa -pubout -in api-center-internal-jwt-private.pem -out api-center-internal-jwt-public.pem
```

- [ ] **Step 2: Add Secret Manager values**

Update `api-center-prod` with:

```json
{
  "AUTH_PROVIDER": "composite",
  "INTERNAL_JWT_ISSUER": "https://api-center.itsandbox.site",
  "INTERNAL_JWT_AUDIENCE": "api-center",
  "INTERNAL_JWT_ACCESS_TTL_SECONDS": "3600",
  "INTERNAL_JWT_REFRESH_TTL_SECONDS": "86400",
  "JWT_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----",
  "JWT_PUBLIC_KEY": "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----"
}
```

Keep:

```json
{
  "TRIBE_SECRET_SMOKE_TRIBE": "<sha256 hash>",
  "DESCOPE_PROJECT_ID": "<project id>",
  "DESCOPE_ISSUER": "<issuer>",
  "DESCOPE_AUDIENCE": "<audience>"
}
```

Remove only after validation:

```json
{
  "DESCOPE_CLIENT_SECRET_SMOKE_TRIBE": "<no longer needed>",
  "DESCOPE_DEFAULT_CLIENT_SECRET": "<no longer needed for tribe M2M>"
}
```

- [ ] **Step 3: Deploy API Center**

Run:

```powershell
cd C:\Codes\apic\api-center
npm run build
docker build -t us-central1-docker.pkg.dev/api-center-492808/api-center/api-center:<sha> .
docker push us-central1-docker.pkg.dev/api-center-492808/api-center/api-center:<sha>
kubectl -n api-center set image deployment/api-center api-center=us-central1-docker.pkg.dev/api-center-492808/api-center/api-center:<sha>
kubectl -n api-center rollout status deployment/api-center --timeout=5m
```

- [ ] **Step 4: Verify JWKS**

Run:

```powershell
Invoke-RestMethod https://api-center.itsandbox.site/api/v1/auth/.well-known/jwks.json
```

Expected:

```json
{
  "keys": [
    {
      "kty": "RSA",
      "kid": "api-center-internal-1",
      "alg": "RS256",
      "use": "sig"
    }
  ]
}
```

Commit deployment docs:

```powershell
git add docs/deployment-gke.md docs/apicenter-platform-setup.md
git commit -m "docs: document internal tribe token deployment"
```

---

## Phase 5: Management Console And Smoke Tests

**Outcome:** The local management smoke-test flow works without Descope per-tribe clients.

- [ ] **Step 1: Update smoke-test docs**

Modify `apicenter-management/docs/operations/local-smoke-testing.md`.

Replace Descope tribe app setup with:

```md
The smoke tribe needs only:

- Registry entry: `smoke-tribe`
- Secret Manager key: `TRIBE_SECRET_SMOKE_TRIBE=<sha256 hash>`
- API Center internal JWT keys configured once for the whole platform

No Descope Inbound App is required for `smoke-tribe` when `AUTH_PROVIDER=composite`
or `AUTH_PROVIDER=internal-jwt`.
```

- [ ] **Step 2: Update settings UI copy**

Modify `apicenter-management/src/app/settings/page.tsx`.

Required copy:

```text
Tribe M2M tokens are issued by API Center in internal JWT mode. Descope remains
for human identity and future console login. Do not create one Descope app per
tribe unless AUTH_PROVIDER=descope is explicitly enabled.
```

- [ ] **Step 3: Run management build**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm run build
```

Expected: build succeeds.

Commit:

```powershell
git add src/app/settings/page.tsx docs/operations/local-smoke-testing.md
git commit -m "docs: update management for internal tribe auth"
```

---

## Phase 6: Rollout And Backout

**Outcome:** Production migration is reversible and observable.

- [ ] **Step 1: Roll out with `AUTH_PROVIDER=composite` first**

This mode:

```text
Issue token -> API Center internal JWT
Validate token -> internal JWT first, Descope fallback second
```

This gives backward compatibility for any current Descope-issued tokens until they expire.

- [ ] **Step 2: Run local smoke token request**

Open:

```text
http://localhost:3000/smoke-tests?tribeId=smoke-tribe
```

Enter:

```text
tribeId = smoke-tribe
plaintext secret = original plaintext tribe secret
```

Expected:

```text
Token request succeeds.
Safe shared-service checks succeed.
No Descope /oauth2/v1/apps/token request appears in API Center logs.
```

- [ ] **Step 3: Verify live logs**

Run:

```powershell
kubectl -n api-center logs deployment/api-center --tail=200
```

Expected:

```text
Token issued
```

Not expected:

```text
DescopeProvider.issueToken
Request failed with status code 400
```

- [ ] **Step 4: Backout path**

If internal token validation fails unexpectedly:

```json
{
  "AUTH_PROVIDER": "descope"
}
```

Then restart:

```powershell
kubectl -n api-center rollout restart deployment/api-center
kubectl -n api-center rollout status deployment/api-center --timeout=5m
```

This returns to the current Descope-only behavior.

---

## Phase 7: Cleanup After Stability Window

**Outcome:** Remove redundant Descope M2M setup after internal auth has proven stable.

- [ ] **Step 1: Wait for old access tokens to expire**

Use the longest old access token TTL as the minimum waiting window. If old Descope tokens expire in one hour, wait at least one hour after the rollout.

- [ ] **Step 2: Remove per-tribe Descope M2M secrets**

Remove keys like:

```json
{
  "DESCOPE_CLIENT_ID_SMOKE_TRIBE": "<remove>",
  "DESCOPE_CLIENT_SECRET_SMOKE_TRIBE": "<remove>"
}
```

Keep Descope project keys only if user login or management-console login still uses Descope:

```json
{
  "DESCOPE_PROJECT_ID": "<keep>",
  "DESCOPE_ISSUER": "<keep>",
  "DESCOPE_AUDIENCE": "<keep>"
}
```

- [ ] **Step 3: Update onboarding docs**

Update tribe onboarding to say:

```md
New tribes do not need a Descope app for API Center M2M access.
Create a registry entry, create a plaintext tribe secret, store its SHA-256 hash
as `TRIBE_SECRET_<SERVICE_ID>`, then request `/api/v1/auth/token`.
```

Commit:

```powershell
git add docs/developer/tribe-onboarding.md docs/developer/shared-service-team-workflow.md
git commit -m "docs: remove descope app requirement for tribe onboarding"
```

---

## Verification Matrix

| Check | Command | Expected |
|---|---|---|
| API Center unit tests | `npm test -- src/auth/providers/internal-jwt.provider.spec.ts src/auth/providers/composite-auth.provider.spec.ts` | Pass |
| API Center build | `npm run build` | Pass |
| JWKS endpoint | `Invoke-RestMethod https://api-center.itsandbox.site/api/v1/auth/.well-known/jwks.json` | Contains `api-center-internal-1` |
| Token request | Management `/smoke-tests` | Succeeds without Descope M2M app |
| Safe smoke checks | Management `/smoke-tests` | Health, gauth authorize, geofence pass |
| Analytics | Management `/shared-services/usage` | Usage appears after proxy calls |
| Backward validation | Existing Descope admin token if available | Still valid in `AUTH_PROVIDER=composite` |

---

## Final Target Secret Shape

`api-center-prod` should contain:

```json
{
  "AUTH_PROVIDER": "composite",
  "PLATFORM_ADMIN_SECRET": "<existing platform admin secret>",
  "TRIBE_SECRET_SMOKE_TRIBE": "<sha256 hash of plaintext tribe secret>",
  "INTERNAL_JWT_ISSUER": "https://api-center.itsandbox.site",
  "INTERNAL_JWT_AUDIENCE": "api-center",
  "INTERNAL_JWT_ACCESS_TTL_SECONDS": "3600",
  "INTERNAL_JWT_REFRESH_TTL_SECONDS": "86400",
  "JWT_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----",
  "JWT_PUBLIC_KEY": "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----",
  "DESCOPE_PROJECT_ID": "<keep if human auth still uses Descope>",
  "DESCOPE_ISSUER": "<keep if human auth still uses Descope>",
  "DESCOPE_AUDIENCE": "<keep if human auth still uses Descope>"
}
```

Per-tribe Descope keys should not be required:

```json
{
  "DESCOPE_CLIENT_SECRET_SMOKE_TRIBE": "not needed in internal token mode"
}
```

---

## Risks

- Existing Descope-issued tokens may stop working if `AUTH_PROVIDER=internal-jwt` is used too early. Use `AUTH_PROVIDER=composite` first.
- API Center JWT keys must be persistent. Do not use generated in-memory keys in production.
- Key rotation needs a follow-up phase if tokens need zero-downtime rotation. The first version uses one active `kid`.
- If management-console auth later uses Descope, do not remove Descope project config.

---

## Execution Recommendation

Use `AUTH_PROVIDER=composite` for the first production rollout. After the system is stable and old Descope M2M tokens are gone, decide whether to keep composite mode for future human-auth compatibility or move to `AUTH_PROVIDER=internal-jwt` for pure internal service auth.


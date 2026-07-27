import { afterEach, describe, expect, it } from "vitest";
import {
  getSecretManagerAuthReadiness,
  shouldUseLocalGcloudImpersonation,
} from "../../../../../src/lib/server/gcp-secret-manager";

const originalEnv = { ...process.env };

describe("gcp secret manager auth selection", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("does not use local gcloud impersonation in a deployed Vercel OIDC runtime", () => {
    process.env.VERCEL = "1";
    process.env.GCP_PROJECT_NUMBER = "684000639729";
    process.env.GCP_SERVICE_ACCOUNT_EMAIL =
      "apicenter-mgmt-provisioner@api-center-496422.iam.gserviceaccount.com";
    process.env.GCP_WORKLOAD_IDENTITY_POOL_ID = "vercel";
    process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID = "vercel";
    process.env.GCP_IMPERSONATE_SERVICE_ACCOUNT =
      "apicenter-mgmt-provisioner@api-center-496422.iam.gserviceaccount.com";

    expect(shouldUseLocalGcloudImpersonation()).toBe(false);
    expect(getSecretManagerAuthReadiness()).toEqual({ ok: true });
  });

  it("uses local gcloud impersonation in local development even if OIDC env is copied", () => {
    process.env.VERCEL = undefined;
    process.env.MANAGEMENT_PUBLIC_BASE_URL = "http://localhost:3000";
    process.env.GCP_PROJECT_NUMBER = "684000639729";
    process.env.GCP_SERVICE_ACCOUNT_EMAIL =
      "apicenter-mgmt-provisioner@api-center-496422.iam.gserviceaccount.com";
    process.env.GCP_WORKLOAD_IDENTITY_POOL_ID = "vercel";
    process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID = "vercel";
    process.env.GCP_IMPERSONATE_SERVICE_ACCOUNT =
      "apicenter-mgmt-provisioner@api-center-496422.iam.gserviceaccount.com";

    expect(shouldUseLocalGcloudImpersonation()).toBe(true);
    expect(getSecretManagerAuthReadiness()).toEqual({ ok: true });
  });
});

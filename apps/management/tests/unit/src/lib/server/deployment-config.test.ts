import { describe, expect, it } from "vitest";
import {
  getDeploymentConfigCheck,
  isDeployedRuntime,
} from "../../../../../src/lib/server/deployment-config";

const completeEnv = {
  API_CENTER_BASE_URL: "https://api-center.itsandbox.site",
  API_CENTER_PLATFORM_ADMIN_SECRET: "server-secret",
  NEXT_PUBLIC_API_CENTER_BASE_URL: "https://api-center.itsandbox.site",
  MANAGEMENT_AUTH_MODE: "google",
  MANAGEMENT_ENVIRONMENT: "test",
  NEXT_PUBLIC_MANAGEMENT_ENV: "test",
  MANAGEMENT_PUBLIC_BASE_URL:
    "https://api-center-management-test.itsandbox.site",
  NEXT_PUBLIC_KAFKA_TOPIC_PREFIX: "test",
  GOOGLE_CLOUD_PROJECT: "api-center-496422",
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
  GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
  GCP_PROJECT_NUMBER: "684000639729",
  GCP_SERVICE_ACCOUNT_EMAIL:
    "apicenter-mgmt-provisioner@api-center-496422.iam.gserviceaccount.com",
  GCP_WORKLOAD_IDENTITY_POOL_ID: "vercel",
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "vercel",
  CONFLUENT_ENVIRONMENT_ID: "env-123",
  CONFLUENT_KAFKA_CLUSTER_ID: "lkc-123",
  CONFLUENT_KAFKA_REST_ENDPOINT: "https://cluster.example.com",
  CONFLUENT_KAFKA_API_KEY: "kafka-key",
  CONFLUENT_KAFKA_API_SECRET: "kafka-secret",
  CONFLUENT_CLOUD_API_KEY: "cloud-key",
  CONFLUENT_CLOUD_API_SECRET: "cloud-secret",
  CONFLUENT_S3_CONNECTOR_NAME: "api-center-test-s3-sink",
  CONFLUENT_DEFAULT_RETENTION_MS: "604800000",
};

describe("deployment config check", () => {
  it("detects a deployed local-dev runtime and marks it blocked", () => {
    const check = getDeploymentConfigCheck({
      ...completeEnv,
      VERCEL: "1",
      MANAGEMENT_AUTH_MODE: "local-dev",
    });

    expect(check.isDeployed).toBe(true);
    expect(check.authMode).toBe("local-dev");
    expect(check.deployedLocalDevBlocked).toBe(true);
  });

  it("accepts a deployed Google auth runtime with Vercel OIDC config", () => {
    const check = getDeploymentConfigCheck({
      ...completeEnv,
      VERCEL: "1",
    });

    expect(check.isDeployed).toBe(true);
    expect(check.authMode).toBe("google");
    expect(check.managementEnvironment).toBe("test");
    expect(check.secretManagerAuthMode).toBe("vercel-oidc");
    expect(check.deployedLocalDevBlocked).toBe(false);
    expect(check.missingEnv).toEqual([]);
  });

  it("prefers Vercel OIDC over local gcloud impersonation when deployed", () => {
    const check = getDeploymentConfigCheck({
      ...completeEnv,
      VERCEL: "1",
      GCP_IMPERSONATE_SERVICE_ACCOUNT:
        "apicenter-mgmt-provisioner@api-center-496422.iam.gserviceaccount.com",
    });

    expect(check.secretManagerAuthMode).toBe("vercel-oidc");
  });

  it("uses local gcloud impersonation before Vercel OIDC config on localhost", () => {
    const check = getDeploymentConfigCheck({
      ...completeEnv,
      MANAGEMENT_PUBLIC_BASE_URL: "http://localhost:3000",
      VERCEL: undefined,
      GCP_IMPERSONATE_SERVICE_ACCOUNT:
        "apicenter-mgmt-provisioner@api-center-496422.iam.gserviceaccount.com",
    });

    expect(check.isDeployed).toBe(false);
    expect(check.secretManagerAuthMode).toBe("local-impersonation");
  });

  it("does not treat localhost as deployed", () => {
    expect(
      isDeployedRuntime({
        MANAGEMENT_PUBLIC_BASE_URL: "http://localhost:3000",
      }),
    ).toBe(false);
  });

  it("reports missing deployed env vars without returning secret values", () => {
    const check = getDeploymentConfigCheck({
      VERCEL: "1",
      API_CENTER_PLATFORM_ADMIN_SECRET: "server-secret",
      CONFLUENT_KAFKA_API_SECRET: "kafka-secret",
    });
    const serialized = JSON.stringify(check);

    expect(check.missingEnv).toContain("API_CENTER_BASE_URL");
    expect(check.missingEnv).toContain("MANAGEMENT_PUBLIC_BASE_URL");
    expect(serialized).not.toContain("server-secret");
    expect(serialized).not.toContain("kafka-secret");
  });

  it("reports one Management deployment managing test and live through one API Center URL", () => {
    const check = getDeploymentConfigCheck({
      ...completeEnv,
      VERCEL: "1",
      MANAGEMENT_ENVIRONMENT: "test",
      NEXT_PUBLIC_MANAGEMENT_ENV: "test",
      API_CENTER_BASE_URL: "https://api-center.itsandbox.site/",
      NEXT_PUBLIC_API_CENTER_BASE_URL: "https://api-center.itsandbox.site",
    });

    expect(check.apiCenterBaseUrl).toBe("https://api-center.itsandbox.site/");
    expect(check.publicApiCenterBaseUrl).toBe(
      "https://api-center.itsandbox.site",
    );
    expect(check.oneApiCenterTopology).toEqual({
      usesSingleApiCenterBaseUrl: true,
      managedTargetEnvironments: ["test", "live"],
    });
  });

  it("flags split API Center URLs as not one-URL topology", () => {
    const check = getDeploymentConfigCheck({
      ...completeEnv,
      API_CENTER_BASE_URL: "https://api-center-test.itsandbox.site",
      NEXT_PUBLIC_API_CENTER_BASE_URL: "https://api-center.itsandbox.site",
    });

    expect(check.oneApiCenterTopology.usesSingleApiCenterBaseUrl).toBe(false);
  });
});

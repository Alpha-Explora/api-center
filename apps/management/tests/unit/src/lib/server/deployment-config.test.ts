import { describe, expect, it } from "vitest";
import { getDeploymentConfigCheck, isDeployedRuntime } from "../../../../../src/lib/server/deployment-config";

const completeEnv = {
  API_CENTER_BASE_URL: "https://api.apicenter.itsandbox.site",
  API_CENTER_PLATFORM_ADMIN_SECRET: "server-secret",
  NEXT_PUBLIC_API_CENTER_BASE_URL: "https://api.apicenter.itsandbox.site",
  MANAGEMENT_AUTH_MODE: "google",
  MANAGEMENT_ENVIRONMENT: "test",
  NEXT_PUBLIC_MANAGEMENT_ENV: "test",
  MANAGEMENT_PUBLIC_BASE_URL: "https://api-center-management-test.itsandbox.site",
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
};

describe("deployment config check", () => {
  it("accepts a complete deployed Google sign-in configuration", () => {
    const check = getDeploymentConfigCheck({ ...completeEnv, K_SERVICE: "apicenter-management-test" });
    expect(check).toMatchObject({ isDeployed: true, authMode: "google", deployedLocalDevBlocked: false, managementEnvironment: "test", missingEnv: [] });
  });

  it("detects a deployed local-dev runtime and marks it blocked", () => {
    const check = getDeploymentConfigCheck({ ...completeEnv, K_SERVICE: "apicenter-management-test", MANAGEMENT_AUTH_MODE: "local-dev" });
    expect(check.isDeployed).toBe(true);
    expect(check.authMode).toBe("local-dev");
    expect(check.deployedLocalDevBlocked).toBe(true);
  });

  it("treats Cloud Run as deployed even without a public base URL", () => {
    const check = getDeploymentConfigCheck({ K_SERVICE: "apicenter-management-test", MANAGEMENT_AUTH_MODE: "local-dev" });
    expect(check.isDeployed).toBe(true);
    expect(check.deployedLocalDevBlocked).toBe(true);
  });

  it("does not treat localhost as deployed", () => {
    expect(isDeployedRuntime({ MANAGEMENT_PUBLIC_BASE_URL: "http://localhost:3000" })).toBe(false);
  });

  it("reports missing deployed env vars without returning secret values", () => {
    const check = getDeploymentConfigCheck({ K_SERVICE: "apicenter-management-test", API_CENTER_PLATFORM_ADMIN_SECRET: "server-secret" });
    expect(check.missingEnv).toContain("API_CENTER_BASE_URL");
    expect(check.missingEnv).toContain("MANAGEMENT_PUBLIC_BASE_URL");
    expect(JSON.stringify(check)).not.toContain("server-secret");
  });
});

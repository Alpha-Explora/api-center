import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getManagementTargetEnvironments,
  isDataPipelineEnabled,
  isOneApiCenterTopologyEnabled,
} from "../../../../src/lib/feature-flags";

describe("feature flags", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults data pipeline to disabled", () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_PIPELINE_ENABLED", "");
    vi.stubEnv("DATA_PIPELINE_ENABLED", "");

    expect(isDataPipelineEnabled()).toBe(false);
  });

  it("enables data pipeline when explicitly requested for the browser bundle", () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_PIPELINE_ENABLED", "true");

    expect(isDataPipelineEnabled()).toBe(true);
  });

  it("enables data pipeline when explicitly requested for server routes", () => {
    vi.stubEnv("DATA_PIPELINE_ENABLED", "true");

    expect(isDataPipelineEnabled()).toBe(true);
  });

  it("exposes test and live as target environments for one Management deployment", () => {
    expect(getManagementTargetEnvironments()).toEqual(["test", "live"]);
  });

  it("detects one-URL API Center topology from matching server and public URLs", () => {
    expect(
      isOneApiCenterTopologyEnabled({
        apiCenterBaseUrl: "https://api-center.itsandbox.site/",
        publicApiCenterBaseUrl: "https://api-center.itsandbox.site",
      }),
    ).toBe(true);
  });

  it("does not treat split API Center URLs as one-URL topology", () => {
    expect(
      isOneApiCenterTopologyEnabled({
        apiCenterBaseUrl: "https://api-center-test.itsandbox.site",
        publicApiCenterBaseUrl: "https://api-center.itsandbox.site",
      }),
    ).toBe(false);
  });
});

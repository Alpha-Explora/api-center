const request = jest.fn();
jest.mock("google-auth-library", () => ({
  GoogleAuth: jest.fn().mockImplementation(() => ({ request })),
}));
import { RuntimeDeploymentObserver } from "@operations/runtime-deployment-observer.service";
import type { ServiceRegistryEntry } from "../../../../apps/gateway/src/types";
const entry: ServiceRegistryEntry = {
  serviceId: "billing-api",
  name: "Billing",
  baseUrl: "https://billing.example.run.app",
  projectId: "billing",
  requiredScopes: [],
  exposes: [],
  consumes: [],
  status: "active",
  registeredAt: "2026-11-13T00:00:00Z",
  updatedAt: "2026-11-13T00:00:00Z",
  environments: [
    { environment: "live", baseUrl: "https://billing.example.run.app" },
  ],
};
describe("current runtime deployment identity", () => {
  const previous = process.env.APICENTER_VERIFICATION_DEPLOYMENTS;
  beforeEach(() => {
    request.mockReset();
    process.env.APICENTER_VERIFICATION_DEPLOYMENTS = JSON.stringify([
      {
        serviceId: entry.serviceId,
        environment: "live",
        project: "project-id",
        region: "asia-southeast1",
        service: "billing",
      },
    ]);
  });
  afterAll(() => {
    if (previous === undefined)
      delete process.env.APICENTER_VERIFICATION_DEPLOYMENTS;
    else process.env.APICENTER_VERIFICATION_DEPLOYMENTS = previous;
  });
  it("uses the serving revision and immutable image digest", async () => {
    request
      .mockResolvedValueOnce({
        data: {
          status: {
            url: entry.baseUrl,
            latestReadyRevisionName: "billing-1",
            traffic: [{ revisionName: "billing-1", percent: 100 }],
          },
        },
      })
      .mockResolvedValueOnce({
        data: { status: { imageDigest: "image@sha256:" + "a".repeat(64) } },
      });
    expect(
      await new RuntimeDeploymentObserver().observe([entry], "live"),
    ).toMatchObject({
      complete: true,
      deployments: [{ serviceId: entry.serviceId, revision: "billing-1" }],
    });
  });
  it("does not treat split traffic, wrong routing, missing identity, or failed APIs as current", async () => {
    for (const status of [
      {
        url: entry.baseUrl,
        latestReadyRevisionName: "billing-2",
        traffic: [{ revisionName: "billing-1", percent: 100 }],
      },
      {
        url: "https://other.example.run.app",
        latestReadyRevisionName: "billing-1",
        traffic: [{ revisionName: "billing-1", percent: 100 }],
      },
    ]) {
      request.mockResolvedValueOnce({ data: { status } });
      expect(
        (await new RuntimeDeploymentObserver().observe([entry], "live"))
          .complete,
      ).toBe(false);
    }
    request.mockRejectedValueOnce(new Error("IAM unavailable"));
    expect(
      (await new RuntimeDeploymentObserver().observe([entry], "live")).complete,
    ).toBe(false);
  });
});

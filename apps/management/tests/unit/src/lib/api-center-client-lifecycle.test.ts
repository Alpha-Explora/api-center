import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlatformLifecycleEvidence, setManagementSessionToken } from "../../../../src/lib/api-center-client";

describe("api-center-client platform lifecycle", () => {
  afterEach(() => {
    setManagementSessionToken(undefined);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fetches and parses source-backed lifecycle evidence", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        data: {
          generatedAt: "2026-06-14T02:00:00.000Z",
          summary: {
            total: 1,
            blocked: 0,
            attention: 0,
            ready: 1,
          },
          entries: [
            {
              service: {
                serviceId: "student-api",
                name: "Student API",
                baseUrl: "https://students.example.test",
                requiredScopes: ["students:read"],
                exposes: ["/students"],
                consumes: [],
                ownerTribeId: "campus-one",
                serviceType: "tribe",
                healthCheck: "/health",
                version: "1.0.0",
                tags: [],
                ownerTeam: "Campus",
                contact: "campus@example.test",
                serviceTier: "standard",
                registeredAt: "2026-06-01T00:00:00.000Z",
                updatedAt: "2026-06-14T00:00:00.000Z",
                status: "active",
              },
              ownerTribeId: "campus-one",
              status: "ready",
              stages: [
                {
                  id: "promotion",
                  label: "Promotion",
                  status: "complete",
                  evidence: "Approved request approval-1.",
                  source: "approval-request",
                  action: "Review live promotion gates.",
                  href: "/promotions",
                },
              ],
              blockedCount: 0,
              attentionCount: 0,
              nextAction: {
                stageId: "registry",
                label: "Open the service detail record.",
                href: "/tribes/student-api",
              },
            },
          ],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPlatformLifecycleEvidence()).resolves.toMatchObject({
      summary: { ready: 1 },
      entries: [
        {
          stages: [expect.objectContaining({ source: "approval-request" })],
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/local/operations/lifecycle",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});

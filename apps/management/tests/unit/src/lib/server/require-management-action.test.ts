import { describe, expect, it } from "vitest";
import {
  requireManagementAction,
  requireManagementRouteAction,
} from "../../../../../src/lib/server/require-management-action";

describe("requireManagementAction", () => {
  it("returns action context for allowed test writes", async () => {
    const context = await requireManagementAction({
      session: {
        userId: "local-dev",
        email: "local-dev@api-center.internal",
        role: "admin",
        platformAdmin: true,
        source: "local-dev",
      },
      environment: "test",
      actionRisk: "state-write",
      actionId: "tribe.create",
    });

    expect(context.audit).toMatchObject({
      actionId: "tribe.create",
      operatorEmail: "local-dev@api-center.internal",
      environment: "test",
      actionRisk: "state-write",
    });
  });

  it("blocks live writes for operators", async () => {
    await expect(
      requireManagementAction({
        session: {
          userId: "user-1",
          email: "ops@example.com",
          role: "operator",
          platformAdmin: false,
          source: "google",
        },
        environment: "live",
        actionRisk: "state-write",
        actionId: "tribe.create",
      }),
    ).rejects.toThrow("live write actions require admin role");
  });

  it("blocks observer write actions", async () => {
    await expect(
      requireManagementAction({
        session: {
          userId: "viewer-1",
          email: "viewer@example.com",
          role: "observer",
          platformAdmin: false,
          source: "google",
        },
        environment: "test",
        actionRisk: "state-write",
        actionId: "tribe.create",
      }),
    ).rejects.toThrow("observer cannot perform state-write actions");
  });

  it("blocks live destructive actions for operators", async () => {
    await expect(
      requireManagementAction({
        session: {
          userId: "operator-1",
          email: "operator@example.com",
          role: "operator",
          platformAdmin: false,
          source: "google",
        },
        environment: "live",
        actionRisk: "destructive",
        actionId: "deployment.restart",
        typedPhrase: "APPLY LIVE CHANGE",
        reason: "Emergency restart approved.",
      }),
    ).rejects.toThrow("live write actions require admin role");
  });

  it("allows live destructive actions for admins after confirmation", async () => {
    const context = await requireManagementAction({
      session: {
        userId: "admin-1",
        email: "admin@example.com",
        role: "admin",
        platformAdmin: true,
        source: "google",
      },
      environment: "live",
      actionRisk: "destructive",
      actionId: "deployment.restart",
      typedPhrase: "APPLY LIVE CHANGE",
      reason: "Emergency restart approved.",
    });

    expect(context.audit).toMatchObject({
      actionId: "deployment.restart",
      operatorRole: "admin",
      reason: "Emergency restart approved.",
    });
  });

  it("reads live confirmation from a route request body", async () => {
    const request = new Request("https://management.local/api/local/test", {
      method: "POST",
      body: JSON.stringify({
        confirmation: {
          typedPhrase: "APPLY LIVE CHANGE",
          reason: "Provision approved by platform owner.",
        },
      }),
      headers: {
        "content-type": "application/json",
      },
    });

    const context = await requireManagementRouteAction({
      request,
      actionRisk: "state-write",
      actionId: "tribe.create",
    });

    expect(context.audit.reason).toBe("Provision approved by platform owner.");
  });
  it("uses targetEnvironment from the route body instead of MANAGEMENT_ENVIRONMENT", async () => {
    const previous = process.env.MANAGEMENT_ENVIRONMENT;
    process.env.MANAGEMENT_ENVIRONMENT = "test";
    try {
      const request = new Request("https://management.local/api/local/test", {
        method: "POST",
        body: JSON.stringify({
          targetEnvironment: "live",
          confirmation: {
            typedPhrase: "APPLY LIVE CHANGE",
            reason: "Live route change approved.",
          },
        }),
        headers: {
          "content-type": "application/json",
        },
      });

      const context = await requireManagementRouteAction({
        request,
        actionRisk: "state-write",
        actionId: "shared-service.route.update",
      });

      expect(context.audit).toMatchObject({
        environment: "live",
        actionId: "shared-service.route.update",
        reason: "Live route change approved.",
      });
    } finally {
      if (previous === undefined) {
        delete process.env.MANAGEMENT_ENVIRONMENT;
      } else {
        process.env.MANAGEMENT_ENVIRONMENT = previous;
      }
    }
  });
});

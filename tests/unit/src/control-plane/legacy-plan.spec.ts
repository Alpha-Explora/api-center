import { legacyRouteToPattern, planDigest, planMigration, type LegacySnapshot, type LegacyService } from "../../../../apps/gateway/src/domains/control-plane/migration/legacy-plan";

const ORG = "6f1c1d1e-0000-4000-8000-000000000301";

function service(overrides: Partial<LegacyService> & Pick<LegacyService, "serviceId">): LegacyService {
  return {
    name: overrides.serviceId,
    serviceType: "tribe",
    status: "active",
    requiredScopes: [],
    exposes: [],
    environments: [{ environment: "test", baseUrl: `https://${overrides.serviceId}.example.com` }],
    ...overrides,
  };
}

/**
 * Legacy world: tribe "commerce" owns projects "shop" and "billing".
 * - shop-api consumes email; its sibling shop-worker exposes routes (sibling access).
 * - billing-api (other project) has an approved subscription to shop-worker.
 * - shop-api is a payment consumer with a read-only key.
 * - other-org-api belongs to a tribe of another organization.
 */
function snapshot(overrides: Partial<LegacySnapshot> = {}): LegacySnapshot {
  const services: LegacyService[] = [
    service({ serviceId: "shop-api", projectId: "shop", ownerTribeId: "commerce", consumes: undefined } as never),
    service({ serviceId: "shop-worker", projectId: "shop", ownerTribeId: "commerce", exposes: ["/jobs", "/jobs/:jobId"] }),
    service({ serviceId: "billing-api", projectId: "billing", ownerTribeId: "commerce" }),
    service({ serviceId: "email", serviceType: "shared", requiredScopes: ["email:send"] }),
    service({ serviceId: "other-org-api", projectId: "elsewhere", ownerTribeId: "other", exposes: ["/x"] }),
  ];
  const access = new Set(["shop-api->email", "shop-api->shop-worker", "shop-worker->shop-api", "billing-api->shop-worker"]);
  return {
    organizationId: ORG,
    tribes: [{ tribeId: "commerce", name: "Commerce", status: "active" }],
    projects: [
      { projectId: "shop", tribeId: "commerce", name: "Shop", status: "active" },
      { projectId: "billing", tribeId: "commerce", name: "Billing", status: "active" },
    ],
    services,
    canAccess: (source, target) => access.has(`${source}->${target}`),
    tokenScopes: (id) => (id === "shop-api" ? ["email:send"] : []),
    paymentConsumers: [{ ownerTribeId: "commerce", consumerServiceId: "shop-api", environment: "test", status: "active", scopes: ["payments:read"] }],
    planAssignments: [{ ownerTribeId: "commerce", projectId: "shop", environment: "test", planKey: "standard", status: "active" }],
    quotaPolicies: [
      { id: "q-ceiling", ownerTribeId: "commerce", projectId: null, scope: "all", targetServiceId: null, windowSeconds: 86400, maxRequests: 5000, burstRequests: null, mode: "enforce", status: "active" },
      { id: "q-shop", ownerTribeId: "commerce", projectId: "shop", scope: "shared", targetServiceId: null, windowSeconds: 60, maxRequests: 100, burstRequests: 120, mode: "observe", status: "active" },
    ],
    merchantBound: true,
    ...overrides,
  };
}

function application(plan: ReturnType<typeof planMigration>, projectId: string, serviceId: string) {
  return plan.projects.find((p) => p.legacyProjectId === projectId)!.environments[0].applications.find((a) => a.legacyServiceId === serviceId)!;
}

describe("planMigration", () => {
  const plan = planMigration(snapshot());

  it("maps projects and tribes, with no inferred team members", () => {
    expect(plan.projects.map((p) => p.legacyProjectId)).toEqual(["shop", "billing"]);
    expect(plan.teams).toEqual([{ tribeId: "commerce", slug: "commerce", name: "Commerce" }]);
    expect(plan.projects.find((p) => p.legacyProjectId === "elsewhere")).toBeUndefined();
  });

  it("snapshots shared-service access as every catalogued action of the capability", () => {
    const grants = application(plan, "shop", "shop-api").grants.filter((g) => g.target === "email");
    expect(grants.map((g) => g.action)).toEqual(["email:read", "email:send"]);
  });

  it("turns sibling access into a grant on the sibling's published API", () => {
    expect(application(plan, "shop", "shop-api").grants).toContainEqual({ targetKind: "api", target: "shop-worker", action: "shop-worker:call" });
    const api = plan.projects[0].environments[0].apis[0];
    expect(api).toMatchObject({ legacyServiceId: "shop-worker", upstreamUrl: "https://shop-worker.example.com" });
    expect(api.operations).toContainEqual({ method: "GET", path: "/jobs/{jobId}", action: "shop-worker:call" });
  });

  it("carries approved cross-project access", () => {
    expect(application(plan, "billing", "billing-api").grants).toEqual([{ targetKind: "api", target: "shop-worker", action: "shop-worker:call" }]);
  });

  it("grants payment read actions for a read-only payment key, and nothing more", () => {
    const actions = application(plan, "shop", "shop-api").grants.filter((g) => g.target === "payments").map((g) => g.action);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((action) => action.endsWith(":read"))).toBe(true);
  });

  it("takes payment access from the consumer registration when the registry names the service 'payment'", () => {
    const base = snapshot();
    const withPaymentService = planMigration({
      ...base,
      services: [...base.services, service({ serviceId: "payment", serviceType: "shared" })],
      canAccess: (source, target) => target === "payment" || base.canAccess(source, target, "test"),
    });
    expect(withPaymentService.blockers.filter((b) => b.reason.includes("payment"))).toEqual([]);
    const actions = application(withPaymentService, "shop", "shop-api").grants.filter((g) => g.target === "payments").map((g) => g.action);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((action) => action.endsWith(":read"))).toBe(true);
  });

  it("does not grant what legacy did not allow", () => {
    expect(application(plan, "shop", "shop-worker").grants).toEqual([]);
  });

  it("carries plans, project quotas and tribe ceilings over exactly the tribe's projects", () => {
    const shopTest = plan.projects[0].environments[0];
    expect(shopTest.planKey).toBe("standard");
    expect(shopTest.quotaPolicies).toEqual([{ legacyPolicyId: "q-shop", capability: null, windowSeconds: 60, maxRequests: 120, mode: "observe" }]);
    expect(plan.sharedCeilings).toEqual([
      expect.objectContaining({ legacyPolicyId: "q-ceiling", environmentKind: "test", legacyProjectIds: ["shop", "billing"], maxRequests: 5000 }),
    ]);
    expect(plan.approximations.map((a) => a.legacyId)).toEqual(expect.arrayContaining(["shop-worker", "q-shop"]));
  });

  it("blocks instead of widening when access cannot be represented", () => {
    const blocked = planMigration(
      snapshot({
        services: [...snapshot().services, service({ serviceId: "fax", serviceType: "shared" })],
        canAccess: (source, target) => source === "shop-api" && (target === "fax" || target === "other-org-api"),
        merchantBound: false,
      }),
    );
    expect(blocked.blockers.map((b) => b.reason)).toEqual(
      expect.arrayContaining([
        "access to shared service 'fax' has no catalogued capability",
        "access to 'other-org-api' outside this organization cannot be granted",
        "payment consumer in an organization without a merchant binding",
      ]),
    );
  });

  it("produces a stable revision that changes with the source", () => {
    expect(planDigest(planMigration(snapshot()))).toBe(planDigest(plan));
    expect(planDigest(planMigration(snapshot({ paymentConsumers: [] })))).not.toBe(planDigest(plan));
  });

  it("converts legacy route patterns", () => {
    expect(legacyRouteToPattern("/orders/:orderId/items")).toBe("/orders/{orderId}/items");
    expect(legacyRouteToPattern("GET /orders")).toBe("/orders");
    expect(legacyRouteToPattern("/files/*")).toBeUndefined();
  });
});

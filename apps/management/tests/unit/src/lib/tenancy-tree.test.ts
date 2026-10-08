import { describe, expect, it } from "vitest";
import { buildTenancyTree } from "@/lib/tenancy-tree";
import type { ServiceRegistryEntry, TenancyTribe } from "@/lib/schemas";

const timestamps = {
  createdAt: "2026-10-08T00:00:00.000Z",
  updatedAt: "2026-10-08T00:00:00.000Z",
};

const tribes: TenancyTribe[] = [
  {
    tribeId: "logistics",
    name: "Logistics",
    status: "active",
    ...timestamps,
    projects: [
      { projectId: "logistics-core", tribeId: "logistics", name: "Core", status: "active", ...timestamps },
      { projectId: "logistics-billing", tribeId: "logistics", name: "Billing", status: "active", ...timestamps },
    ],
  },
];

function service(
  serviceId: string,
  overrides: Partial<ServiceRegistryEntry> = {},
): ServiceRegistryEntry {
  return {
    serviceId,
    name: serviceId,
    baseUrl: `https://${serviceId}.example.test`,
    requiredScopes: [],
    exposes: ["/health"],
    consumes: [],
    serviceType: "tribe",
    version: "1.0.0",
    tags: [],
    serviceTier: "standard",
    status: "active",
    ...timestamps,
    registeredAt: timestamps.createdAt,
    ...overrides,
  };
}

describe("buildTenancyTree", () => {
  it("nests services under their project and counts them per tribe", () => {
    const tree = buildTenancyTree(tribes, [
      service("orders", { projectId: "logistics-core", ownerTribeId: "logistics" }),
      service("invoices", { projectId: "logistics-billing", ownerTribeId: "logistics" }),
      service("payment", { serviceType: "shared" }),
    ]);

    const [logistics] = tree.tribes;
    expect(logistics?.serviceCount).toBe(2);
    expect(
      logistics?.projects.map((project) => [
        project.projectId,
        project.registryServices.map((entry) => entry.serviceId),
      ]),
    ).toEqual([
      ["logistics-core", ["orders"]],
      ["logistics-billing", ["invoices"]],
    ]);
    expect(tree.shared.map((entry) => entry.serviceId)).toEqual(["payment"]);
    expect(tree.unplaced).toEqual([]);
  });

  it("surfaces tribe services with a missing or unknown project as unplaced", () => {
    const tree = buildTenancyTree(tribes, [
      service("legacy-root"),
      service("ghost", { projectId: "deleted-project" }),
    ]);

    expect(tree.unplaced.map((entry) => entry.serviceId)).toEqual([
      "legacy-root",
      "ghost",
    ]);
    expect(tree.tribes[0]?.serviceCount).toBe(0);
  });
});

import { TenancyController } from "../../../../apps/gateway/src/domains/catalog-registry/registry/tenancy.controller";

describe("TenancyController organization filtering", () => {
  it("returns only tribes and projects owned by the requested organizations", () => {
    const tenancy = {
      listTribes: jest.fn(() => [
        { tribeId: "tribe-a", organizationId: "org-a", name: "A", status: "active", createdAt: "", updatedAt: "" },
        { tribeId: "tribe-b", organizationId: "org-b", name: "B", status: "active", createdAt: "", updatedAt: "" },
        { tribeId: "tribe-unresolved", name: "Unknown", status: "active", createdAt: "", updatedAt: "" },
      ]),
      listProjects: jest.fn(({ tribeId }: { tribeId?: string }) =>
        tribeId === "tribe-a"
          ? [{ projectId: "project-a", tribeId, name: "A Project", status: "active", createdAt: "", updatedAt: "" }]
          : [{ projectId: "project-b", tribeId: "tribe-b", name: "B Project", status: "active", createdAt: "", updatedAt: "" }],
      ),
    };
    const registry = { getProjectServices: jest.fn(() => []) };
    const controller = new TenancyController(tenancy as never, registry as never, {} as never);

    const response = controller.listTribes("org-a", {} as never);

    expect(response.data.map(({ tribeId }) => tribeId)).toEqual(["tribe-a"]);
    expect(response.data[0]?.projects.map(({ projectId }) => projectId)).toEqual(["project-a"]);
  });

  it("does not return unowned rows for a scoped request", () => {
    const tenancy = {
      listTribes: jest.fn(() => [
        { tribeId: "tribe-unresolved", name: "Unknown", status: "active", createdAt: "", updatedAt: "" },
      ]),
      listProjects: jest.fn(() => []),
    };
    const controller = new TenancyController(tenancy as never, { getProjectServices: jest.fn() } as never, {} as never);

    expect(controller.listTribes("org-a", {} as never).data).toEqual([]);
  });
});

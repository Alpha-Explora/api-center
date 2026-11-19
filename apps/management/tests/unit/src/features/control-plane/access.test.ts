import { describe, expect, it } from "vitest";
import { accessFrom } from "@/features/control-plane/model/access";

const member = (organizationRole: string, projectRoles: Record<string, string> = {}) => ({
  actor: { kind: "member", email: "dana@example.test" },
  platformAccess: false,
  organizationRole,
  projectRoles,
});

describe("console access", () => {
  it("treats organization owners and admins as admins of every project", () => {
    const access = accessFrom(member("admin"));
    expect(access.projectRole("prj_any")).toBe("admin");
    expect(access.canWriteEnvironment("prj_any", "live")).toBe(true);
    expect(access.canManageMembers).toBe(true);
    expect(access.canManageOwners).toBe(false);
  });

  it("lets a project developer change test but not live", () => {
    const access = accessFrom(member("developer", { prj_a: "developer" }));
    expect(access.canWriteEnvironment("prj_a", "test")).toBe(true);
    expect(access.canWriteEnvironment("prj_a", "live")).toBe(false);
    expect(access.canManageProject("prj_a")).toBe(false);
    expect(access.canCreateProject).toBe(true);
    expect(access.canManageMembers).toBe(false);
  });

  it("gives no project access without a project role", () => {
    const access = accessFrom(member("developer"));
    expect(access.projectRole("prj_b")).toBeNull();
    expect(access.canWriteEnvironment("prj_b", "test")).toBe(false);
  });

  it("keeps viewers read-only", () => {
    const access = accessFrom(member("viewer", { prj_a: "viewer" }));
    expect(access.canCreateProject).toBe(false);
    expect(access.canWriteEnvironment("prj_a", "test")).toBe(false);
  });

  it("allows everything for platform access", () => {
    const access = accessFrom({ actor: { kind: "platform" }, platformAccess: true, organizationRole: "owner", projectRoles: {} });
    expect(access.canManageOwners).toBe(true);
    expect(access.canWriteEnvironment("prj_x", "live")).toBe(true);
  });

  it("allows nothing before the roles load", () => {
    const access = accessFrom(undefined);
    expect(access.canCreateProject).toBe(false);
    expect(access.canWriteEnvironment("prj_x", "test")).toBe(false);
  });
});

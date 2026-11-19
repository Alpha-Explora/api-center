import { describe, expect, it } from "vitest";
import { removesLastExplicitAdmin, type ProjectRoleAssignment } from "@/features/control-plane/model/project-roles";

const assignment = (id: string, role: ProjectRoleAssignment["role"], memberEmail: string | null = `${id}@example.test`): ProjectRoleAssignment => ({
  id,
  projectId: "prj_a",
  memberEmail,
  teamId: memberEmail ? null : "tm_a",
  role,
  createdBy: "owner@example.test",
  createdAt: "2026-11-01T00:00:00.000Z",
});

describe("last explicit project admin", () => {
  const admin = assignment("pra_1", "admin");
  const developer = assignment("pra_2", "developer");

  it("warns when the only admin is removed or demoted", () => {
    expect(removesLastExplicitAdmin([admin, developer], admin)).toBe(true);
    expect(removesLastExplicitAdmin([admin, developer], admin, "viewer")).toBe(true);
  });

  it("does not warn when another admin, including a team, remains", () => {
    const teamAdmin = assignment("pra_3", "admin", null);
    expect(removesLastExplicitAdmin([admin, teamAdmin], admin)).toBe(false);
  });

  it("does not warn for non-admins or when the role stays admin", () => {
    expect(removesLastExplicitAdmin([admin, developer], developer)).toBe(false);
    expect(removesLastExplicitAdmin([admin], admin, "admin")).toBe(false);
  });
});

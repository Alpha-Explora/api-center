import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemberProjects } from "@/features/control-plane/views/people/people-page";
import type { Member } from "@/features/control-plane/model/control-plane";

afterEach(cleanup);

const member = (overrides: Partial<Member>): Member => ({ email: "jun@serbizio.ph", role: "developer", status: "active", identityLinked: true, ...overrides });

describe("MemberProjects", () => {
  it("lists a member's own project roles", () => {
    render(<MemberProjects member={member({ projects: [{ projectId: "prj_1", name: "Serbizio", role: "admin" }] })} />);
    expect(screen.getByText("Serbizio")).toBeTruthy();
    expect(screen.getByText("· Admin")).toBeTruthy();
  });

  it("says owners and admins administer every project", () => {
    render(<MemberProjects member={member({ role: "admin" })} />);
    expect(screen.getByText("Every project · Admin")).toBeTruthy();
  });

  it("says when a member has no project roles", () => {
    render(<MemberProjects member={member({ projects: [] })} />);
    expect(screen.getByText("No project roles")).toBeTruthy();
  });
});

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemberStatus } from "@/features/control-plane/views/people/people-page";

const now = Date.parse("2026-11-20T00:00:00Z");
const member = (status: string, inviteExpiresAt: string | null = null, identityLinked = false) => ({ email: "a@x.test", role: "developer", status, inviteExpiresAt, identityLinked });

describe("MemberStatus", () => {
  afterEach(cleanup);

  it("shows how long an invite has left, and when it has expired", () => {
    render(<MemberStatus member={member("invited", "2026-11-23T12:00:00Z")} now={now} />);
    expect(screen.getByText("Invited · 4 days left")).toBeTruthy();
    cleanup();
    render(<MemberStatus member={member("invite_expired", "2026-11-19T00:00:00Z")} now={now} />);
    expect(screen.getByText("Invite expired")).toBeTruthy();
  });

  it("tells suspended and signed-in members apart", () => {
    render(<MemberStatus member={member("suspended", null, true)} now={now} />);
    expect(screen.getByText("Suspended")).toBeTruthy();
    cleanup();
    render(<MemberStatus member={member("active", null, true)} now={now} />);
    expect(screen.getByText("Signed in")).toBeTruthy();
  });
});

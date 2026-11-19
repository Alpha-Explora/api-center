import { describe, expect, it } from "vitest";
import {
  inviteFailureText,
  memberChangeSchema,
} from "@/features/control-plane/model/organizations";

describe("member invites", () => {
  it("explains why an invite was not sent, with a fallback for unknown reasons", () => {
    const invite = {
      status: "not_sent" as const,
      consoleUrl: "https://apicenter.itsandbox.site",
      text: "…",
    };
    expect(
      inviteFailureText({ ...invite, reason: "EMAIL_NOT_CONFIGURED" }),
    ).toBe("Email is not configured on the gateway.");
    expect(inviteFailureText({ ...invite, reason: "SOMETHING_NEW" })).toBe(
      "The invite email could not be sent.",
    );
  });

  it("reads a role change without an invite and a new member with one", () => {
    expect(
      memberChangeSchema.parse({
        email: "a@b.test",
        role: "admin",
        previousRole: "viewer",
        invite: null,
      }).invite,
    ).toBeNull();
    const added = memberChangeSchema.parse({
      email: "a@b.test",
      role: "developer",
      previousRole: null,
      invite: {
        status: "sent",
        consoleUrl: "https://apicenter.itsandbox.site",
        text: "You have been added…",
      },
    });
    expect(added.invite?.status).toBe("sent");
  });
});

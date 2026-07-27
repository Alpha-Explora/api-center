import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeveloperPortalRequestPanel } from "../../../../src/components/developer-portal-request-panel";

describe("DeveloperPortalRequestPanel", () => {
  it("submits quota increase input without applying quota directly", () => {
    const onSubmit = vi.fn();
    render(
      <DeveloperPortalRequestPanel
        disabled={false}
        ownerTribeId="campus-one"
        pending={false}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Requested max requests"), {
      target: { value: "50000" },
    });
    fireEvent.change(screen.getByLabelText("Request reason"), {
      target: { value: "Enrollment launch" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));

    expect(onSubmit).toHaveBeenCalledWith({
      ownerTribeId: "campus-one",
      requestedMaxRequests: 50000,
      reason: "Enrollment launch",
    });
  });
});

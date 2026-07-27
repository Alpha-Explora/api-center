import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ConsumerRunbookPage from "../../../../../../src/app/(management)/docs/consumer-runbook/page";

describe("ConsumerRunbookPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the SDK runbook destination used by the developer portal", () => {
    render(<ConsumerRunbookPage />);

    expect(screen.getByRole("heading", { name: "SDK runbook" })).toBeTruthy();
    expect(screen.getByText("API Center endpoint")).toBeTruthy();
    expect(screen.getByText("Event topics")).toBeTruthy();
  });

  it("prioritizes consumer setup actions with one selected detail", () => {
    render(<ConsumerRunbookPage />);

    const detail = screen.getByLabelText("Selected runbook action detail");
    expect(detail.textContent).toContain("Verify portal packet");
    expect(detail.textContent).toContain(
      "Confirm endpoint, tribe service ID, allowed services, quota policy, and event topic prefix before live traffic.",
    );
    expect(
      screen
        .getByRole("link", { name: /open developer portal/i })
        .getAttribute("href"),
    ).toBe("/developer-portal");

    const readinessButton = screen.getByRole("button", {
      name: /inspect runbook action run readiness smoke test/i,
    });
    expect(readinessButton.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(readinessButton);

    expect(detail.textContent).toContain(
      "Validate the service path before moving the packet into live readiness review.",
    );
    expect(
      screen
        .getByRole("link", { name: /open smoke tests/i })
        .getAttribute("href"),
    ).toBe("/smoke-tests");
    expect(readinessButton.getAttribute("aria-pressed")).toBe("true");
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ApiMarketplaceClient } from "../../../../src/components/api-marketplace-client";

describe("ApiMarketplaceClient", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows marketplace product cards", () => {
    render(
      <ApiMarketplaceClient
        products={[
          {
            productId: "payment",
            displayName: "Payment Service",
            category: "shared-service",
            ownerTeam: "Platform",
            serviceTier: "standard",
            requiredScopes: ["payments:create"],
            exposes: ["/payments"],
            onboardingStatus: "available",
          },
        ]}
      />,
    );

    expect(screen.getAllByText("Payment Service").length).toBeGreaterThan(0);
    expect(screen.getByText("payments:create")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Review product" }).getAttribute("href"),
    ).toBe("/tribes/payment?section=summary");
  });

  it("prioritizes marketplace onboarding actions with one selected detail", () => {
    render(
      <ApiMarketplaceClient
        products={[
          product({
            productId: "legacy-payments",
            displayName: "Legacy Payments",
            onboardingStatus: "deprecated",
          }),
          product({
            productId: "payment",
            displayName: "Payment Service",
            onboardingStatus: "available",
          }),
        ]}
      />,
    );

    const detail = screen.getByLabelText("Selected marketplace action detail");
    expect(detail.textContent).toContain("Review replacement path");
    expect(detail.textContent).toContain(
      "Legacy Payments is deprecated before onboarding.",
    );
    expect(
      screen
        .getByRole("link", { name: /open product detail/i })
        .getAttribute("href"),
    ).toBe("/tribes/legacy-payments?section=governance");

    const paymentButton = screen.getByRole("button", {
      name: /inspect marketplace action payment service/i,
    });
    expect(paymentButton.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(paymentButton);

    expect(detail.textContent).toContain("Start onboarding request");
    expect(detail.textContent).toContain(
      "Payment Service is available with 1 required scope and 1 route.",
    );
    expect(
      screen
        .getByRole("link", { name: /open product detail/i })
        .getAttribute("href"),
    ).toBe("/tribes/payment?section=summary");
    expect(paymentButton.getAttribute("aria-pressed")).toBe("true");
  });
});

function product(overrides: Partial<Parameters<typeof ApiMarketplaceClient>[0]["products"][number]> = {}) {
  return {
    productId: "payment",
    displayName: "Payment Service",
    category: "shared-service",
    ownerTeam: "Platform",
    serviceTier: "standard",
    requiredScopes: ["payments:create"],
    exposes: ["/payments"],
    onboardingStatus: "available",
    ...overrides,
  };
}

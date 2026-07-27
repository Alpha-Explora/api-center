import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PaymentSubscriptionRolloutFlow } from "../../../../../src/components/workflows/payment-subscription-rollout-flow";

describe("PaymentSubscriptionRolloutFlow", () => {
  it("shows checkout and subscription rollout steps", () => {
    render(
      <PaymentSubscriptionRolloutFlow
        mode="test"
        checkoutReady
        subscriptionReady={false}
        webhookReady={false}
      />,
    );

    expect(screen.getByText("Checkout wrapper")).toBeTruthy();
    expect(screen.getByText("Subscription wrapper")).toBeTruthy();
    expect(screen.getByText("Webhook persistence")).toBeTruthy();
  });
});

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PromotionsPage from "../../../../../src/app/(management)/promotions/page";

vi.mock("@/components/environment-promotion-panel", () => ({
  EnvironmentPromotionPanel: ({
    initialServiceId,
  }: {
    initialServiceId?: string;
  }) => <section>Promotion service: {initialServiceId}</section>,
}));

describe("PromotionsPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("passes the route service id into the promotion gate panel", async () => {
    render(
      await PromotionsPage({
        searchParams: Promise.resolve({ serviceId: "logistics-orders" }),
      }),
    );

    expect(
      screen.getByText("Promotion service: logistics-orders"),
    ).toBeTruthy();
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentConsumerServicePanel } from "@/components/payment-consumer-service-panel";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-center/client-core", () => ({ request: requestMock }));

describe("PaymentConsumerServicePanel", () => {
  afterEach(() => {
    cleanup();
    requestMock.mockReset();
  });

  it("shows and forwards the approval request ID for live registration", async () => {
    requestMock.mockResolvedValue({ success: false, error: { message: "Registration complete" } });
    render(<PaymentConsumerServicePanel />);

    fireEvent.change(screen.getByLabelText("Environment"), { target: { value: "live" } });
    const approval = await screen.findByPlaceholderText("UUID of the approved payments.live_access request");
    fireEvent.change(screen.getByLabelText("Consumer service ID"), { target: { value: "billing-api" } });
    fireEvent.change(approval, { target: { value: "00000000-0000-4000-8000-000000000001" } });
    fireEvent.click(screen.getByRole("button", { name: "Register consumer" }));

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(requestMock.mock.calls[0][1].body)).toMatchObject({
      environment: "live",
      approvalRequestId: "00000000-0000-4000-8000-000000000001",
    });
    expect((await screen.findByRole("alert")).textContent).toContain("Registration complete");
  });

  it("shows the gateway rejection message", async () => {
    requestMock.mockRejectedValue(new Error("payments.live_access in live requires an approved request"));
    render(<PaymentConsumerServicePanel />);
    fireEvent.change(screen.getByLabelText("Environment"), { target: { value: "live" } });
    fireEvent.change(screen.getByLabelText("Consumer service ID"), { target: { value: "billing-api" } });
    fireEvent.click(screen.getByRole("button", { name: "Register consumer" }));

    expect((await screen.findByRole("alert")).textContent).toContain("payments.live_access in live requires an approved request");
  });
});

import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedServiceSmokeTests } from "../../../../src/components/shared-service-smoke-tests";
import { getGoogleAuthorizationUrl } from "@/components/shared-service-smoke-tests/smoke-targets";
import { renderWithQueryClient } from "@tests/support/render-with-query-client";

const apiClient = vi.hoisted(() => ({
  previewSharedServiceSmokeOperation: vi.fn(),
  runSharedServiceSmokeTest: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

vi.mock("@/components/smoke-token-card", () => ({
  SmokeTokenCard: () => <section>Smoke token</section>,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("SharedServiceSmokeTests", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders provider-impacting operation preview output", async () => {
    apiClient.previewSharedServiceSmokeOperation.mockResolvedValue({
      actionId: "payment.subscription.rollout",
      environment: "live",
      risk: "provider-write",
      changes: ["Create or validate subscription wrapper"],
      confirmationPhrase: "APPLY LIVE CHANGE",
      reasonRequired: true,
    });

    renderWithQueryClient(<SharedServiceSmokeTests mode="live" />);

    fireEvent.click(screen.getByText("Preview operation"));

    await waitFor(() => {
      expect(screen.getByText("Create or validate subscription wrapper")).toBeTruthy();
    });
    expect(screen.getByText("Type APPLY LIVE CHANGE")).toBeTruthy();
    expect(screen.getByText("Change reason")).toBeTruthy();
  });

  it("associates the provider-impacting confirmation checkbox with an explicit label", () => {
    const { container } = renderWithQueryClient(
      <SharedServiceSmokeTests mode="live" />,
    );

    const checkbox = screen.getByLabelText(
      /understand provider-impacting checks/i,
    ) as HTMLInputElement;

    expect(checkbox.id).toBe("provider-impacting-checks-confirmed");
    expect(
      container.querySelector(
        'label[for="provider-impacting-checks-confirmed"]',
      ),
    ).toBeTruthy();
  });

  it("extracts Google authorization URL previews safely", () => {
    expect(
      getGoogleAuthorizationUrl(
        JSON.stringify({
          data: {
            authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
          },
        }),
      ),
    ).toBe("https://accounts.google.com/o/oauth2/v2/auth");

    expect(getGoogleAuthorizationUrl("{not-json")).toBeUndefined();
    expect(getGoogleAuthorizationUrl(JSON.stringify({ data: {} }))).toBeUndefined();
  });
});

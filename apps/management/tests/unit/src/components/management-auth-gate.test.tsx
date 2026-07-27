import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagementAuthGate } from "@/components/management-auth-gate";

describe("ManagementAuthGate", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
    cleanup();
  });

  it("shows the APICenter sign-up surface before Google authentication", () => {
    render(
      <ManagementAuthGate googleClientId="client-id.apps.googleusercontent.com">
        <div>Management app</div>
      </ManagementAuthGate>,
    );

    expect(
      screen.getByRole("heading", { name: /sign up for apicenter/i }),
    ).toBeTruthy();
    expect(screen.getByLabelText(/first name/i)).toBeTruthy();
    expect(screen.getByLabelText(/last name/i)).toBeTruthy();
    expect(screen.getByLabelText(/^email$/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeTruthy();
    expect(screen.getAllByTestId("google-logo")[0]).toBeTruthy();
    expect(screen.getByTestId("auth-product-surface")).toBeTruthy();
    expect(screen.getByTestId("auth-architecture-visual")).toBeTruthy();
    expect(screen.queryByText("Management app")).toBeNull();
  });

  it("uses human auth setup messages instead of terse configuration errors", () => {
    render(
      <ManagementAuthGate googleClientId="">
        <div>Management app</div>
      </ManagementAuthGate>,
    );

    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));

    expect(
      screen.getByText(
        "Google sign-in is not connected yet. Add your Google client ID, then try again.",
      ),
    ).toBeTruthy();
  });

  it("moves to password creation with a locked email after profile continue", () => {
    render(
      <ManagementAuthGate googleClientId="">
        <div>Management app</div>
      </ManagementAuthGate>,
    );

    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "t.anthony.playz@gmail.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));

    expect(screen.getByLabelText(/^password$/i)).toBeTruthy();
    const lockedEmail = screen.getByLabelText(/^email$/i);
    expect(lockedEmail).toHaveProperty("disabled", true);
    expect(lockedEmail).toHaveProperty("value", "t.anthony.playz@gmail.com");
    expect(
      screen.queryByRole("button", { name: /continue with google/i }),
    ).toBeNull();
    expect(screen.queryByText(/already have an account/i)).toBeNull();
  });

  it("toggles password visibility on the password creation step", () => {
    render(
      <ManagementAuthGate googleClientId="">
        <div>Management app</div>
      </ManagementAuthGate>,
    );

    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "t.anthony.playz@gmail.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));

    const passwordInput = screen.getByLabelText(/^password$/i);
    expect(passwordInput).toHaveProperty("type", "password");

    fireEvent.click(screen.getByRole("button", { name: /show password/i }));
    expect(passwordInput).toHaveProperty("type", "text");

    fireEvent.click(screen.getByRole("button", { name: /hide password/i }));
    expect(passwordInput).toHaveProperty("type", "password");
  });

  it("sends an email code and opens verification after password creation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
    } as Response);

    render(
      <ManagementAuthGate googleClientId="">
        <div>Management app</div>
      </ManagementAuthGate>,
    );

    fireEvent.change(screen.getByLabelText(/first name/i), {
      target: { value: "Anthony" },
    });
    fireEvent.change(screen.getByLabelText(/last name/i), {
      target: { value: "Torres" },
    });
    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "t.anthony.playz@gmail.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "password-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /verify your email/i }),
      ).toBeTruthy(),
    );
    expect(screen.getAllByLabelText(/verification code digit/i)).toHaveLength(6);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/local/signup/email-code",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("verifies the email code from the verification step", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
      } as Response);

    render(
      <ManagementAuthGate googleClientId="">
        <div>Management app</div>
      </ManagementAuthGate>,
    );

    fireEvent.change(screen.getByLabelText(/^email$/i), {
      target: { value: "t.anthony.playz@gmail.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: "password-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));

    await waitFor(() =>
      expect(screen.getAllByLabelText(/verification code digit/i)).toHaveLength(
        6,
      ),
    );

    screen
      .getAllByLabelText(/verification code digit/i)
      .forEach((input, index) => {
        fireEvent.change(input, { target: { value: String(index + 1) } });
      });
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/local/signup/verify-code",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            code: "123456",
            email: "t.anthony.playz@gmail.com",
          }),
        }),
      ),
    );
  });

  it("acknowledges button presses on the sign-up actions", () => {
    render(
      <ManagementAuthGate googleClientId="">
        <div>Management app</div>
      </ManagementAuthGate>,
    );

    const continueButton = screen.getByRole("button", { name: /^continue$/i });
    fireEvent.click(continueButton);
    expect(continueButton.getAttribute("data-pressed")).toBe("true");

    const googleButton = screen.getByRole("button", {
      name: /continue with google/i,
    });
    fireEvent.click(googleButton);
    expect(googleButton.getAttribute("data-pressed")).toBe("true");
  });

  it("renders the protected app when a Google session is already stored", () => {
    window.sessionStorage.setItem(
      "apicenter.management.googleCredential",
      "stored-google-token",
    );

    render(
      <ManagementAuthGate googleClientId="client-id.apps.googleusercontent.com">
        <div>Management app</div>
      </ManagementAuthGate>,
    );

    expect(screen.getByText("Management app")).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: /sign up for apicenter/i }),
    ).toBeNull();
  });
});

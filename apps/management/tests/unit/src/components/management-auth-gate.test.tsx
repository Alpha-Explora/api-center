import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagementAuthGate } from "@/components/management-auth-gate";
import { ApiError } from "@/lib/api-center/client-core";

const { getManagementSessionMock, setManagementSessionTokenMock } = vi.hoisted(
  () => ({
    getManagementSessionMock: vi.fn(),
    setManagementSessionTokenMock: vi.fn(),
  }),
);

vi.mock("@/lib/api-center-client", () => ({
  getManagementSession: getManagementSessionMock,
  setManagementSessionToken: setManagementSessionTokenMock,
}));

vi.mock("next/script", async () => {
  const { useEffect } = await import("react");

  return {
    default: function MockScript({ onLoad }: { onLoad?: () => void }) {
      useEffect(() => onLoad?.(), [onLoad]);
      return null;
    },
  };
});

const NON_MEMBER_MESSAGE =
  "This Google account does not have APICenter access. Ask an organization admin to add your email, then sign in again.";

describe("ManagementAuthGate", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    delete window.google;
    getManagementSessionMock.mockReset();
    setManagementSessionTokenMock.mockReset();
    vi.restoreAllMocks();
    cleanup();
  });

  it("shows the Google sign-in card before Google authentication", () => {
    render(
      <ManagementAuthGate googleClientId="">
        <div>Management app</div>
      </ManagementAuthGate>,
    );

    expect(
      screen.getByRole("heading", { name: "Sign in to APICenter" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Use your organization Google account to sign in."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /continue with google/i }),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/email|password|first name/i)).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getAllByTestId("google-logo")[0]).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Management app")).toBeNull();
    expect(screen.queryByText(/already have an account/i)).toBeNull();
    expect(screen.getByRole("link", { name: "APICenter home" }).getAttribute("href")).toBe("/");
  });

  it("shows the Google setup message and pressed feedback when no client ID is configured", () => {
    render(
      <ManagementAuthGate googleClientId="">
        <div>Management app</div>
      </ManagementAuthGate>,
    );

    const googleButton = screen.getByRole("button", {
      name: /continue with google/i,
    });
    fireEvent.click(googleButton);

    expect(googleButton.getAttribute("data-pressed")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("Google client ID missing");
    expect(
      screen.getByText(
        "Google sign-in is not connected yet. Add your Google client ID, then try again.",
      ),
    ).toBeTruthy();
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
      screen.queryByRole("heading", { name: "Sign in to APICenter" }),
    ).toBeNull();
  });

  it("shows the organization membership error and clears a denied credential", async () => {
    let credentialCallback:
      | ((response: { credential?: string }) => void)
      | undefined;
    getManagementSessionMock.mockRejectedValue(new Error(NON_MEMBER_MESSAGE));
    window.google = {
      accounts: {
        id: {
          initialize: ({ callback }) => {
            credentialCallback = callback;
          },
          renderButton: vi.fn(),
          disableAutoSelect: vi.fn(),
        },
      },
    };

    render(
      <ManagementAuthGate googleClientId="client-id.apps.googleusercontent.com">
        <div>Management app</div>
      </ManagementAuthGate>,
    );

    await waitFor(() => expect(credentialCallback).toBeTypeOf("function"));
    await act(async () => {
      await credentialCallback?.({ credential: "denied-token" });
    });

    expect(screen.getByText(NON_MEMBER_MESSAGE)).toBeTruthy();
    expect(screen.getByText("No access to APICenter")).toBeTruthy();
    expect(setManagementSessionTokenMock).toHaveBeenCalledWith("denied-token");
    expect(setManagementSessionTokenMock).toHaveBeenLastCalledWith(undefined);
    expect(
      window.sessionStorage.getItem("apicenter.management.googleCredential"),
    ).toBeNull();
    expect(screen.queryByText("Management app")).toBeNull();
  });

  it("tells a failed access lookup apart from a denied account", async () => {
    let credentialCallback:
      | ((response: { credential?: string }) => void)
      | undefined;
    getManagementSessionMock.mockRejectedValue(new Error("Membership lookup failed (503)"));
    window.google = {
      accounts: {
        id: {
          initialize: ({ callback }) => {
            credentialCallback = callback;
          },
          renderButton: vi.fn(),
          disableAutoSelect: vi.fn(),
        },
      },
    };

    render(
      <ManagementAuthGate googleClientId="client-id.apps.googleusercontent.com">
        <div>Management app</div>
      </ManagementAuthGate>,
    );

    await waitFor(() => expect(credentialCallback).toBeTypeOf("function"));
    await act(async () => {
      await credentialCallback?.({ credential: "google-token" });
    });

    expect(screen.getByText("We could not confirm your access")).toBeTruthy();
    expect(screen.getByText("Membership lookup failed (503)")).toBeTruthy();
    expect(setManagementSessionTokenMock).toHaveBeenLastCalledWith(undefined);
    expect(
      window.sessionStorage.getItem("apicenter.management.googleCredential"),
    ).toBeNull();
  });

  it("offers Try again when APICenter is starting up, without a new Google sign-in", async () => {
    let credentialCallback: ((response: { credential?: string }) => void) | undefined;
    getManagementSessionMock
      .mockRejectedValueOnce(new ApiError("Could not confirm APICenter access", 503, "ACCESS_CHECK_UNAVAILABLE"))
      .mockResolvedValueOnce({ email: "dana@acme.example" });
    window.google = {
      accounts: {
        id: {
          initialize: ({ callback }) => {
            credentialCallback = callback;
          },
          renderButton: vi.fn(),
          disableAutoSelect: vi.fn(),
        },
      },
    };

    render(
      <ManagementAuthGate googleClientId="client-id.apps.googleusercontent.com">
        <div>Management app</div>
      </ManagementAuthGate>,
    );

    await waitFor(() => expect(credentialCallback).toBeTypeOf("function"));
    await act(async () => {
      await credentialCallback?.({ credential: "google-token" });
    });
    expect(screen.getByText("APICenter is starting up")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });

    await waitFor(() => expect(screen.getByText("Management app")).toBeTruthy());
    expect(getManagementSessionMock).toHaveBeenCalledTimes(2);
    expect(window.sessionStorage.getItem("apicenter.management.googleCredential")).toBe("google-token");
  });

  // The console's first queries start in its passive effects. Each one must already carry the token,
  // or the tokenless request is answered 401 and the console signs the person straight back out.
  describe("the token is in place before the console's first request", () => {
    function tokenAtChildEffect() {
      let current: string | undefined;
      const seen: (string | undefined)[] = [];
      setManagementSessionTokenMock.mockImplementation((token: string | undefined) => {
        current = token;
      });
      function Console() {
        useEffect(() => {
          seen.push(current);
        }, []);
        return <div>Management app</div>;
      }
      return { Console, seen };
    }

    it("on a reload with a stored credential", () => {
      window.sessionStorage.setItem("apicenter.management.googleCredential", "stored-google-token");
      const { Console, seen } = tokenAtChildEffect();

      render(
        <ManagementAuthGate googleClientId="client-id.apps.googleusercontent.com">
          <Console />
        </ManagementAuthGate>,
      );

      expect(seen).toEqual(["stored-google-token"]);
    });

    it("right after signing in", async () => {
      let credentialCallback: ((response: { credential?: string }) => void) | undefined;
      getManagementSessionMock.mockResolvedValue({ email: "dana@acme.example" });
      window.google = {
        accounts: {
          id: {
            initialize: ({ callback }) => {
              credentialCallback = callback;
            },
            renderButton: vi.fn(),
            disableAutoSelect: vi.fn(),
          },
        },
      };
      const { Console, seen } = tokenAtChildEffect();

      render(
        <ManagementAuthGate googleClientId="client-id.apps.googleusercontent.com">
          <Console />
        </ManagementAuthGate>,
      );
      await waitFor(() => expect(credentialCallback).toBeTypeOf("function"));
      await act(async () => {
        await credentialCallback?.({ credential: "google-token" });
      });

      expect(seen).toEqual(["google-token"]);
    });
  });

  it("does not reuse a stored Google credential that has expired", () => {
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 }));
    window.sessionStorage.setItem("apicenter.management.googleCredential", `h.${payload}.s`);

    render(
      <ManagementAuthGate googleClientId="">
        <div>Management app</div>
      </ManagementAuthGate>,
    );

    expect(screen.queryByText("Management app")).toBeNull();
    expect(window.sessionStorage.getItem("apicenter.management.googleCredential")).toBeNull();
  });
});

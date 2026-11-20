import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManagementAuthGate, MANAGEMENT_SIGN_OUT_EVENT } from "@/components/management-auth-gate";
import { ApiError } from "@/lib/api-center/client-core";

const { getManagementSessionMock, signInWithGoogleMock, signOutMock, setSignedInMock } = vi.hoisted(() => ({
  getManagementSessionMock: vi.fn(),
  signInWithGoogleMock: vi.fn(),
  signOutMock: vi.fn(),
  setSignedInMock: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => ({
  getManagementSession: getManagementSessionMock,
  signInWithGoogle: signInWithGoogleMock,
  signOut: signOutMock,
  setSignedIn: setSignedInMock,
}));

vi.mock("next/script", async () => {
  const { useEffect: useMockEffect } = await import("react");
  return {
    default: function MockScript({ onLoad }: { onLoad?: () => void }) {
      useMockEffect(() => onLoad?.(), [onLoad]);
      return null;
    },
  };
});

const NON_MEMBER_MESSAGE =
  "This Google account does not have APICenter access. Ask an organization admin to add your email, then sign in again.";
const SESSION = { email: "dana@acme.example" };
const signedOut = () => new ApiError("Your sign-in has expired or is not valid. Sign in again.", 401, "UNAUTHENTICATED");

/** Installs a Google Identity stub and returns a way to complete its sign-in. */
function googleStub() {
  let callback: ((response: { credential?: string }) => void) | undefined;
  const initialize = vi.fn(({ callback: next }: { callback: (response: { credential?: string }) => void }) => {
    callback = next;
  });
  window.google = { accounts: { id: { initialize, renderButton: vi.fn(), disableAutoSelect: vi.fn() } } };
  return {
    initialize,
    ready: () => waitFor(() => expect(callback).toBeTypeOf("function")),
    signIn: (credential: string) => act(async () => callback?.({ credential })),
  };
}

function renderGate(child = <div>Management app</div>) {
  return render(<ManagementAuthGate googleClientId="client-id.apps.googleusercontent.com">{child}</ManagementAuthGate>);
}

describe("ManagementAuthGate", () => {
  beforeEach(() => {
    getManagementSessionMock.mockRejectedValue(signedOut());
    signOutMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete window.google;
    vi.resetAllMocks();
    cleanup();
  });

  it("shows the Google sign-in card when this browser has no session", async () => {
    render(
      <ManagementAuthGate googleClientId="">
        <div>Management app</div>
      </ManagementAuthGate>,
    );

    expect(await screen.findByRole("heading", { name: "Sign in to APICenter" })).toBeTruthy();
    expect(screen.getByText("Use your organization Google account to sign in.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Management app")).toBeNull();
    expect(screen.getByRole("link", { name: "APICenter home" }).getAttribute("href")).toBe("/");
  });

  it("shows the Google setup message and pressed feedback when no client ID is configured", async () => {
    render(
      <ManagementAuthGate googleClientId="">
        <div>Management app</div>
      </ManagementAuthGate>,
    );

    const googleButton = await screen.findByRole("button", { name: /continue with google/i });
    fireEvent.click(googleButton);

    expect(googleButton.getAttribute("data-pressed")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("Google client ID missing");
  });

  it("opens the console straight away when this browser already has a session, in any tab", async () => {
    getManagementSessionMock.mockResolvedValue(SESSION);
    renderGate();

    expect(await screen.findByText("Management app")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Sign in to APICenter" })).toBeNull();
    expect(setSignedInMock).toHaveBeenLastCalledWith(true);
  });

  it("exchanges the Google credential for a session and opens the console", async () => {
    signInWithGoogleMock.mockResolvedValue(SESSION);
    const google = googleStub();
    renderGate();

    await google.ready();
    await google.signIn("google-token");

    expect(signInWithGoogleMock).toHaveBeenCalledWith("google-token");
    expect(await screen.findByText("Management app")).toBeTruthy();
  });

  it("shows why a denied account cannot sign in, and keeps the console closed", async () => {
    signInWithGoogleMock.mockRejectedValue(new Error(NON_MEMBER_MESSAGE));
    const google = googleStub();
    renderGate();

    await google.ready();
    await google.signIn("denied-token");

    expect(screen.getByText("No access to APICenter")).toBeTruthy();
    expect(screen.getByText(NON_MEMBER_MESSAGE)).toBeTruthy();
    expect(screen.queryByText("Management app")).toBeNull();
  });

  it("tells a failed access lookup apart from a denied account", async () => {
    signInWithGoogleMock.mockRejectedValue(new Error("Membership lookup failed (503)"));
    const google = googleStub();
    renderGate();

    await google.ready();
    await google.signIn("google-token");

    expect(screen.getByText("We could not confirm your access")).toBeTruthy();
    expect(screen.getByText("Membership lookup failed (503)")).toBeTruthy();
  });

  it("offers Try again when APICenter is starting up, without a new Google sign-in", async () => {
    signInWithGoogleMock
      .mockRejectedValueOnce(new ApiError("Could not confirm APICenter access", 503, "ACCESS_CHECK_UNAVAILABLE"))
      .mockResolvedValueOnce(SESSION);
    const google = googleStub();
    renderGate();

    await google.ready();
    await google.signIn("google-token");
    expect(screen.getByText("APICenter is starting up")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });

    expect(await screen.findByText("Management app")).toBeTruthy();
    expect(signInWithGoogleMock).toHaveBeenCalledTimes(2);
    expect(signInWithGoogleMock).toHaveBeenLastCalledWith("google-token");
  });

  it("retries the session check itself when APICenter is starting up on load", async () => {
    getManagementSessionMock.mockReset();
    getManagementSessionMock.mockRejectedValueOnce(new ApiError("Service unavailable", 503, "ACCESS_CHECK_UNAVAILABLE")).mockResolvedValueOnce(SESSION);
    renderGate();

    expect(await screen.findByText("APICenter is starting up")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });

    expect(await screen.findByText("Management app")).toBeTruthy();
  });

  it("signing out ends the session on the server", async () => {
    getManagementSessionMock.mockResolvedValue(SESSION);
    renderGate();
    await screen.findByText("Management app");

    await act(async () => {
      window.dispatchEvent(new Event(MANAGEMENT_SIGN_OUT_EVENT));
    });

    expect(signOutMock).toHaveBeenCalledOnce();
    expect(await screen.findByRole("heading", { name: "Sign in to APICenter" })).toBeTruthy();
    expect(screen.queryByText("Your session ended")).toBeNull();
  });

  it("says the session ended when the server rejects it", async () => {
    getManagementSessionMock.mockResolvedValue(SESSION);
    renderGate();
    await screen.findByText("Management app");

    await act(async () => {
      window.dispatchEvent(new CustomEvent(MANAGEMENT_SIGN_OUT_EVENT, { detail: { expired: true } }));
    });

    expect(await screen.findByText("Your session ended")).toBeTruthy();
    expect(signOutMock).not.toHaveBeenCalled();
  });

  // The console's first queries start in its passive effects. Each must already count as signed in, or a
  // 401 to it would be ignored and the next one would sign the person out.
  it("counts as signed in before the console's first request", async () => {
    getManagementSessionMock.mockResolvedValue(SESSION);
    let signedIn = false;
    setSignedInMock.mockImplementation((value: boolean) => {
      signedIn = value;
    });
    const seen: boolean[] = [];
    function Console() {
      useEffect(() => {
        seen.push(signedIn);
      }, []);
      return <div>Management app</div>;
    }

    renderGate(<Console />);

    await screen.findByText("Management app");
    expect(seen).toEqual([true]);
  });

  it("offers the invited account first when opened from an invite link", async () => {
    const google = googleStub();
    window.history.replaceState(null, "", "/signup?login_hint=jun%40serbizio.ph");

    renderGate();

    await waitFor(() => expect(google.initialize).toHaveBeenCalledWith(expect.objectContaining({ login_hint: "jun@serbizio.ph" })));
    window.history.replaceState(null, "", "/");
  });
});

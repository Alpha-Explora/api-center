"use client";

import Link from "next/link";
import Script from "next/script";
import { AlertTriangleIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { QueryClientContext } from "@tanstack/react-query";
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { getManagementSession, setSignedIn, signInWithGoogle, signOut } from "@/lib/api-center-client";
import { setSessionRejectedHandler } from "@/lib/api-center/client-core";
import { isTransientError } from "@/lib/api-center/retry-policy";
import { ApiError } from "@/lib/api-center/client-core";
import { NO_ORGANIZATION_ACCESS_MESSAGE } from "@/lib/server/management-auth";

const GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";
/** Where earlier versions kept the Google ID token in each tab; removed on load. */
const LEGACY_STORAGE_KEY = "apicenter.management.googleCredential";
export const MANAGEMENT_SIGN_OUT_EVENT = "apicenter-management-sign-out";
const PRESS_FEEDBACK_MS = 650;
const GOOGLE_BUTTON_MAX_WIDTH = 400;
const DOCS_URL = "https://docs.apicenter.itsandbox.site/guides/getting-started";

type SignInError = { title: string; message: string; retryable?: boolean };

const NOT_CONFIGURED_ERROR: SignInError = {
  title: "Google client ID missing",
  message: "Google sign-in is not connected yet. Add your Google client ID, then try again.",
};
const SCRIPT_ERROR: SignInError = {
  title: "Google sign-in did not load",
  message: "Google sign-in could not load. Refresh the page and try again.",
};
const NO_CREDENTIAL_ERROR: SignInError = {
  title: "Sign-in did not finish",
  message: "Google did not finish the sign-in. Try the Google button again.",
};

const SESSION_EXPIRED_ERROR: SignInError = {
  title: "Your session ended",
  message: "Sessions last 12 hours, and signing out ends them. Sign in again to continue.",
};

/**
 * A failed access check. A denied account reads differently from a lookup that failed, and a lookup
 * that failed because APICenter is starting up or busy can be tried again without a new Google sign-in.
 */
function accessError(error: unknown): SignInError {
  if (isTransientError(error)) {
    return {
      title: "APICenter is starting up",
      message: "We could not confirm your access yet. This usually clears in a few seconds.",
      retryable: true,
    };
  }
  const message =
    error instanceof Error
      ? error.message
      : "We could not confirm your APICenter access. Try again in a moment.";
  return message === NO_ORGANIZATION_ACCESS_MESSAGE
    ? { title: "No access to APICenter", message }
    : { title: "We could not confirm your access", message };
}

type GoogleCredentialResponse = {
  credential?: string;
};

type GoogleAccounts = {
  id: {
    initialize: (config: {
      client_id: string;
      callback: (response: GoogleCredentialResponse) => void;
      /** Offers this account first, e.g. the invited email from an invite link. */
      login_hint?: string;
    }) => void;
    renderButton: (
      parent: HTMLElement,
      options: {
        theme: "outline" | "filled_blue" | "filled_black";
        size: "large" | "medium" | "small";
        type: "standard" | "icon";
        shape: "rectangular" | "pill" | "circle" | "square";
        text: "signin_with" | "signup_with" | "continue_with" | "signin";
        width?: number;
      },
    ) => void;
    disableAutoSelect: () => void;
  };
};

declare global {
  interface Window {
    google?: {
      accounts: GoogleAccounts;
    };
  }
}

export function ManagementAuthGate({
  children,
  googleClientId,
  authenticatedRedirectHref,
}: {
  children: React.ReactNode;
  googleClientId: string;
  authenticatedRedirectHref?: string;
}) {
  const buttonRef = useRef<HTMLDivElement | null>(null);
  const { resolvedTheme } = useTheme();
  const [scriptReady, setScriptReady] = useState(false);
  // Optional so the gate also renders outside a QueryClientProvider.
  const queryClient = useContext(QueryClientContext);
  // "checking" until the console says whether this browser has a session.
  const [status, setStatus] = useState<"checking" | "signedIn" | "signedOut">("checking");
  const [error, setError] = useState<SignInError | undefined>();
  const [checking, setChecking] = useState(false);
  const [googlePressed, setGooglePressed] = useState(false);
  const [pendingCredential, setPendingCredential] = useState<string | undefined>();
  const signedIn = status === "signedIn";

  const showGooglePressedFeedback = useCallback(() => {
    setGooglePressed(true);
    window.setTimeout(() => setGooglePressed(false), PRESS_FEEDBACK_MS);
  }, []);

  // Does this browser already have a session? A transient failure is shown with Try again rather than
  // reading as signed out.
  const settleSession = useCallback((sessionError?: unknown) => {
    if (sessionError === undefined) {
      setStatus("signedIn");
      return;
    }
    setStatus("signedOut");
    if (sessionError instanceof ApiError && sessionError.status === 401) return;
    setError(accessError(sessionError));
  }, []);

  const retrySession = useCallback(() => {
    setStatus("checking");
    setError(undefined);
    getManagementSession().then(
      () => settleSession(),
      (sessionError: unknown) => settleSession(sessionError ?? new Error("Session check failed")),
    );
  }, [settleSession]);

  useEffect(() => {
    try {
      window.sessionStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Storage may be unavailable; nothing to clean up then.
    }
    let active = true;
    getManagementSession().then(
      () => active && settleSession(),
      (sessionError: unknown) => active && settleSession(sessionError ?? new Error("Session check failed")),
    );
    return () => {
      active = false;
    };
  }, [settleSession]);

  // Exchanges the Google ID token for the console session, which also confirms the account has
  // APICenter access, so a denied account sees why instead of landing on an empty console.
  const checkAccess = useCallback(
    async (credential: string) => {
      setPendingCredential(credential);
      setChecking(true);
      setError(undefined);
      try {
        await signInWithGoogle(credential);
      } catch (lookupError) {
        setError(accessError(lookupError));
        return;
      } finally {
        setChecking(false);
      }

      setPendingCredential(undefined);
      // A different person may have used this browser before; nothing of theirs may show.
      queryClient?.clear();
      setStatus("signedIn");
    },
    [queryClient],
  );

  const handleCredential = useCallback(
    async (response: GoogleCredentialResponse) => {
      if (!response.credential) {
        setError(NO_CREDENTIAL_ERROR);
        return;
      }
      await checkAccess(response.credential);
    },
    [checkAccess],
  );

  // A layout effect, so the console's first queries already count as signed in: they start in passive
  // effects, and a child's passive effects run before this component's.
  useLayoutEffect(() => {
    setSignedIn(signedIn);
    return () => setSignedIn(false);
  }, [signedIn]);

  useEffect(() => {
    if (signedIn && authenticatedRedirectHref) {
      window.location.assign(authenticatedRedirectHref);
    }
  }, [authenticatedRedirectHref, signedIn]);

  useEffect(() => {
    const handleSignOut = (event: Event) => {
      const expired = (event as CustomEvent<{ expired?: boolean }>).detail?.expired === true;
      window.google?.accounts.id.disableAutoSelect();
      setStatus("signedOut");
      queryClient?.clear();
      if (expired) setError(SESSION_EXPIRED_ERROR);
      // Ending it on the server clears the cookie; an expired session has nothing left to end.
      else void signOut().catch(() => undefined);
    };
    // The server rejected the session: it expired, or the person lost access.
    setSessionRejectedHandler(() =>
      window.dispatchEvent(new CustomEvent(MANAGEMENT_SIGN_OUT_EVENT, { detail: { expired: true } })),
    );

    window.addEventListener(MANAGEMENT_SIGN_OUT_EVENT, handleSignOut);
    return () => {
      setSessionRejectedHandler(undefined);
      window.removeEventListener(MANAGEMENT_SIGN_OUT_EVENT, handleSignOut);
    };
  }, [queryClient]);

  useEffect(() => {
    const container = buttonRef.current;
    if (!scriptReady || status !== "signedOut" || !container || !window.google || !googleClientId) {
      return;
    }

    container.innerHTML = "";
    const loginHint = new URLSearchParams(window.location.search).get("login_hint")?.trim();
    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: handleCredential,
      ...(loginHint ? { login_hint: loginHint } : {}),
    });
    // Google renders a fixed-width button, so size it to the card once it is laid out.
    const measured = Math.round(container.getBoundingClientRect().width);
    window.google.accounts.id.renderButton(container, {
      theme: resolvedTheme === "dark" ? "filled_black" : "outline",
      size: "large",
      type: "standard",
      shape: "rectangular",
      text: "continue_with",
      width: measured > 0 ? Math.min(measured, GOOGLE_BUTTON_MAX_WIDTH) : 320,
    });
  }, [googleClientId, handleCredential, resolvedTheme, scriptReady, status]);

  if (status === "checking") {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background text-foreground">
        <p className="text-[13px] text-muted-foreground" role="status">
          Opening APICenter…
        </p>
      </main>
    );
  }

  if (signedIn) {
    if (authenticatedRedirectHref) {
      return (
        <main className="flex min-h-svh items-center justify-center bg-background text-foreground">
          <p className="text-[13px] text-muted-foreground" role="status">
            Opening APICenter…
          </p>
        </main>
      );
    }

    return children;
  }

  return (
    <main className="flex min-h-svh flex-col bg-background text-foreground">
      <Script
        src={GOOGLE_IDENTITY_SCRIPT}
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
        onError={() => setError(SCRIPT_ERROR)}
      />
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <section className="w-full max-w-[380px] rounded-lg border bg-card p-6 shadow-xs sm:p-8">
          <BrandMark size={32} />
          <h1 className="mt-5 text-xl font-semibold tracking-tight">Sign in to APICenter</h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            Use your organization Google account to sign in.
          </p>

          <div className="mt-6">
            {googleClientId && scriptReady ? (
              <div ref={buttonRef} className="flex min-h-10 w-full justify-center" />
            ) : (
              <Button
                className="h-10 w-full gap-2 text-sm active:translate-y-px data-[pressed=true]:bg-muted data-[pressed=true]:text-muted-foreground motion-reduce:active:translate-y-0"
                data-pressed={googlePressed}
                type="button"
                variant="outline"
                disabled={Boolean(googleClientId)}
                onClick={() => {
                  showGooglePressedFeedback();
                  setError(NOT_CONFIGURED_ERROR);
                }}
              >
                <GoogleGlyph />
                Continue with Google
              </Button>
            )}
            {googleClientId && !scriptReady && !error ? (
              <p className="mt-3 text-center text-xs text-muted-foreground" role="status">
                Loading Google sign-in…
              </p>
            ) : null}
            {checking ? (
              <p className="mt-3 text-center text-xs text-muted-foreground" role="status">
                Checking your access…
              </p>
            ) : null}
          </div>

          {error ? (
            <div
              role="alert"
              className="mt-4 flex gap-2.5 rounded-md border border-danger/30 bg-danger-soft px-3 py-2.5 text-[13px]"
            >
              <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">{error.title}</p>
                <p className="mt-0.5 text-muted-foreground">{error.message}</p>
                {error.retryable ? (
                  <Button
                    className="mt-2"
                    size="sm"
                    variant="outline"
                    type="button"
                    disabled={checking}
                    onClick={() => (pendingCredential ? void checkAccess(pendingCredential) : retrySession())}
                  >
                    Try again
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          <p className="mt-6 border-t pt-4 text-xs text-muted-foreground">
            Access comes from your organization. If you are new, ask an organization admin to add your
            email.
          </p>
        </section>
      </div>
      <footer className="flex items-center justify-center gap-5 px-4 pb-8 text-xs text-muted-foreground">
        <Link href="/" className="transition-colors hover:text-foreground">
          APICenter home
        </Link>
        <a href={DOCS_URL} className="transition-colors hover:text-foreground">
          Documentation
        </a>
      </footer>
    </main>
  );
}

function GoogleGlyph() {
  return (
    <svg
      aria-hidden="true"
      data-icon="inline-start"
      data-testid="google-logo"
      viewBox="0 0 18 18"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M17.64 9.2c0-.64-.06-1.26-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.7H.94v2.34A9 9 0 0 0 9 18Z"
        fill="#34A853"
      />
      <path
        d="M3.96 10.72A5.42 5.42 0 0 1 3.68 9c0-.6.1-1.18.28-1.72V4.94H.94A9 9 0 0 0 0 9c0 1.45.34 2.82.94 4.06l3.02-2.34Z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .94 4.94l3.02 2.34C4.67 5.16 6.66 3.58 9 3.58Z"
        fill="#EA4335"
      />
    </svg>
  );
}

"use client";

import Image from "next/image";
import Link from "next/link";
import Script from "next/script";
import { ChevronLeftIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getManagementSession,
  setManagementSessionToken,
} from "@/lib/api-center-client";

const GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";
const SESSION_STORAGE_KEY = "apicenter.management.googleCredential";
export const MANAGEMENT_SIGN_OUT_EVENT = "apicenter-management-sign-out";
const PRESS_FEEDBACK_MS = 650;
const VERIFICATION_CODE_LENGTH = 6;
const RESEND_SECONDS = 29;
const primaryAuthButtonClass =
  "h-11 w-full rounded-[7px] border border-[#111416] bg-[#111416] text-sm font-semibold text-white shadow-[0_6px_18px_rgba(15,23,42,0.12)] transition-[background-color,border-color,box-shadow,transform] duration-150 hover:bg-[#050607] focus:ring-0 focus-visible:ring-2 focus-visible:ring-[#cfd5dc]/70 active:translate-y-px active:bg-[#e9ecef] active:text-[#9aa1aa] active:shadow-none data-[pressed=true]:border-[#e5e7eb] data-[pressed=true]:bg-[#e9ecef] data-[pressed=true]:text-[#a5abb3] data-[pressed=true]:shadow-none disabled:pointer-events-none disabled:border-[#e5e7eb] disabled:bg-[#eef0f2] disabled:text-[#a6adb5] disabled:shadow-none";
const secondaryAuthButtonClass =
  "h-11 w-full rounded-[7px] border-[#cfd5dc] bg-white text-sm font-semibold text-[#111827] shadow-none transition-[background-color,border-color,box-shadow,transform] duration-150 hover:border-[#aeb7c2] hover:bg-[#f8fafc] focus:ring-0 focus-visible:ring-2 focus-visible:ring-[#cfd5dc]/70 active:translate-y-px active:border-[#d7dde3] active:bg-[#f1f3f5] active:text-[#9aa1aa] data-[pressed=true]:border-[#d7dde3] data-[pressed=true]:bg-[#f1f3f5] data-[pressed=true]:text-[#a5abb3] disabled:pointer-events-none disabled:border-[#d9dee4] disabled:bg-[#f6f7f8] disabled:text-[#a6adb5]";

type GoogleCredentialResponse = {
  credential?: string;
};

type GoogleAccounts = {
  id: {
    initialize: (config: {
      client_id: string;
      callback: (response: GoogleCredentialResponse) => void;
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
  const [scriptReady, setScriptReady] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | undefined>(() =>
    typeof window === "undefined"
      ? undefined
      : (window.sessionStorage.getItem(SESSION_STORAGE_KEY) ?? undefined),
  );
  const [error, setError] = useState<string | undefined>();
  const [signupStep, setSignupStep] = useState<
    "profile" | "password" | "verify"
  >("profile");
  const [signupForm, setSignupForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
  });
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [verificationCode, setVerificationCode] = useState<string[]>(
    Array.from({ length: VERIFICATION_CODE_LENGTH }, () => ""),
  );
  const [resendSeconds, setResendSeconds] = useState(0);
  const [isSendingVerification, setIsSendingVerification] = useState(false);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);
  const [pressedAction, setPressedAction] = useState<
    "continue" | "google" | undefined
  >();
  const verificationInputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const showPressedFeedback = useCallback(
    (action: "continue" | "google") => {
      setPressedAction(action);
      window.setTimeout(() => {
        setPressedAction((currentAction) =>
          currentAction === action ? undefined : currentAction,
        );
      }, PRESS_FEEDBACK_MS);
    },
    [],
  );

  const handleCredential = useCallback(async (response: GoogleCredentialResponse) => {
    if (!response.credential) {
      setError("Google did not finish the sign-in. Try the Google button again.");
      return;
    }

    // Confirm the account has APICenter access before keeping the credential, so a denied account
    // sees why it cannot sign in instead of landing on an empty console.
    setManagementSessionToken(response.credential);
    try {
      await getManagementSession();
    } catch (accessError) {
      setManagementSessionToken(undefined);
      setError(
        accessError instanceof Error
          ? accessError.message
          : "We could not confirm your APICenter access. Try again in a moment.",
      );
      return;
    }

    window.sessionStorage.setItem(SESSION_STORAGE_KEY, response.credential);
    setSessionToken(response.credential);
    setError(undefined);
  }, []);

  const updateSignupField = useCallback(
    (field: keyof typeof signupForm, value: string) => {
      setSignupForm((currentForm) => ({
        ...currentForm,
        [field]: value,
      }));
    },
    [],
  );

  const sendVerificationCode = useCallback(async () => {
    setIsSendingVerification(true);

    try {
      const response = await fetch("/api/local/signup/email-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: signupForm.email,
          firstName: signupForm.firstName,
          lastName: signupForm.lastName,
        }),
      });

      if (!response.ok) {
        setError("We could not send the email code. Try again in a moment.");
        return false;
      }

      setVerificationCode(Array.from({ length: VERIFICATION_CODE_LENGTH }, () => ""));
      setResendSeconds(RESEND_SECONDS);
      setError(undefined);
      return true;
    } catch {
      setError("We could not reach the email service. Check your connection and try again.");
      return false;
    } finally {
      setIsSendingVerification(false);
    }
  }, [signupForm.email, signupForm.firstName, signupForm.lastName]);

  const handleVerificationChange = useCallback(
    (index: number, event: ChangeEvent<HTMLInputElement>) => {
      const digit = event.target.value.replace(/\D/g, "").slice(-1);

      setVerificationCode((currentCode) => {
        const nextCode = [...currentCode];
        nextCode[index] = digit;
        return nextCode;
      });

      if (digit && index < VERIFICATION_CODE_LENGTH - 1) {
        verificationInputRefs.current[index + 1]?.focus();
      }
    },
    [],
  );

  const handleVerificationKeyDown = useCallback(
    (index: number, event: KeyboardEvent<HTMLInputElement>) => {
      if (
        event.key === "Backspace" &&
        !verificationCode[index] &&
        index > 0
      ) {
        verificationInputRefs.current[index - 1]?.focus();
      }
    },
    [verificationCode],
  );

  const verifyEmailCode = useCallback(async () => {
    const code = verificationCode.join("");

    if (code.length !== VERIFICATION_CODE_LENGTH) {
      setError("Enter the six-digit code from your email.");
      return false;
    }

    setIsVerifyingCode(true);

    try {
      const response = await fetch("/api/local/signup/verify-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code,
          email: signupForm.email,
        }),
      });

      if (!response.ok) {
        setError("That code is not right. Check the email and try again.");
        return false;
      }

      setError(undefined);
      return true;
    } catch {
      setError("We could not verify the code. Check your connection and try again.");
      return false;
    } finally {
      setIsVerifyingCode(false);
    }
  }, [signupForm.email, verificationCode]);

  useEffect(() => {
    setManagementSessionToken(sessionToken);

    return () => setManagementSessionToken(undefined);
  }, [sessionToken]);

  useEffect(() => {
    if (sessionToken && authenticatedRedirectHref) {
      window.location.assign(authenticatedRedirectHref);
    }
  }, [authenticatedRedirectHref, sessionToken]);

  useEffect(() => {
    if (signupStep !== "verify" || resendSeconds <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setResendSeconds((currentSeconds) => Math.max(0, currentSeconds - 1));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [resendSeconds, signupStep]);

  useEffect(() => {
    const handleSignOut = () => {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      window.google?.accounts.id.disableAutoSelect();
      setManagementSessionToken(undefined);
      setSessionToken(undefined);
    };

    window.addEventListener(MANAGEMENT_SIGN_OUT_EVENT, handleSignOut);
    return () =>
      window.removeEventListener(MANAGEMENT_SIGN_OUT_EVENT, handleSignOut);
  }, []);

  useEffect(() => {
    if (
      !scriptReady ||
      sessionToken ||
      !buttonRef.current ||
      !window.google ||
      !googleClientId
    ) {
      return;
    }

    buttonRef.current.innerHTML = "";
    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: handleCredential,
    });
    window.google.accounts.id.renderButton(buttonRef.current, {
      theme: "outline",
      size: "large",
      type: "standard",
      shape: "rectangular",
      text: "continue_with",
      width: 440,
    });
  }, [googleClientId, handleCredential, scriptReady, sessionToken]);

  if (sessionToken) {
    if (authenticatedRedirectHref) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-white text-[#0b0d12]">
          <p className="text-sm font-medium text-[#59616d]">
            Opening APICenter...
          </p>
        </main>
      );
    }

    return children;
  }

  return (
    <main className="grid min-h-screen bg-white text-[#0b1220] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] [font-family:Inter,ui-sans-serif,system-ui,sans-serif]">
      <Script
        src={GOOGLE_IDENTITY_SCRIPT}
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
        onError={() =>
          setError("Google sign-in could not load. Refresh the page and try again.")
        }
      />
      <section className="flex min-h-screen items-center justify-center px-6 py-12 sm:px-10 lg:px-16">
        <div className="flex min-h-[calc(100vh-6rem)] w-full max-w-[560px] flex-col">
          <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center">
            <ApicenterGlyph />
            <h1 className="mt-6 text-[28px] font-semibold leading-tight tracking-normal text-[#07111f]">
              {signupStep === "verify" ? "Verify your email" : "Sign up for APICenter"}
            </h1>

            <form
              className="mt-8"
              onSubmit={async (event) => {
                event.preventDefault();
                showPressedFeedback("continue");

                if (signupStep === "profile") {
                  const email = signupForm.email.trim();

                  if (!email) {
                    setError("Add your email first, then we can create your account.");
                    return;
                  }

                  setSignupForm((currentForm) => ({
                    ...currentForm,
                    email,
                  }));
                  setSignupStep("password");
                  setError(undefined);
                  return;
                }

                if (signupStep === "verify") {
                  await verifyEmailCode();
                  return;
                }

                if (!signupForm.password.trim()) {
                  setError("Create a password to continue.");
                  return;
                }

                const sent = await sendVerificationCode();

                if (sent) {
                  setSignupStep("verify");
                  window.setTimeout(
                    () => verificationInputRefs.current[0]?.focus(),
                    0,
                  );
                }
              }}
            >
              {signupStep === "profile" ? (
                <FieldGroup className="gap-5">
                  <FieldGroup className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel className="text-[#111827]" htmlFor="first-name">
                        First name
                      </FieldLabel>
                      <Input
                        id="first-name"
                        className="h-11 rounded-[7px] border-[#d0d7de] bg-white px-3 text-base text-[#111827] shadow-[0_1px_1px_rgba(15,23,42,0.02)] placeholder:text-[#8b95a1] focus-visible:border-[#6a8dff] focus-visible:ring-[#6a8dff]/25"
                        placeholder="Your first name"
                        autoComplete="given-name"
                        value={signupForm.firstName}
                        onChange={(event) =>
                          updateSignupField("firstName", event.target.value)
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel className="text-[#111827]" htmlFor="last-name">
                        Last name
                      </FieldLabel>
                      <Input
                        id="last-name"
                        className="h-11 rounded-[7px] border-[#d0d7de] bg-white px-3 text-base text-[#111827] shadow-[0_1px_1px_rgba(15,23,42,0.02)] placeholder:text-[#8b95a1] focus-visible:border-[#6a8dff] focus-visible:ring-[#6a8dff]/25"
                        placeholder="Your last name"
                        autoComplete="family-name"
                        value={signupForm.lastName}
                        onChange={(event) =>
                          updateSignupField("lastName", event.target.value)
                        }
                      />
                    </Field>
                  </FieldGroup>

                  <Field>
                    <FieldLabel className="text-[#111827]" htmlFor="email">
                      Email
                    </FieldLabel>
                    <Input
                      id="email"
                      className="h-11 rounded-[7px] border-[#d0d7de] bg-white px-3 text-base text-[#111827] shadow-[0_1px_1px_rgba(15,23,42,0.02)] placeholder:text-[#8b95a1] focus-visible:border-[#6a8dff] focus-visible:ring-[#6a8dff]/25"
                      placeholder="Your email address"
                      autoComplete="email"
                      type="email"
                      value={signupForm.email}
                      onChange={(event) =>
                        updateSignupField("email", event.target.value)
                      }
                    />
                  </Field>

                  <Button
                    className={primaryAuthButtonClass}
                    data-pressed={pressedAction === "continue"}
                    type="submit"
                  >
                    Continue
                  </Button>
                </FieldGroup>
              ) : signupStep === "password" ? (
                <FieldGroup className="gap-5">
                  <Field>
                    <FieldLabel className="text-[#111827]" htmlFor="confirmed-email">
                      Email
                    </FieldLabel>
                    <Input
                      id="confirmed-email"
                      className="h-11 cursor-default rounded-[7px] border-[#e5e7eb] bg-[#eceeef] px-3 text-base text-[#475569] shadow-none disabled:cursor-default disabled:opacity-100"
                      value={signupForm.email}
                      disabled
                      readOnly
                      tabIndex={-1}
                    />
                  </Field>

                  <Field>
                    <FieldLabel className="text-[#111827]" htmlFor="password">
                      Password
                    </FieldLabel>
                    <div className="relative">
                      <Input
                        id="password"
                        className="h-11 rounded-[7px] border-[#d0d7de] bg-white px-3 pr-10 text-base text-[#111827] shadow-[0_1px_1px_rgba(15,23,42,0.02)] placeholder:text-[#8b95a1] focus-visible:border-[#6a8dff] focus-visible:ring-[#6a8dff]/25"
                        placeholder="Create a password"
                        autoComplete="new-password"
                        type={passwordVisible ? "text" : "password"}
                        value={signupForm.password}
                        onChange={(event) =>
                          updateSignupField("password", event.target.value)
                        }
                      />
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger
                            aria-label={
                              passwordVisible ? "Hide password" : "Show password"
                            }
                            className="absolute right-1.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-[6px] text-[#5f6875] transition-colors hover:bg-[#f1f3f5] hover:text-[#111827] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#cfd5dc]/80"
                            type="button"
                            onClick={() =>
                              setPasswordVisible((isVisible) => !isVisible)
                            }
                          >
                            {passwordVisible ? (
                              <EyeIcon aria-hidden="true" className="size-4" />
                            ) : (
                              <EyeOffIcon aria-hidden="true" className="size-4" />
                            )}
                          </TooltipTrigger>
                          <TooltipContent className="bg-[#111416] text-white">
                            {passwordVisible ? "Hide password" : "Show password"}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </Field>

                  <Button
                    className={primaryAuthButtonClass}
                    data-pressed={pressedAction === "continue"}
                    disabled={isSendingVerification}
                    type="submit"
                  >
                    {isSendingVerification ? "Sending code..." : "Continue"}
                  </Button>
                  <Button
                    className="mx-auto h-auto rounded-[7px] px-2 py-1 text-sm font-medium text-[#4b5563] hover:bg-transparent hover:text-[#111827] focus:ring-0 focus-visible:ring-2 focus-visible:ring-[#cfd5dc]/70"
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setSignupStep("profile");
                      setError(undefined);
                    }}
                  >
                    <ChevronLeftIcon data-icon="inline-start" />
                    Go back
                  </Button>
                </FieldGroup>
              ) : (
                <FieldGroup className="gap-5">
                  <div>
                    <p className="text-sm text-[#111827]">
                      Enter the code sent to{" "}
                      <span className="font-semibold">{signupForm.email}</span>
                    </p>
                    <div className="mt-5 grid grid-cols-6 gap-3">
                      {verificationCode.map((digit, index) => (
                        <Input
                          aria-label={`Verification code digit ${index + 1}`}
                          autoComplete={index === 0 ? "one-time-code" : "off"}
                          className="h-12 rounded-[7px] border-[#cfd5dc] bg-white p-0 text-center text-xl font-medium text-[#111827] shadow-[0_1px_1px_rgba(15,23,42,0.02)] focus-visible:border-[#6a8dff] focus-visible:ring-[#6a8dff]/25"
                          inputMode="numeric"
                          key={`verification-code-${index}`}
                          maxLength={1}
                          pattern="[0-9]*"
                          ref={(element) => {
                            verificationInputRefs.current[index] = element;
                          }}
                          type="text"
                          value={digit}
                          onChange={(event) =>
                            handleVerificationChange(index, event)
                          }
                          onKeyDown={(event) =>
                            handleVerificationKeyDown(index, event)
                          }
                        />
                      ))}
                    </div>
                  </div>

                  <div className="text-center text-sm">
                    <p className="text-[#111827]">Didn&apos;t receive a code?</p>
                    {resendSeconds > 0 ? (
                      <p className="mt-1 text-[#59616d]">
                        Resend in {resendSeconds}
                      </p>
                    ) : (
                      <Button
                        className="mx-auto mt-1 h-auto rounded-[7px] px-2 py-1 text-sm font-medium text-[#005bd3] hover:bg-transparent hover:text-[#003f94] focus:ring-0 focus-visible:ring-2 focus-visible:ring-[#cfd5dc]/70"
                        disabled={isSendingVerification}
                        type="button"
                        variant="ghost"
                        onClick={sendVerificationCode}
                      >
                        {isSendingVerification ? "Sending..." : "Resend code"}
                      </Button>
                    )}
                  </div>

                  <Button
                    className={primaryAuthButtonClass}
                    data-pressed={pressedAction === "continue"}
                    disabled={isVerifyingCode}
                    type="submit"
                  >
                    {isVerifyingCode ? "Verifying..." : "Continue"}
                  </Button>

                  <Button
                    className="mx-auto h-auto rounded-[7px] px-2 py-1 text-sm font-medium text-[#4b5563] hover:bg-transparent hover:text-[#111827] focus:ring-0 focus-visible:ring-2 focus-visible:ring-[#cfd5dc]/70"
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setSignupStep("password");
                      setError(undefined);
                    }}
                  >
                    <ChevronLeftIcon data-icon="inline-start" />
                    Back to sign-in
                  </Button>
                </FieldGroup>
              )}
            </form>

            {signupStep === "profile" ? (
              <>
                <FieldSeparator className="my-7 [&_[data-slot=field-separator-content]]:bg-white [&_[data-slot=field-separator-content]]:text-xs [&_[data-slot=field-separator-content]]:font-medium [&_[data-slot=field-separator-content]]:uppercase [&_[data-slot=separator]]:bg-[#e0e4e8]">
                  or
                </FieldSeparator>

                <div className="flex min-h-11 w-full items-center justify-center overflow-hidden">
                  {googleClientId ? (
                    scriptReady ? (
                      <div
                        ref={buttonRef}
                        className="flex w-full justify-center rounded-[7px] border border-[#cfd5dc] bg-white transition-[background-color,border-color,box-shadow,transform] duration-150 hover:border-[#aeb7c2] hover:bg-[#f8fafc] active:translate-y-px active:bg-[#f1f3f5] focus-within:ring-2 focus-within:ring-[#cfd5dc]/70"
                      />
                    ) : (
                      <Button
                        className={secondaryAuthButtonClass}
                        type="button"
                        variant="outline"
                        disabled
                      >
                        <GoogleGlyph />
                        Continue with Google
                      </Button>
                    )
                  ) : (
                    <Button
                      className={secondaryAuthButtonClass}
                      data-pressed={pressedAction === "google"}
                      type="button"
                      variant="outline"
                      onClick={() => {
                        showPressedFeedback("google");
                        setError(
                          "Google sign-in is not connected yet. Add your Google client ID, then try again.",
                        );
                      }}
                    >
                      <GoogleGlyph />
                      Continue with Google
                    </Button>
                  )}
                </div>
                {!scriptReady && !error && googleClientId ? (
                  <p className="mt-3 text-sm text-[#59616d]">
                    Loading Google sign-up...
                  </p>
                ) : null}
              </>
            ) : null}
            <FieldError className="mt-3 rounded-[7px] border border-[#ffd7d7] bg-[#fff7f7] px-3 py-2 text-[#9f1c1c]">
              {error}
            </FieldError>
            {signupStep === "profile" ? (
              <p className="mt-7 text-sm text-[#59616d]">
                Already have an account?{" "}
                <Link
                  className="font-medium text-[#005bd3] hover:text-[#003f94]"
                  href="/dashboard"
                >
                  Sign in
                </Link>
              </p>
            ) : null}
          </div>

          <p className="mx-auto mt-auto max-w-[320px] pt-10 text-center text-sm leading-5 text-[#59616d]">
            <span className="block">By creating an account, you agree to the</span>
            <Link
              className="block text-[#1d4ed8] hover:text-[#143a9e]"
              href="/#terms"
            >
              Terms of Service
            </Link>
          </p>
        </div>
      </section>
      <section
        className="relative hidden min-h-screen overflow-hidden bg-[#04042d] lg:block"
        data-testid="auth-showcase-panel"
        aria-label="APICenter product visual"
      >
        <div
          className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(96,165,250,0.18),transparent_28%),radial-gradient(circle_at_86%_78%,rgba(34,211,166,0.13),transparent_32%),linear-gradient(135deg,#04042d_0%,#05056c_58%,#031d2d_100%)]"
          aria-hidden="true"
        />
        <AuthProductSurface />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-[#04042d] to-transparent"
          aria-hidden="true"
        />
      </section>
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

function ApicenterGlyph() {
  return (
    <Image
      src="/brand/apicenter-logo-icon-v2.png"
      alt=""
      aria-hidden="true"
      width={44}
      height={44}
      className="size-11 object-contain"
    />
  );
}

function AuthProductSurface() {
  return (
    <div
      className="absolute left-[-5%] top-[11%] h-[86vh] min-h-[760px] w-[122%] origin-top-left rotate-[5deg] overflow-hidden rounded-[24px] border border-[#d9e0e6] bg-[#f8fafc] shadow-[0_26px_90px_rgba(0,0,0,0.30)] ring-8 ring-[#5550d8]/45"
      data-testid="auth-product-surface"
    >
      <div className="flex h-16 items-center gap-4 border-b border-[#dfe5ea] bg-white px-7 text-sm text-[#5f6875]">
        <ApicenterMiniMark />
        <span className="font-medium text-[#111820]">APICenter</span>
        <span className="text-[#a4acb7]">/</span>
        <span className="rounded-[7px] bg-[#dffaf4] px-2.5 py-1 font-semibold text-[#087668]">
          Gateway
        </span>
        <span className="rounded-full bg-[#e8f1ff] px-2.5 py-1 font-medium text-[#155bd4]">
          production
        </span>
      </div>
      <div className="flex h-14 items-center gap-9 border-b border-[#e4e9ee] bg-white px-7 text-sm font-medium text-[#747d89]">
        <span className="border-b-2 border-[#111820] pb-4 text-[#111820]">
          Environment
        </span>
        <span>Routes</span>
        <span>Policies</span>
        <span>OAuth</span>
        <span>Audit</span>
      </div>
      <div className="relative h-[calc(100%-7.5rem)] overflow-hidden bg-[radial-gradient(#cfd7df_1px,transparent_1px)] bg-[size:18px_18px] p-8">
        <div className="mb-7 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-[#87909c]">Tenant runtime</div>
            <div className="mt-1 text-2xl font-semibold tracking-normal text-[#151a21]">
              governed-api-prod
            </div>
          </div>
          <div className="rounded-[8px] border border-[#d5dde5] bg-white px-4 py-2 text-sm font-semibold text-[#111820] shadow-sm">
            Policy checks active
          </div>
        </div>
        <div className="grid grid-cols-[0.9fr_1.1fr_0.8fr] gap-6">
          <SurfaceColumn
            title="Edge gateway"
            rows={["DDoS protection", "Rate limits", "OAuth handoff"]}
          />
          <ControlPlaneVisual />
          <SurfaceColumn
            title="Shared services"
            rows={["Google auth", "Observability", "Audit trail"]}
          />
        </div>
        <div className="mt-6 grid grid-cols-3 gap-6">
          <SurfaceCard title="Tenant registry" value="42 runtimes" />
          <SurfaceCard title="Route policy" value="98.8% pass" />
          <SurfaceCard title="Gateway latency" value="44ms p95" />
        </div>
      </div>
    </div>
  );
}

function ControlPlaneVisual() {
  return (
    <div
      className="relative h-[430px] overflow-hidden rounded-[16px] border border-[#d6dee6] bg-[linear-gradient(145deg,#f8fbfd_0%,#eef6f7_52%,#edf8f4_100%)] shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
      data-testid="auth-architecture-visual"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_46%,rgba(34,211,166,0.18),transparent_26%),radial-gradient(circle_at_20%_20%,rgba(96,165,250,0.12),transparent_24%)]" />
      <div className="absolute left-5 top-5 rounded-[8px] border border-[#d7e0e7] bg-white/85 px-3 py-2 text-sm font-semibold text-[#151a21] shadow-sm backdrop-blur">
        API control plane
      </div>

      <svg
        className="absolute inset-0 size-full"
        viewBox="0 0 560 430"
        role="img"
        aria-label="Requests entering APICenter and routing to governed services"
      >
        <defs>
          <linearGradient id="routeSignal" x1="80" x2="480" y1="120" y2="310">
            <stop offset="0%" stopColor="#2dd4bf" />
            <stop offset="52%" stopColor="#0f766e" />
            <stop offset="100%" stopColor="#2563eb" />
          </linearGradient>
          <filter id="softGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="9" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path
          d="M76 148 C158 148 174 214 256 214"
          fill="none"
          stroke="url(#routeSignal)"
          strokeLinecap="round"
          strokeWidth="7"
        />
        <path
          d="M74 286 C154 286 178 232 256 232"
          fill="none"
          stroke="#38bdf8"
          strokeLinecap="round"
          strokeWidth="7"
          opacity="0.85"
        />
        <path
          d="M304 215 C386 214 398 142 486 142"
          fill="none"
          stroke="#14b8a6"
          strokeLinecap="round"
          strokeWidth="7"
          opacity="0.9"
        />
        <path
          d="M304 232 C382 234 398 292 486 292"
          fill="none"
          stroke="#2563eb"
          strokeLinecap="round"
          strokeWidth="7"
          opacity="0.86"
        />

        <rect
          x="229"
          y="170"
          width="102"
          height="102"
          rx="26"
          fill="#082f2c"
          filter="url(#softGlow)"
        />
        <rect x="247" y="188" width="66" height="66" rx="17" fill="#22d3a6" />
        <path
          d="M265 221 L279 235 L301 206"
          fill="none"
          stroke="#042f2e"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="8"
        />

        {[
          [72, 132],
          [72, 270],
          [470, 126],
          [470, 276],
        ].map(([x, y], index) => (
          <g key={`${x}-${y}`}>
            <rect
              x={x}
              y={y}
              width="64"
              height="40"
              rx="12"
              fill="#ffffff"
              stroke="#d7e0e7"
            />
            <circle
              cx={x + 20}
              cy={y + 20}
              r="7"
              fill={index < 2 ? "#22d3a6" : "#2563eb"}
            />
            <path
              d={`M${x + 34} ${y + 16} H${x + 50} M${x + 34} ${y + 24} H${x + 46}`}
              stroke="#94a3b8"
              strokeLinecap="round"
              strokeWidth="4"
            />
          </g>
        ))}
      </svg>

      <div className="absolute bottom-5 left-5 right-5 grid grid-cols-3 gap-3">
        {[
          ["OAuth", "verified"],
          ["Policy", "passed"],
          ["Audit", "written"],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-[10px] border border-white/70 bg-white/75 px-3 py-2 shadow-sm backdrop-blur"
          >
            <div className="text-xs font-medium text-[#718096]">{label}</div>
            <div className="mt-0.5 text-sm font-semibold text-[#0f172a]">
              {value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ApicenterMiniMark() {
  return (
    <span className="grid size-8 place-items-center rounded-[8px] bg-[#091317] text-[13px] font-bold text-white">
      A
    </span>
  );
}

function SurfaceColumn({
  title,
  rows,
}: {
  title: string;
  rows: string[];
}) {
  return (
    <div className="rounded-[14px] border border-[#d6dee6] bg-white/92 p-5 shadow-sm">
      <div className="text-base font-semibold text-[#151a21]">{title}</div>
      <div className="mt-5 flex flex-col gap-4">
        {rows.map((row) => (
          <div key={row} className="flex items-center justify-between text-sm">
            <span className="text-[#7a8490]">{row}</span>
            <span className="flex items-center gap-2 font-medium text-[#09836f]">
              <span className="size-2 rounded-full bg-[#22d3a6]" />
              Enabled
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SurfaceCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-[14px] border border-[#d6dee6] bg-white/92 p-5 shadow-sm">
      <div className="text-sm font-medium text-[#7a8490]">{title}</div>
      <div className="mt-2 text-xl font-semibold text-[#151a21]">{value}</div>
    </div>
  );
}

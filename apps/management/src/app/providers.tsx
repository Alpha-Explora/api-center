"use client";

import { BrandMark } from "@/components/brand-mark";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ManagementAuthGate } from "@/components/management-auth-gate";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({
  children,
  authMode = "local-dev",
  googleClientId,
}: {
  children: React.ReactNode;
  authMode?: "local-dev" | "google";
  googleClientId?: string;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 30_000,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {authMode === "google" ? (
          googleClientId ? (
            <ManagementAuthGate googleClientId={googleClientId}>
              {children}
            </ManagementAuthGate>
          ) : (
            <MissingGoogleConfig />
          )
        ) : (
          children
        )}
        {/* Top center: sheets open from the right and phone dialogs sit low, so a bottom toast covers their footer buttons. */}
        <Toaster position="top-center" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function MissingGoogleConfig() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-12 text-foreground">
      <section role="alert" className="w-full max-w-[380px] rounded-lg border bg-card p-6 shadow-xs sm:p-8">
        <BrandMark size={32} />
        <h1 className="mt-5 text-xl font-semibold tracking-tight">Google sign-in is not configured</h1>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          This console uses Google sign-in, but it has no Google client ID. Set it and redeploy.
        </p>
        <pre className="mt-5 overflow-x-auto rounded-md border bg-muted/50 px-3 py-2.5 font-mono text-xs leading-5">
          MANAGEMENT_AUTH_MODE=google{"\n"}
          NEXT_PUBLIC_GOOGLE_CLIENT_ID=&lt;client-id&gt;
        </pre>
      </section>
    </main>
  );
}

"use client";

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
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function MissingGoogleConfig() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section className="w-full max-w-lg rounded-lg border bg-card p-5 shadow-sm">
        <h1 className="text-lg font-semibold">Google auth is not configured</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Set NEXT_PUBLIC_GOOGLE_CLIENT_ID before deploying with MANAGEMENT_AUTH_MODE=google.
        </p>
      </section>
    </main>
  );
}

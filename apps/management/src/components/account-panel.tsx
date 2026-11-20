"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { LogOutIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorPanel } from "@/components/patterns/notices";
import { DescriptionList, Panel } from "@/components/patterns/panel";
import { MANAGEMENT_SIGN_OUT_EVENT } from "@/components/management-auth-gate";
import { useOrganization } from "@/features/control-plane/view-models/use-organization";
import { cn } from "@/lib/utils";

const THEMES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

/** Who is signed in, the console's theme, and signing out of this browser. */
export function AccountPanel() {
  const { session, loading, organizations } = useOrganization();
  const { theme, setTheme } = useTheme();
  // The theme is only known in the browser; render the choice there to avoid a mismatched first paint.
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  if (loading) return <Skeleton className="h-40 w-full" />;
  if (!session) return <ErrorPanel title="Your session could not be verified" error="Sign in again." />;
  return (
    <Panel
      title="Account"
      description="Signing in keeps you signed in on this browser for 12 hours, in every tab."
      actions={
        <Button size="sm" variant="outline" onClick={() => window.dispatchEvent(new Event(MANAGEMENT_SIGN_OUT_EVENT))}>
          <LogOutIcon data-icon="inline-start" /> Sign out
        </Button>
      }
    >
      <DescriptionList
        items={[
          { label: "Signed in as", value: session.name ? `${session.name} (${session.email})` : session.email },
          { label: "Sign-in", value: session.source === "google" ? "Google" : "Local development" },
          ...(session.platformAdmin ? [{ label: "Access", value: "Platform operator: acts in every organization" }] : []),
          {
            label: "Organizations",
            value: organizations.length ? organizations.map((entry) => entry.name).join(", ") : "None",
          },
          {
            label: "Theme",
            value: mounted ? (
              <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-md border bg-muted/40 p-0.5">
                {THEMES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={(theme ?? "system") === option.value}
                    onClick={() => setTheme(option.value)}
                    className={cn(
                      "rounded-[5px] px-2.5 py-0.5 text-xs",
                      (theme ?? "system") === option.value ? "bg-background font-medium shadow-xs" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : (
              <Skeleton className="h-6 w-40" />
            ),
          },
        ]}
      />
    </Panel>
  );
}

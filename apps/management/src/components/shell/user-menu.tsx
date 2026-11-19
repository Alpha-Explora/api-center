"use client";
import { ChevronsUpDownIcon, LogOutIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MANAGEMENT_SIGN_OUT_EVENT } from "@/components/management-auth-gate";
import { useOrganization } from "@/features/control-plane/view-models/use-organization";

export function UserMenu({ authMode }: { authMode: "local-dev" | "google" }) {
  const { session } = useOrganization();
  const { theme, setTheme } = useTheme();
  const name = session?.name ?? session?.email ?? "Signed in";
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex h-10 w-full items-center gap-2.5 rounded-md px-1.5 text-left transition-colors hover:bg-sidebar-accent aria-expanded:bg-sidebar-accent"
          />
        }
      >
        <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
          {initials || "?"}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] leading-4 font-medium">{name}</span>
          <span className="truncate text-[11px] leading-4 text-muted-foreground">
            {session?.platformAdmin ? "Platform operator" : (session?.email ?? "")}
          </span>
        </span>
        <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60" align="start" side="top">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">{session?.email ?? "Not signed in"}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={(value) => setTheme(String(value))}>
            <DropdownMenuRadioItem value="system">
              <MonitorIcon /> System
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="light">
              <SunIcon /> Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <MoonIcon /> Dark
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {authMode === "google" ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => window.dispatchEvent(new Event(MANAGEMENT_SIGN_OUT_EVENT))}>
              <LogOutIcon /> Sign out
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

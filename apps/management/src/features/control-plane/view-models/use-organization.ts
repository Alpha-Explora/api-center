"use client";
import { useCallback, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { getManagementSession } from "@/lib/api-center-client";
import { controlPlane } from "../data/control-plane-repository";
import { accessFrom } from "../model/access";
import { cpKeys } from "./query-keys";

const STORAGE_KEY = "apicenter.controlPlane.organizationId";
const CHANGE_EVENT = "apicenter:organization-change";

function readStored(): string | undefined {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Platform operators can open organizations they are not members of; only the ID is known then. */
function unnamed(id: string) {
  return `Organization ${id.slice(0, 8)}`;
}

export type OrganizationOption = { id: string; name: string; slug?: string };

/**
 * The organization every workspace screen acts on: a remembered choice while the session may still act on
 * it, else the first membership. Platform operators without memberships name one by ID.
 */
export function useOrganization() {
  const session = useQuery({ queryKey: cpKeys.session, queryFn: getManagementSession, retry: false, staleTime: 60_000 });
  const chosen = useSyncExternalStore(subscribe, readStored, () => undefined);
  const memberships = session.data?.organizationIds ?? [];
  const platformAdmin = session.data?.platformAdmin ?? false;
  const organizationId = chosen && (memberships.includes(chosen) || platformAdmin) ? chosen : memberships[0];
  const names = new Map((session.data?.organizations ?? []).map((entry) => [entry.id, entry]));
  const organizations: OrganizationOption[] = memberships.map((id) => ({ id, name: names.get(id)?.name ?? unnamed(id), slug: names.get(id)?.slug }));
  if (organizationId && !memberships.includes(organizationId)) organizations.push({ id: organizationId, name: unnamed(organizationId) });

  const setOrganizationId = useCallback((value: string) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Remembering the choice is a convenience only.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return {
    organizationId: session.data ? organizationId : undefined,
    organization: organizations.find((entry) => entry.id === organizationId),
    setOrganizationId,
    organizations,
    platformAdmin,
    session: session.data,
    loading: session.isLoading,
  };
}

/** The signed-in person's roles in the current organization. */
export function useAccess(organizationId: string | undefined) {
  const me = useQuery({
    queryKey: cpKeys.me(organizationId ?? "none"),
    queryFn: () => controlPlane.me(organizationId as string),
    enabled: Boolean(organizationId),
    retry: false,
    staleTime: 60_000,
  });
  return { access: accessFrom(me.data), loading: me.isLoading, error: me.error };
}

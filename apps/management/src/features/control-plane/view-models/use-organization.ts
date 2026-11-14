"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getManagementSession } from "@/lib/api-center-client";

const STORAGE_KEY = "apicenter.controlPlane.organizationId";

function readStored(): string | undefined {
  try {
    return typeof window === "undefined" ? undefined : (window.localStorage.getItem(STORAGE_KEY) ?? undefined);
  } catch {
    return undefined;
  }
}

/** The organization the workspace screens act on: a remembered choice, else the first membership. */
export function useOrganization() {
  const session = useQuery({ queryKey: ["management-session"], queryFn: getManagementSession, retry: false });
  const [chosen, setChosen] = useState<string | undefined>(readStored);
  const memberships = session.data?.organizationIds ?? [];
  const platformAdmin = session.data?.platformAdmin ?? false;
  // A remembered organization applies only while the session may still act on it.
  const organizationId = chosen && (memberships.includes(chosen) || platformAdmin) ? chosen : memberships[0];

  function setOrganizationId(value: string) {
    setChosen(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Remembering the choice is a convenience only.
    }
  }

  return {
    organizationId: session.data ? organizationId : undefined,
    setOrganizationId,
    organizations: memberships,
    platformAdmin,
    loading: session.isLoading,
  };
}

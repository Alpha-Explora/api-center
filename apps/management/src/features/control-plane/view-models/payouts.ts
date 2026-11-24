"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { payouts } from "../data/payouts";
import type { EnvironmentKind } from "../model/control-plane";
import type { LinkedAccountAction, PayoutPolicy } from "../model/payouts";
import { useProjectEnvironment } from "./project-environment";
import { cpKeys } from "./query-keys";

export const payoutsKey = (organizationId: string, projectId: string, kind: EnvironmentKind) =>
  [...cpKeys.environment(organizationId, projectId, kind), "payouts"] as const;

function useScope() {
  const { organizationId, project, kind } = useProjectEnvironment();
  return { organizationId, projectId: project.id, kind };
}

export function useLinkedAccount() {
  const scope = useScope();
  return useQuery({
    queryKey: [...payoutsKey(scope.organizationId, scope.projectId, scope.kind), "linked-account"],
    queryFn: () => payouts.linkedAccount(scope),
  });
}

export function useUpdateLinkedAccount() {
  const scope = useScope();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (action: LinkedAccountAction) => payouts.updateLinkedAccount(scope, action),
    onSettled: () => void invalidate(),
    gcTime: 0,
  });
}

export function usePayoutOverview() {
  const scope = useScope();
  return useQuery({ queryKey: [...payoutsKey(scope.organizationId, scope.projectId, scope.kind), "overview"], queryFn: () => payouts.overview(scope) });
}

export function usePayoutSettings() {
  const scope = useScope();
  return useQuery({ queryKey: [...payoutsKey(scope.organizationId, scope.projectId, scope.kind), "settings"], queryFn: () => payouts.settings(scope) });
}

export function usePayees() {
  const scope = useScope();
  return useQuery({ queryKey: [...payoutsKey(scope.organizationId, scope.projectId, scope.kind), "payees"], queryFn: () => payouts.payees(scope) });
}

export function usePayee(payeeId: string | null) {
  const scope = useScope();
  return useQuery({
    queryKey: [...payoutsKey(scope.organizationId, scope.projectId, scope.kind), "payee", payeeId],
    queryFn: () => payouts.payee(scope, payeeId!),
    enabled: payeeId !== null,
  });
}

export function usePayouts() {
  const scope = useScope();
  return useQuery({ queryKey: [...payoutsKey(scope.organizationId, scope.projectId, scope.kind), "list"], queryFn: () => payouts.list(scope) });
}

/** Mutations refresh every payouts query of the environment. */
function useInvalidate() {
  const scope = useScope();
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: payoutsKey(scope.organizationId, scope.projectId, scope.kind) });
}

export function useSavePayoutSettings() {
  const scope = useScope();
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (policy: PayoutPolicy) => payouts.saveSettings(scope, policy), onSuccess: () => void invalidate() });
}

export function useResolvePayout() {
  const scope = useScope();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: { payoutId: string; outcome: "paid" | "failed"; note: string }) =>
      payouts.resolve(scope, input.payoutId, input.outcome, input.note),
    onSuccess: () => void invalidate(),
  });
}

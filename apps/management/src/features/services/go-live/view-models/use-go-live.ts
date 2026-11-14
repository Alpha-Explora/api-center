"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  loadGoLive,
  revokePaymentKey,
  requestVerification,
} from "../data/go-live-repository";

export function useGoLive(serviceId: string, environment: "test" | "live") {
  const client = useQueryClient();
  const queryKey = ["service-go-live", serviceId, environment];
  const query = useQuery({
    queryKey,
    queryFn: () => loadGoLive(serviceId, environment),
    retry: false,
  });
  const revoke = useMutation({
    mutationFn: revokePaymentKey,
    onSuccess: () => client.invalidateQueries({ queryKey }),
  });
  const verify = useMutation({
    mutationFn: requestVerification,
    onSuccess: () => client.invalidateQueries({ queryKey }),
  });
  return { ...query, revoke, verify };
}

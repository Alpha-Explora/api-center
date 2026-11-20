import { z } from "zod";
import { environmentKindSchema, type EnvironmentKind } from "./control-plane";
import { accessRequestSchema } from "./published-apis";

/** An API access request a project made, with the requested API's name (null when the API is gone). */
export const outgoingRequestSchema = accessRequestSchema.extend({
  rejectionReason: z.string().nullable().optional(),
  api: z.object({ name: z.string(), slug: z.string(), projectId: z.string(), environmentKind: environmentKindSchema }).nullable(),
});
export type OutgoingRequest = z.infer<typeof outgoingRequestSchema>;

/**
 * One application's requests in one environment: pending first (oldest first, the longest waiting on
 * top), then decided ones, newest decision first.
 */
export function outgoingForApplication(requests: OutgoingRequest[], applicationId: string, kind: EnvironmentKind) {
  const mine = requests.filter((request) => request.consumerApplicationId === applicationId && (!request.api || request.api.environmentKind === kind));
  const pending = mine.filter((request) => request.status === "pending").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const decided = mine
    .filter((request) => request.status !== "pending")
    .sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt));
  return [...pending, ...decided];
}

/** A rejection reason is optional; the gateway keeps at most 500 characters. */
export const MAX_REJECTION_REASON = 500;

export function rejectionReasonBody(reason: string): { reason?: string } {
  const trimmed = reason.trim().slice(0, MAX_REJECTION_REASON);
  return trimmed ? { reason: trimmed } : {};
}

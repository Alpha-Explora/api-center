import { z } from "zod";
import { projectHref } from "@/lib/app-navigation";
import { environmentKindSchema } from "./control-plane";

const base = {
  id: z.string(),
  organizationId: z.string(),
  organizationName: z.string(),
  /** The project whose administrators decide it. */
  projectId: z.string(),
  projectName: z.string(),
  summary: z.string(),
  requestedBy: z.string(),
  requestedAt: z.string(),
  /** The decide routes refuse a requester deciding their own request. */
  requestedByYou: z.boolean(),
  /** Set on recently decided items. */
  decision: z
    .object({
      status: z.enum(["approved", "rejected", "applied", "cancelled"]),
      by: z.string().nullable(),
      at: z.string(),
      reason: z.string().optional(),
    })
    .optional(),
};

/** How a decided item reads: "Approved", "Activated" (an approval that was used), "Rejected", "Cancelled". */
export const DECISION_LABEL: Record<"approved" | "rejected" | "applied" | "cancelled", string> = {
  approved: "Approved",
  applied: "Activated",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const approvalItemSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("live_activation"), reason: z.string() }),
  z.object({
    ...base,
    kind: z.literal("api_access"),
    apiId: z.string(),
    apiName: z.string(),
    action: z.string(),
    environmentKind: environmentKindSchema,
    consumerProjectId: z.string(),
    consumerProjectName: z.string(),
    consumerApplicationId: z.string(),
    consumerApplicationName: z.string(),
  }),
]);
export type ApprovalItem = z.infer<typeof approvalItemSchema>;

/** Where the item is decided: the project's live overview, or the API's page. */
export function approvalHref(item: ApprovalItem): string {
  return item.kind === "live_activation"
    ? projectHref(item.projectId, "live")
    : projectHref(item.projectId, item.environmentKind, `/apis/${encodeURIComponent(item.apiId)}`);
}

/** Items the person can act on: their own requests wait for someone else. */
export function awaitingYou(items: ApprovalItem[] | undefined): number {
  return (items ?? []).filter((item) => !item.requestedByYou).length;
}

export const APPROVAL_KIND_LABEL: Record<ApprovalItem["kind"], string> = {
  live_activation: "Live activation",
  api_access: "API access",
};

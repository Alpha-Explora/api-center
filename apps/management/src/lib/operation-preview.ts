import type { ActionRisk } from "./action-policy";
import type { ManagementEnvironment } from "./server/management-auth";

type OperationPreviewInput = {
  actionId: string;
  environment: ManagementEnvironment;
  risk: ActionRisk;
  changes: string[];
};

export function createOperationPreview(input: OperationPreviewInput) {
  return {
    actionId: input.actionId,
    environment: input.environment,
    risk: input.risk,
    changes: input.changes,
    confirmationPhrase: input.environment === "live" ? "APPLY LIVE CHANGE" : undefined,
    reasonRequired: input.environment === "live" && input.risk !== "read",
  };
}

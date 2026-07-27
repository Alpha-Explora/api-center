import type { ActionRisk } from "@/lib/action-policy";
import type {
  ManagementEnvironment,
  ManagementSession,
} from "@/lib/server/management-auth";

export type ManagementActionAuditRecord = {
  event: "apicenter.management.action.authorized";
  actionId: string;
  operatorId: string;
  operatorEmail: string;
  operatorRole: string;
  environment: ManagementEnvironment;
  actionRisk: ActionRisk;
  reason?: string;
  authorizedAt: string;
};

export function createManagementActionAuditRecord(input: {
  actionId: string;
  session: ManagementSession;
  environment: ManagementEnvironment;
  actionRisk: ActionRisk;
  reason?: string;
}): ManagementActionAuditRecord {
  return {
    event: "apicenter.management.action.authorized",
    actionId: input.actionId,
    operatorId: input.session.userId,
    operatorEmail: input.session.email,
    operatorRole: input.session.role,
    environment: input.environment,
    actionRisk: input.actionRisk,
    reason: input.reason?.trim() || undefined,
    authorizedAt: new Date().toISOString(),
  };
}

export function emitManagementActionAudit(record: ManagementActionAuditRecord) {
  console.info(JSON.stringify(record));
}

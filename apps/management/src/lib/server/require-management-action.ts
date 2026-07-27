import { validateActionConfirmation } from "../action-confirmation";
import { authorizeManagementAction, type ActionRisk } from "../action-policy";
import { getManagementAuthConfig } from "./management-auth";
import type {
  ManagementEnvironment,
  ManagementSession,
} from "./management-auth";
import {
  createManagementActionAuditRecord,
  emitManagementActionAudit,
  type ManagementActionAuditRecord,
} from "./management-action-audit";
import { requireManagementSession } from "./require-management-session";

type RequireManagementActionInput = {
  session: ManagementSession;
  environment: ManagementEnvironment;
  actionRisk: ActionRisk;
  actionId: string;
  typedPhrase?: string;
  reason?: string;
};

export type ManagementActionContext = {
  audit: ManagementActionAuditRecord;
  session: ManagementSession;
};

type RequireManagementRouteActionInput = {
  request: Request;
  actionRisk: ActionRisk;
  actionId: string;
  environment?: ManagementEnvironment;
};

type ActionConfirmationInput = {
  typedPhrase?: string;
  reason?: string;
  environment?: ManagementEnvironment;
};

export async function requireManagementAction(
  input: RequireManagementActionInput,
): Promise<ManagementActionContext> {
  const decision = authorizeManagementAction({
    role: input.session.role,
    environment: input.environment,
    actionRisk: input.actionRisk,
  });

  if (!decision.allowed) {
    throw new Error(decision.reason);
  }

  const confirmation = validateActionConfirmation({
    confirmationRequired: decision.confirmationRequired,
    reasonRequired: decision.reasonRequired,
    expectedPhrase: "APPLY LIVE CHANGE",
    typedPhrase: input.typedPhrase,
    reason: input.reason,
  });

  if (!confirmation.valid) {
    throw new Error(confirmation.error);
  }

  const audit = createManagementActionAuditRecord({
    actionId: input.actionId,
    session: input.session,
    environment: input.environment,
    actionRisk: input.actionRisk,
    reason: input.reason,
  });
  emitManagementActionAudit(audit);

  return { audit, session: input.session };
}

export async function requireManagementRouteAction({
  request,
  actionRisk,
  actionId,
  environment,
}: RequireManagementRouteActionInput) {
  const session = await requireManagementSession({
    authorizationHeader: request.headers.get("authorization"),
  });
  const confirmation = await readActionConfirmation(request);

  return requireManagementAction({
    session,
    environment:
      environment ?? confirmation.environment ?? getManagementAuthConfig().environment,
    actionRisk,
    actionId,
    typedPhrase: confirmation.typedPhrase,
    reason: confirmation.reason,
  });
}

async function readActionConfirmation(
  request: Request,
): Promise<ActionConfirmationInput> {
  const fromQuery = readEnvironmentFromUrl(request.url);

  try {
    const body = (await request.clone().json()) as {
      confirmation?: {
        typedPhrase?: string;
        reason?: string;
      };
      typedPhrase?: string;
      reason?: string;
      environment?: unknown;
      targetEnvironment?: unknown;
      target_environment?: unknown;
    };

    return {
      typedPhrase: body.confirmation?.typedPhrase ?? body.typedPhrase,
      reason: body.confirmation?.reason ?? body.reason,
      environment:
        readEnvironment(body.targetEnvironment) ??
        readEnvironment(body.target_environment) ??
        readEnvironment(body.environment) ??
        fromQuery,
    };
  } catch {
    return { environment: fromQuery };
  }
}

function readEnvironmentFromUrl(url: string): ManagementEnvironment | undefined {
  const params = new URL(url).searchParams;
  return (
    readEnvironment(params.get("targetEnvironment")) ??
    readEnvironment(params.get("target_environment")) ??
    readEnvironment(params.get("environment"))
  );
}

function readEnvironment(value: unknown): ManagementEnvironment | undefined {
  return value === "test" || value === "live" ? value : undefined;
}

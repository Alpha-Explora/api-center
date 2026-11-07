import { Inject, Injectable } from "@nestjs/common";
import { getCloudRunAuthorizationHeader } from "@shared/proxy/cloud-run-auth";
import { RegistryService } from "../registry/registry.service";
import { TenancyService } from "../registry/tenancy.service";
import {
  PAYMENT_ACCESS_DIRECTORY,
  type PaymentAccessDirectory,
} from "@payments/shared/payment-access.types";
import type {
  ProjectSetupCheck,
  ProjectSetupStatusResponse,
} from "@alpha-explora/apicenter-contracts";

type Environment = "test" | "live";

@Injectable()
export class ProjectSetupStatusService {
  constructor(
    private readonly registry: RegistryService,
    private readonly tenancy: TenancyService,
    @Inject(PAYMENT_ACCESS_DIRECTORY)
    private readonly paymentAccess: PaymentAccessDirectory,
  ) {}

  async getStatus(input: {
    projectId: string;
    serviceId: string;
    environment: Environment;
    scopes: string[];
  }): Promise<ProjectSetupStatusResponse> {
    const { projectId, serviceId, environment, scopes } = input;
    const service = this.registry.get(serviceId);
    const serviceEnvironment = service?.environments.find(
      (item) => item.environment === environment,
    );
    const placement = this.tenancy.resolveProject(projectId);
    const checks: ProjectSetupCheck[] = [{
      id: "service-registration",
      status: service && placement?.project.status === "active" && placement.tribe.status === "active" && service.projectId === projectId && service.status === "active" && serviceEnvironment?.status === "active"
        ? "ready"
        : "missing",
      detail: service && placement?.project.status === "active" && placement.tribe.status === "active" && service.projectId === projectId && service.status === "active" && serviceEnvironment?.status === "active"
        ? `Service ${serviceId} is active in ${environment}.`
        : `Service ${serviceId}, its project, or its tribe is not registered and active in ${environment}.`,
      fix: "Ask an APICenter operator to register or activate this service in the project and environment.",
    }];

    const effectiveScopes = scopes;
    const configuredPaymentAccess = placement
      ? await this.paymentAccess.hasActiveReadWriteKey(serviceId, projectId, environment)
      : null;
    const hasPaymentRead = canSatisfyPaymentScope(effectiveScopes, "payments:checkout:read");
    const hasPaymentWrite = canSatisfyPaymentScope(effectiveScopes, "payments:checkout:write");
    const payment = this.registry.get("payment");
    const currentPaymentAccess = service?.status === "active" && service.projectId === projectId &&
      placement?.project.status === "active" && placement.tribe.status === "active" &&
      serviceEnvironment?.status === "active" && payment?.serviceType === "shared" &&
      payment.status === "active" && payment.environments.some((item) => item.environment === environment && item.status === "active") &&
      this.registry.canAccess(serviceId, "payment", environment);
    const hasCallerPaymentAccess = currentPaymentAccess && hasPaymentRead && hasPaymentWrite;
    const keyConfigured = configuredPaymentAccess === true;
    checks.push({
      id: "payments-access",
      status: hasCallerPaymentAccess ? "ready" : keyConfigured || configuredPaymentAccess === null ? "unknown" : "missing",
      detail: hasCallerPaymentAccess
        ? "The authenticated service token has checkout read and write access."
        : hasPaymentRead && hasPaymentWrite && !currentPaymentAccess
          ? "This token has checkout scopes, but current registration does not authorize payment access in this environment."
          : keyConfigured
          ? "An active payment API key is configured, but this status call cannot confirm the client has that key."
          : configuredPaymentAccess === null
            ? "Payment key configuration could not be checked, and this token lacks payment read or write access."
            : "This token lacks checkout read or write access, and no active payment API key is configured.",
      fix: "Ask an APICenter operator to grant payments:checkout:read and payments:checkout:write, or securely provide an active payment API key to the client.",
    });

    const google = await this.getGoogleRegistration(projectId, environment);
    checks.push({
      id: "google-sign-in",
      status: google === true ? "ready" : google === false ? "missing" : "unknown",
      detail: google === true
        ? `Google sign-in has an active registration and credential settings configured for ${environment}; complete a sign-in to verify they are accepted.`
        : google === false
          ? `Google sign-in does not have an active registration and credential settings configured for ${environment}.`
          : `Google sign-in registration could not be checked for ${environment}.`,
      fix: "Ask an APICenter operator to configure Google sign-in for this project and environment.",
    });

    checks.push({
      id: "payment-event-delivery",
      status: "unknown",
      detail: "APICenter cannot verify the payment event push subscription from its current source of truth.",
      fix: "Ask an APICenter operator to verify the payment event subscription and push receiver for this environment.",
    });

    for (const dependencyId of service?.consumes ?? []) {
      const dependency = this.registry.get(dependencyId);
      const dependencyEnvironment = dependency?.environments.find((item) => item.environment === environment);
      const dependencyReady = Boolean(dependency && dependency.status === "active" && dependencyEnvironment?.status === "active");
      checks.push({
        id: `dependency:${dependencyId}`,
        status: dependencyReady ? "ready" : "missing",
        detail: dependencyReady
          ? `Dependency ${dependencyId} is registered and active in ${environment}.`
          : `Dependency ${dependencyId} is not registered and active in ${environment}.`,
        fix: `Ask an APICenter operator to register or activate dependency ${dependencyId} in ${environment}.`,
      });
    }

    return { projectId, serviceId, environment, checks };
  }

  private async getGoogleRegistration(projectId: string, environment: Environment): Promise<boolean | null> {
    const token = process.env.GAUTH_ADMIN_TOKEN?.trim();
    const upstream = this.registry.get("gauth")?.environments
      .find((item) => item.environment === environment)?.baseUrl?.replace(/\/+$/, "");
    if (!token || !upstream) return null;
    try {
      const authorization = await getCloudRunAuthorizationHeader(upstream);
      const response = await fetch(`${upstream}/admin/oauth-apps/${encodeURIComponent(projectId)}/${environment}`, {
        headers: {
          "X-APICenter-Gauth-Admin-Token": token,
          ...(authorization ? { Authorization: authorization } : {}),
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      const body = await response.json() as { registered?: unknown; credentialSettingsConfigured?: unknown };
      if (body.registered === true && body.credentialSettingsConfigured === true) return true;
      if (body.registered === false || body.credentialSettingsConfigured === false) return false;
      return null;
    } catch {
      return null;
    }
  }
}

function canSatisfyPaymentScope(scopes: string[], required: string): boolean {
  const direction = required.endsWith(":read") ? "read" : "write";
  return scopes.some((scope) => {
    if (scope === "*" || scope === "payments:*" || scope === required) return true;
    // Match the payment facade's two legacy read/write aliases in this read model.
    if (scope === `payments:${direction}` || scope === `payment:${direction}`) return true;
    if (scope.endsWith(":*")) return required.startsWith(`${scope.slice(0, -2)}:`);
    return false;
  });
}

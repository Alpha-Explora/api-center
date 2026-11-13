// Per-environment capability configuration held by the capability runtimes: the email sender and
// the Google sign-in OAuth app of a control-plane project. Secrets stay in the runtime; responses
// and audit records carry only non-secret fields.

import { HttpException, Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import { AuditEventsService } from "@audit/audit-events.service";
import { BadGatewayError, NotFoundError, ServiceUnavailableError, ValidationError } from "@shared/errors";
import { getCloudRunAuthorizationHeader } from "@shared/proxy/cloud-run-auth";
import { resolveSharedServiceRoute } from "@shared/proxy/shared-service-route";
import { withTenant } from "./tenant-transaction";
import type { EnvironmentScope } from "./control-plane-admin.service";

type Method = "GET" | "PUT" | "DELETE";

interface ConfigurableCapability {
  tokenEnv: string;
  tokenHeader: string;
  path: (projectId: string, environment: string) => string;
  methods: Method[];
  /** Fields safe to echo into audit records. */
  auditFields: string[];
}

const CONFIGURABLE: Record<string, ConfigurableCapability> = {
  email: {
    tokenEnv: "EMAIL_ADMIN_TOKEN",
    tokenHeader: "X-APICenter-Email-Admin-Token",
    path: (projectId, environment) => `/admin/projects/${encodeURIComponent(projectId)}/email-sender/${environment}`,
    methods: ["PUT"],
    auditFields: ["fromAddress", "dailyLimit"],
  },
  gauth: {
    tokenEnv: "GAUTH_ADMIN_TOKEN",
    tokenHeader: "X-APICenter-Gauth-Admin-Token",
    path: (projectId, environment) => `/admin/oauth-apps/${encodeURIComponent(projectId)}/${environment}`,
    methods: ["GET", "PUT", "DELETE"],
    auditFields: ["clientId", "redirectUris", "allowedOrigins"],
  },
};

export type FetchLike = (url: string, init: RequestInit) => Promise<globalThis.Response>;

@Injectable()
export class CapabilityConfigurationService {
  private fetchImpl: FetchLike = (url, init) => fetch(url, init);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditEventsService,
  ) {}

  /** Test seam for the HTTP call. */
  useFetch(fetchImpl: FetchLike) {
    this.fetchImpl = fetchImpl;
  }

  async configure(scope: EnvironmentScope, capability: string, method: Method, body: unknown, actor: string) {
    const definition = CONFIGURABLE[capability];
    if (!definition || !definition.methods.includes(method)) {
      throw new NotFoundError(`Capability '${capability}' has no ${method} configuration`);
    }
    await withTenant(this.prisma, { organizationId: scope.organizationId }, async (db) => {
      const environment = await db.cpEnvironment.findFirst({
        where: { organizationId: scope.organizationId, projectId: scope.projectId, kind: scope.environmentKind },
      });
      if (!environment) throw new NotFoundError(`Project '${scope.projectId}' has no ${scope.environmentKind} environment`);
    });
    if (method === "PUT" && (!body || typeof body !== "object" || Array.isArray(body))) {
      throw new ValidationError("Configuration must be a JSON object");
    }

    const token = process.env[definition.tokenEnv]?.trim();
    if (!token) throw new ServiceUnavailableError(`${definition.tokenEnv} is not configured`);
    const upstream = resolveSharedServiceRoute(capability, scope.environmentKind);
    const headers: Record<string, string> = { [definition.tokenHeader]: token };
    const authorization = await getCloudRunAuthorizationHeader(upstream);
    if (authorization) headers.Authorization = authorization;
    if (method === "PUT") headers["Content-Type"] = "application/json";

    let response: globalThis.Response;
    try {
      response = await this.fetchImpl(`${upstream}${definition.path(scope.projectId, scope.environmentKind)}`, {
        method,
        headers,
        ...(method === "PUT" ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new BadGatewayError(`The ${capability} runtime is unavailable`);
    }
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }

    if (method !== "GET") {
      await this.audit.record({
        type: `control_plane.capability_config.${method.toLowerCase()}`,
        actionFamily: "registration",
        actor,
        resourceType: `cp_${capability}_config`,
        resourceId: `${scope.projectId}:${scope.environmentKind}`,
        environment: scope.environmentKind,
        severity: response.ok ? "info" : "error",
        message: `${capability} configuration ${method.toLowerCase()} ${response.ok ? "completed" : "failed"}`,
        payload: pickFields(body, definition.auditFields),
      });
    }
    if (!response.ok) {
      if (response.status >= 500) throw new BadGatewayError(`The ${capability} runtime returned ${response.status}`);
      throw new HttpException(parsed ?? { message: "Configuration was rejected" }, response.status);
    }
    return parsed ?? { success: true };
  }
}

function pickFields(body: unknown, fields: string[]): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const record = body as Record<string, unknown>;
  return Object.fromEntries(fields.filter((field) => field in record).map((field) => [field, record[field]]));
}

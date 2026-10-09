import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Param,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import { AuditEventsService } from "@audit/audit-events.service";
import { RegistryService } from "@registry/registry.service";
import {
  TENANCY_DIRECTORY,
  type TenancyDirectory,
} from "@registry/tenancy.types";
import {
  BadGatewayError,
  NotFoundError,
  ServiceUnavailableError,
} from "@shared/errors";
import { getCloudRunAuthorizationHeader } from "@shared/proxy/cloud-run-auth";
import type { AuthenticatedRequest } from "../../../types";

type Environment = "test" | "live";
const isEnvironment = (value: string): value is Environment =>
  value === "test" || value === "live";

@Controller("admin/projects/:projectId/google-sign-in")
@UseGuards(ScopedAdminGuard)
export class GoogleSignInAdminController {
  constructor(
    @Inject(TENANCY_DIRECTORY) private readonly tenancy: TenancyDirectory,
    private readonly registry: RegistryService,
    private readonly audit: AuditEventsService,
  ) {}

  @Get(":environment")
  get(
    @Param("projectId") projectId: string,
    @Param("environment") environment: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.forward("GET", projectId, environment, undefined, req);
  }

  @Put(":environment")
  put(
    @Param("projectId") projectId: string,
    @Param("environment") environment: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.forward("PUT", projectId, environment, body, req);
  }

  @Delete(":environment")
  delete(
    @Param("projectId") projectId: string,
    @Param("environment") environment: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.forward("DELETE", projectId, environment, undefined, req);
  }

  private async forward(
    method: "GET" | "PUT" | "DELETE",
    projectId: string,
    rawEnvironment: string,
    body: unknown,
    req: AuthenticatedRequest,
  ) {
    if (!this.tenancy.resolveProject(projectId))
      throw new NotFoundError(`Project '${projectId}' is not registered`);
    if (!isEnvironment(rawEnvironment))
      throw new NotFoundError("Environment must be test or live");
    const token = process.env.GAUTH_ADMIN_TOKEN?.trim();
    if (!token)
      throw new ServiceUnavailableError("GAUTH_ADMIN_TOKEN is not configured");

    const gauth = this.registry.get("gauth");
    const upstream = gauth?.environments
      .find((item) => item.environment === rawEnvironment)
      ?.baseUrl?.replace(/\/+$/, "");
    if (!upstream)
      throw new ServiceUnavailableError(
        `GAuth has no ${rawEnvironment} runtime URL`,
      );
    const url = `${upstream}/admin/oauth-apps/${encodeURIComponent(projectId)}/${rawEnvironment}`;
    const authorization = await getCloudRunAuthorizationHeader(upstream);
    const headers: Record<string, string> = {
      "X-APICenter-Gauth-Admin-Token": token,
    };
    if (authorization) headers.Authorization = authorization;
    if (method === "PUT") headers["Content-Type"] = "application/json";

    let response: globalThis.Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        ...(method === "PUT" ? { body: JSON.stringify(body ?? {}) } : {}),
      });
    } catch {
      throw new BadGatewayError("Google sign-in service is unavailable");
    }
    const responseText = await response.text();
    let responseBody: unknown;
    try {
      responseBody = responseText ? JSON.parse(responseText) : undefined;
    } catch {
      responseBody = undefined;
    }

    const safePayload = method === "PUT" ? safeAuditPayload(body) : {};
    await this.audit.recordRequired({
      type: `project.google_sign_in.${method.toLowerCase()}`,
      actionFamily: "registration",
      actor: req.user?.sub ?? req.tribeId ?? "platform-admin",
      resourceType: "project_google_sign_in",
      resourceId: `${projectId}:${rawEnvironment}`,
      environment: rawEnvironment,
      correlationId: req.correlationId ?? `${projectId}:${rawEnvironment}`,
      severity: response.ok ? "info" : "error",
      message: `Google sign-in ${method.toLowerCase()} ${response.ok ? "completed" : "failed"}`,
      payload: safePayload,
    });

    if (!response.ok) {
      if (response.status >= 500) {
        throw new BadGatewayError(`Google sign-in service returned ${response.status}`);
      }
      throw new HttpException(
        responseBody ?? { message: "Google sign-in request was rejected" },
        response.status,
      );
    }
    return responseBody ?? { success: true };
  }
}

function safeAuditPayload(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const value = body as Record<string, unknown>;
  return {
    ...(Array.isArray(value.redirectUris)
      ? {
          redirectUris: value.redirectUris
            .filter((uri) => typeof uri === "string")
            .slice(0, 10),
        }
      : {}),
    ...(typeof value.clientId === "string" || value.clientId === null
      ? { clientId: value.clientId }
      : {}),
    ...(typeof value.displayName === "string"
      ? { displayName: value.displayName.slice(0, 120) }
      : {}),
  };
}

import { Body, Controller, HttpException, Inject, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ScopedAdminGuard } from '@auth/guards/scoped-admin.guard';
import { AuditEventsService } from '@audit/audit-events.service';
import { RegistryService } from '@registry/registry.service';
import { TENANCY_DIRECTORY, type TenancyDirectory } from '@registry/tenancy.types';
import { BadGatewayError, NotFoundError, ServiceUnavailableError } from '@shared/errors';
import { getCloudRunAuthorizationHeader } from '@shared/proxy/cloud-run-auth';
import type { AuthenticatedRequest } from '../../../types';

type Environment = 'test' | 'live';
const isEnvironment = (value: string): value is Environment => value === 'test' || value === 'live';

@Controller('admin/projects/:projectId/email-sender')
@UseGuards(ScopedAdminGuard)
export class EmailSenderAdminController {
  constructor(
    @Inject(TENANCY_DIRECTORY) private readonly tenancy: TenancyDirectory,
    private readonly registry: RegistryService,
    private readonly audit: AuditEventsService,
  ) {}

  @Put(':environment')
  put(@Param('projectId') projectId: string, @Param('environment') environment: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return this.forward(projectId, environment, body, req);
  }

  private async forward(projectId: string, rawEnvironment: string, body: unknown, req: AuthenticatedRequest) {
    if (!this.tenancy.resolveProject(projectId)) throw new NotFoundError(`Project '${projectId}' is not registered`);
    if (!isEnvironment(rawEnvironment)) throw new NotFoundError('Environment must be test or live');
    const token = process.env.EMAIL_ADMIN_TOKEN?.trim();
    if (!token) throw new ServiceUnavailableError('EMAIL_ADMIN_TOKEN is not configured');
    const email = this.registry.get('email');
    const upstream = email?.environments.find((item) => item.environment === rawEnvironment)?.baseUrl?.replace(/\/+$/, '');
    if (!upstream) throw new ServiceUnavailableError(`Email has no ${rawEnvironment} runtime URL`);
    const url = `${upstream}/admin/projects/${encodeURIComponent(projectId)}/email-sender/${rawEnvironment}`;
    const authorization = await getCloudRunAuthorizationHeader(upstream);
    const headers: Record<string, string> = { 'X-APICenter-Email-Admin-Token': token, 'Content-Type': 'application/json' };
    if (authorization) headers.Authorization = authorization;
    let response: globalThis.Response;
    try {
      response = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body ?? {}) });
    } catch {
      throw new BadGatewayError('Email service is unavailable');
    }
    const responseText = await response.text();
    let responseBody: unknown;
    try { responseBody = responseText ? JSON.parse(responseText) : undefined; } catch { responseBody = undefined; }
    await this.audit.recordRequired({
      type: 'project.email_sender.put', actionFamily: 'registration',
      actor: req.user?.sub ?? req.tribeId ?? 'platform-admin',
      resourceType: 'project_email_sender', resourceId: `${projectId}:${rawEnvironment}`,
      environment: rawEnvironment, correlationId: req.correlationId ?? `${projectId}:${rawEnvironment}`,
      severity: response.ok ? 'info' : 'error',
      message: `Project email sender update ${response.ok ? 'completed' : 'failed'}`,
      payload: safeAuditPayload(body),
    });
    if (!response.ok) {
      if (response.status >= 500) throw new BadGatewayError(`Email service returned ${response.status}`);
      throw new HttpException(responseBody ?? { message: 'Email sender update was rejected' }, response.status);
    }
    return responseBody ?? { success: true };
  }
}

function safeAuditPayload(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const value = body as Record<string, unknown>;
  return {
    ...(typeof value.fromAddress === 'string' ? { fromAddress: value.fromAddress.slice(0, 320) } : {}),
    ...(typeof value.dailyLimit === 'number' || value.dailyLimit === null ? { dailyLimit: value.dailyLimit } : {}),
  };
}

import {
  All,
  Controller,
  ForbiddenException,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import axios, { AxiosRequestConfig } from 'axios';
import { Request, Response } from 'express';
import { PaymentAuthGuard } from '../../shared/payment-auth.guard';
import { PaymentIdempotencyService } from '../../shared/payment-idempotency.service';
import { AuthenticatedRequest } from '../../../../types';
import { paymentRequestBody, paymentResponseBody, resolvePaymentOperation } from './payment-public-operation';

const internalBaseUrl = (environment: 'test' | 'live') => {
  const configured = process.env.APICENTER_PAYMENTS_URL
    || (environment === 'live' ? process.env.SHARED_SERVICE_ROUTE_PAYMENT_LIVE : process.env.SHARED_SERVICE_ROUTE_PAYMENT_TEST)
    || 'http://localhost:4010';
  return configured.replace(/\/$/, '');
};

const internalToken = (environment: 'test' | 'live') =>
  (environment === 'live' ? process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_LIVE : process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST)
  || process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN;
@Controller('payments')
@UseGuards(PaymentAuthGuard)
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private readonly idempotency: PaymentIdempotencyService) {}

  @All('*')
  async proxy(@Req() req: Request, @Res() res: Response): Promise<void> {
    const authReq = req as AuthenticatedRequest;
    const principal = authReq.paymentPrincipal;
    if (!principal) {
      res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Valid payment API key or Bearer token is required',
        },
      });
      return;
    }

    const fullPath = new URL(req.originalUrl || req.path, 'http://localhost').pathname;
    const path = fullPath.replace(/^\/api\/v1\/payments/, '').replace(/^\/payments/, '') || '/';
    const operation = resolvePaymentOperation(req.method, path);
    const env = principal.environment;
    const token = internalToken(env);

    this.enforceScope(principal.scopes, operation.scope);
    if (operation.resource === 'capabilities') {
      res.status(200).json({ success: true, data: { currency: 'PHP',
        paymentMethods: ['card', 'gcash', 'paymaya'],
        resources: ['checkouts', 'intents', 'customers', 'refunds', 'subscriptions', 'invoices'] } });
      return;
    }
    if (!token) throw new ServiceUnavailableException('Payment runtime token is not configured');
    const runtimeBody = paymentRequestBody(operation.shape, req.body, principal.consumerServiceId);
    const runtimePath = req.method.toUpperCase() === 'POST' && path === '/refunds'
      ? `/payments/${encodeURIComponent((runtimeBody as { paymentId: string }).paymentId)}/refunds`
      : operation.runtimePath;
    const upstreamUrl = `${internalBaseUrl(env)}${runtimePath}`;

    const idempotencyKey = req.get('Idempotency-Key')?.trim() || undefined;
    const lookup = await this.idempotency.lookupOrValidate({
      principal,
      method: req.method,
      path,
      key: idempotencyKey,
      body: req.body,
    });

    if ('replay' in lookup) {
      if (lookup.replay.contentType) {
        res.setHeader('content-type', lookup.replay.contentType);
      }
      res.setHeader('x-idempotency-replayed', 'true');
      res.status(lookup.replay.status).send(lookup.replay.body);
      return;
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-apicenter-environment': env,
      'x-apicenter-consumer-service-id': principal.consumerServiceId,
      'x-apicenter-owner-tribe-id': principal.ownerTribeId,
      'x-tribe-id': principal.ownerTribeId,
    };
    headers.authorization = `Bearer ${token}`;
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

    const config: AxiosRequestConfig = {
      method: req.method,
      url: upstreamUrl,
      headers,
      params: req.query,
      data: runtimeBody,
      timeout: Number(process.env.APICENTER_PAYMENTS_TIMEOUT_MS || 15000),
      validateStatus: () => true,
      transformResponse: [(data) => data],
    };

    try {
      const response = await axios.request(config);
      const parsed = typeof response.data === 'string' || Buffer.isBuffer(response.data)
        ? JSON.parse(Buffer.isBuffer(response.data) ? response.data.toString('utf8') : response.data)
        : response.data;
      const mapped = paymentResponseBody(operation.resource, parsed);
      const body = JSON.stringify(mapped);
      const contentType = 'application/json';

      if (idempotencyKey && req.method.toUpperCase() !== 'GET' && response.status < 500) {
        await this.idempotency.store({
          principal,
          method: req.method,
          path,
          key: idempotencyKey,
          body: req.body,
          response: {
            status: response.status,
            contentType,
            body,
          },
        });
      } else if (response.status >= 500) {
        await this.preserveUnknownOutcome({ principal, method: req.method, path, key: idempotencyKey });
      }

      res.setHeader('content-type', contentType);
      res.status(response.status).send(body);
    } catch (error: unknown) {
      await this.preserveUnknownOutcome({ principal, method: req.method, path, key: idempotencyKey });
      const message = error instanceof Error ? error.message : 'Payment upstream unreachable';
      res.status(HttpStatus.BAD_GATEWAY).json({
        success: false,
        error: {
          code: 'PAYMENT_UPSTREAM_UNREACHABLE',
          message,
        },
      });
    }
  }

  private async preserveUnknownOutcome(input: {
    principal: NonNullable<AuthenticatedRequest['paymentPrincipal']>;
    method: string;
    path: string;
    key?: string;
  }): Promise<void> {
    try {
      await this.idempotency.markUnknown(input);
    } catch {
      // The durable reservation created before the upstream request remains in
      // place, so stale provider keys still fail closed if Redis is unavailable.
      this.logger.error('Unable to update the payment idempotency outcome marker');
    }
  }

  private enforceScope(scopes: string[], required: string): void {
    if (scopes.includes('*') || scopes.includes('payments:*')) return;
    const direction = required.endsWith(':read') ? 'read' : 'write';

    const hasScope = scopes.some((scope) => {
      if (scope === required) return true;
      if (scope === `payments:${direction}`) return true;
      if (scope.endsWith(':*')) {
        const prefix = scope.slice(0, -2);
        return required.startsWith(`${prefix}:`);
      }
      return false;
    });

    if (!hasScope) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_SCOPE',
        message: `Scope '${required}' is required`,
      });
    }
  }

}

import {
  All,
  BadRequestException,
  Controller,
  ForbiddenException,
  HttpStatus,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import axios, { AxiosRequestConfig } from 'axios';
import { z } from 'zod';
import { Request, Response } from 'express';
import { PaymentAuthGuard } from '../../shared/payment-auth.guard';
import { PaymentIdempotencyService } from '../../shared/payment-idempotency.service';
import { AuthenticatedRequest } from '../../../../types';

const internalBaseUrl = (environment: 'test' | 'live') => {
  const configured = process.env.APICENTER_PAYMENTS_URL
    || (environment === 'live' ? process.env.SHARED_SERVICE_ROUTE_PAYMENT_LIVE : process.env.SHARED_SERVICE_ROUTE_PAYMENT_TEST)
    || 'http://localhost:4010';
  return configured.replace(/\/$/, '');
};

const internalToken = (environment: 'test' | 'live') =>
  (environment === 'live' ? process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_LIVE : process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST)
  || process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN;
const MoneySchema = z.object({
  amountMinor: z.number().int().positive(),
  currency: z.literal('PHP'),
});

const LineItemSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  amount: MoneySchema,
});

const CheckoutPayloadSchema = z.object({
  lineItems: z.array(LineItemSchema).min(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  billing: z.record(z.string(), z.unknown()).optional(),
});

const IntentPayloadSchema = z.object({
  amount: MoneySchema,
  paymentMethodTypes: z.array(z.string()).min(1),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const RefundPayloadSchema = z.object({
  paymentIntentId: z.string().min(1),
  amount: MoneySchema,
  reason: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const SubscriptionPayloadSchema = z.object({
  customerId: z.string().min(1),
  priceId: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

@Controller('payments')
@UseGuards(PaymentAuthGuard)
export class PaymentsController {
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

    const path = req.path.replace(/^\/api\/v1\/payments/, '').replace(/^\/payments/, '') || '/';
    const subpath = path === '/' ? '' : path;
    const env = principal.environment;
    const upstreamUrl = `${internalBaseUrl(env)}${subpath}`;
    const token = internalToken(env);

    this.enforceScope(principal.scopes, req.method, path);
    this.validatePayloadShape(req.method, path, req.body);

    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
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
    };
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    const config: AxiosRequestConfig = {
      method: req.method,
      url: upstreamUrl,
      headers,
      params: req.query,
      data: ['POST', 'PUT', 'PATCH'].includes(req.method.toUpperCase()) ? req.body : undefined,
      validateStatus: () => true,
      transformResponse: [(data) => data],
    };

    try {
      const response = await axios(config);
      const contentType = (response.headers['content-type'] as string | undefined) || 'application/json';

      if (idempotencyKey && response.status < 500) {
        await this.idempotency.store({
          principal,
          method: req.method,
          path,
          key: idempotencyKey,
          body: req.body,
          response: {
            status: response.status,
            contentType,
            body: typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
          },
        });
      }

      res.setHeader('content-type', contentType);
      res.status(response.status).send(response.data);
    } catch (error: unknown) {
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

  private enforceScope(scopes: string[], method: string, path: string): void {
    if (scopes.includes('*') || scopes.includes('payments:*')) return;

    const reqMethod = method.toUpperCase();
    const required = this.requiredScope(reqMethod, path);
    if (!required) return;

    const hasScope = scopes.some((scope) => {
      if (scope === required) return true;
      if (scope.endsWith(':*')) {
        const prefix = scope.slice(0, -2);
        return required.startsWith(`${prefix}:`);
      }
      return false;
    });

    if (!hasScope) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_SCOPE',
        message: `Scope '${required}' is required for ${reqMethod} ${path}`,
      });
    }
  }

  private requiredScope(method: string, path: string): string | null {
    if (path.startsWith('/v1/checkout/sessions')) {
      return method === 'GET' ? 'payments:checkout:read' : 'payments:checkout:write';
    }
    if (path.startsWith('/v1/payment_intents')) {
      return method === 'GET' ? 'payments:intents:read' : 'payments:intents:write';
    }
    if (path.startsWith('/v1/refunds')) {
      return method === 'GET' ? 'payments:refunds:read' : 'payments:refunds:write';
    }
    if (path.startsWith('/v1/subscriptions')) {
      return method === 'GET' ? 'payments:subscriptions:read' : 'payments:subscriptions:write';
    }
    if (path.startsWith('/v1/customers')) {
      return method === 'GET' ? 'payments:customers:read' : 'payments:customers:write';
    }
    if (path.startsWith('/v1/products') || path.startsWith('/v1/prices')) {
      return method === 'GET' ? 'payments:catalog:read' : 'payments:catalog:write';
    }
    return null;
  }

  private validatePayloadShape(method: string, path: string, body: unknown): void {
    if (!['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) return;

    const schemaMap: Record<string, z.ZodSchema> = {
      '/v1/checkout/sessions': CheckoutPayloadSchema,
      '/v1/payment_intents': IntentPayloadSchema,
      '/v1/refunds': RefundPayloadSchema,
      '/v1/subscriptions': SubscriptionPayloadSchema,
    };

    const schema = schemaMap[path];
    if (!schema) return;

    const result = schema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        code: 'INVALID_PAYLOAD_SHAPE',
        message: 'Request payload does not match expected payment schema',
        details: result.error.issues.map((issue) => `${String(issue.path.join('.'))}: ${issue.message}`),
      });
    }
  }
}

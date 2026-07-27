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
import { PaymentAuthGuard } from './payment-auth.guard';
import { PaymentIdempotencyService } from './payment-idempotency.service';
import { AuthenticatedRequest } from '../types';

const INTERNAL_BASE_URL = () =>
  (process.env.APICENTER_PAYMENTS_URL || 'http://localhost:4010').replace(/\/$/, '');

const MoneySchema = z.object({
  amountMinor: z.number().int().positive(),
  currency: z.literal('PHP'),
});
const MetadataSchema = z.record(z.string(), z.string()).optional();
const bodySchemas: Array<{ method: string; path: RegExp; schema: z.ZodTypeAny }> = [
  {
    method: 'POST',
    path: /^\/checkouts$/,
    schema: z.object({
      referenceId: z.string().trim().min(1).max(255),
      amount: MoneySchema,
      successUrl: z.string().url(),
      cancelUrl: z.string().url(),
      customerId: z.string().trim().min(1).optional(),
      metadata: MetadataSchema,
    }),
  },
  {
    method: 'POST',
    path: /^\/intents$/,
    schema: z.object({
      referenceId: z.string().trim().min(1).max(255),
      amount: MoneySchema,
      customerId: z.string().trim().min(1).optional(),
    }),
  },
  {
    method: 'POST',
    path: /^\/customers$/,
    schema: z.object({
      customerReference: z.string().trim().min(1).max(255),
      email: z.string().email().optional(),
      name: z.string().trim().max(255).optional(),
    }),
  },
  {
    method: 'POST',
    path: /^\/payment-method-setups$/,
    schema: z.object({
      customerId: z.string().trim().min(1),
      referenceId: z.string().trim().min(1).max(255),
      returnUrl: z.string().url().optional(),
    }),
  },
  {
    method: 'POST',
    path: /^\/refunds$/,
    schema: z.object({
      paymentId: z.string().trim().min(1),
      amount: MoneySchema,
      reason: z.string().trim().max(255).optional(),
    }),
  },
  {
    method: 'POST',
    path: /^\/subscriptions$/,
    schema: z.object({
      customerId: z.string().trim().min(1),
      referenceId: z.string().trim().min(1).max(255),
      priceId: z.string().trim().min(1),
      cancelAtPeriodEnd: z.boolean().optional(),
    }),
  },
  {
    method: 'POST',
    path: /^\/subscriptions\/[^/]+\/cancel$/,
    schema: z.object({
      cancelAtPeriodEnd: z.boolean().optional(),
      reason: z.string().trim().max(255).optional(),
    }),
  },
  {
    method: 'POST',
    path: /^\/checkouts\/[^/]+\/cancel$/,
    schema: z.object({ reason: z.string().trim().max(255).optional() }),
  },
];

@Controller('payments')
@UseGuards(PaymentAuthGuard)
export class PaymentsController {
  constructor(private readonly idempotency: PaymentIdempotencyService) {}

  @All('*path')
  async proxy(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const publicPath = this.publicPath(req);
    const principal = req.paymentPrincipal || {
      ownerTribeId: req.tribeId || 'unknown',
      consumerServiceId: req.sourceServiceId || req.tribeId || 'unknown',
      environment: req.user?.environment === 'live' ? 'live' : 'test',
      scopes: req.user?.scopes || [],
    };
    const requiredScope = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
      ? 'payments:write'
      : 'payments:read';
    if (!principal.scopes.includes(requiredScope)) {
      throw new ForbiddenException({
        code: 'PAYMENT_SCOPE_REQUIRED',
        message: `The credential requires ${requiredScope} for this operation`,
      });
    }

    const validatedBody = this.validateBody(req.method, publicPath, req.body);
    const internalPath = this.mapPath(req.method, publicPath, validatedBody);
    if (!internalPath && publicPath !== '/capabilities') {
      res.status(HttpStatus.NOT_IMPLEMENTED).json({
        success: false,
        error: {
          code: 'PAYMENT_OPERATION_NOT_IMPLEMENTED',
          message: `The payments runtime does not yet implement ${req.method} ${publicPath}.`,
        },
      });
      return;
    }

    const idempotencyKey = this.header(req, 'idempotency-key');
    const idempotency = await this.idempotency.lookupOrValidate({
      principal,
      method: req.method,
      path: publicPath,
      key: idempotencyKey,
      body: validatedBody,
    });
    if ('replay' in idempotency) {
      if (idempotency.replay.contentType) res.setHeader('content-type', idempotency.replay.contentType);
      res.status(idempotency.replay.status).send(Buffer.from(idempotency.replay.body, 'base64'));
      return;
    }

    if (publicPath === '/capabilities' && req.method === 'GET') {
      const data = {
        currency: 'PHP',
        paymentMethods: (process.env.PAYMONGO_ALLOWED_PAYMENT_METHODS || 'card,gcash,qrph')
          .split(',')
          .map((method) => method.trim())
          .filter(Boolean),
        resources: ['checkouts', 'customers', 'refunds', 'subscriptions', 'invoices'],
      };
      res.status(HttpStatus.OK).json({ success: true, data });
      return;
    }

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === 'string' && name !== 'host' && name !== 'content-length') {
        headers[name] = value;
      }
    }
    headers['x-tribe-id'] = principal.ownerTribeId;
    headers['x-apicenter-environment'] = principal.environment;
    if (process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN) {
      headers['x-apicenter-internal-token'] = process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN;
    }

    const config: AxiosRequestConfig = {
      method: req.method as AxiosRequestConfig['method'],
      url: `${INTERNAL_BASE_URL()}${internalPath}`,
      headers,
      data: this.internalBody(publicPath, validatedBody, principal.consumerServiceId),
      validateStatus: () => true,
      responseType: 'arraybuffer',
    };

    try {
      const upstream = await axios.request(config);
      const contentType = upstream.headers['content-type'];
      const responseBody = this.normalizeResponse(publicPath, upstream.data, contentType);
      if (typeof contentType === 'string') res.setHeader('content-type', contentType);
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        await this.idempotency.store({
          principal,
          method: req.method,
          path: publicPath,
          key: idempotencyKey!,
          body: validatedBody,
          response: {
            status: upstream.status,
            contentType: typeof contentType === 'string' ? contentType : undefined,
            body: responseBody.toString('base64'),
          },
        });
      }
      res.status(upstream.status).send(responseBody);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Payments runtime unavailable';
      res.status(HttpStatus.BAD_GATEWAY).json({
        success: false,
        error: { code: 'PAYMENTS_UPSTREAM_UNAVAILABLE', message },
      });
    }
  }

  private validateBody(method: string, path: string, body: unknown): Record<string, unknown> | undefined {
    const definition = bodySchemas.find((candidate) => candidate.method === method && candidate.path.test(path));
    if (!definition) return body as Record<string, unknown> | undefined;
    const result = definition.schema.safeParse(body ?? {});
    if (!result.success) {
      throw new BadRequestException({
        code: 'INVALID_PAYMENT_REQUEST',
        message: 'The payment request does not match the public contract',
        details: result.error.issues,
      });
    }
    return result.data as Record<string, unknown>;
  }

  private header(req: Request, name: string): string | undefined {
    const value = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  private publicPath(req: Request): string {
    const prefix = '/api/v1/payments';
    const path = req.originalUrl.split('?')[0];
    return path.startsWith(prefix) ? path.slice(prefix.length) || '/' : path;
  }

  private internalBody(path: string, body: Record<string, unknown> | undefined, consumerServiceId?: string): Record<string, unknown> | undefined {
    if (!body || typeof body !== 'object') return body;
    const money = (value: unknown): unknown => {
      if (!value || typeof value !== 'object') return value;
      const candidate = value as { amountMinor?: unknown; value?: unknown; currency?: unknown };
      if (typeof candidate.amountMinor === 'number') return { value: candidate.amountMinor, currency: candidate.currency ?? 'PHP' };
      return value;
    };

    const next = { ...body };
    delete next.tribeId;
    delete next.environment;
    delete next.provider;
    delete next.providerMode;
    if (path === '/customers' && typeof next.customerReference === 'string') {
      next.customerId = next.customerReference;
      next.metadata = { customerReference: next.customerReference };
      delete next.customerReference;
    }
    if (consumerServiceId) {
      next.metadata = {
        ...(next.metadata && typeof next.metadata === 'object' ? next.metadata : {}),
        __apicenterConsumerServiceId: consumerServiceId,
      };
    }
    if ('amount' in next) next.amount = money(next.amount);
    if (Array.isArray(next.lineItems)) {
      next.lineItems = next.lineItems.map((item) => {
        if (!item || typeof item !== 'object') return item;
        const lineItem = item as Record<string, unknown>;
        return { ...lineItem, amount: money(lineItem.amount) };
      });
    }
    if (path === '/refunds' && 'paymentId' in next && !('payment_id' in next)) next.payment_id = next.paymentId;
    return next;
  }

  private normalizeResponse(path: string, data: unknown, contentType: unknown): Buffer {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array);
    if (typeof contentType !== 'string' || !contentType.includes('json')) return raw;
    try {
      const payload = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
      if (payload.success !== true || !payload.data) return raw;
      const normalizeMoney = (value: unknown): unknown => {
        if (!value || typeof value !== 'object') return value;
        const money = value as Record<string, unknown>;
        if (typeof money.amountMinor === 'number') return money;
        if (typeof money.value === 'number') return { amountMinor: money.value, currency: money.currency || 'PHP' };
        return value;
      };
      const normalizeResource = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(normalizeResource);
        if (!value || typeof value !== 'object') return value;
        const resource = { ...(value as Record<string, unknown>) };
        if ('amount' in resource) resource.amount = normalizeMoney(resource.amount);
        if (resource.redirectUrl && !resource.checkoutUrl) resource.checkoutUrl = resource.redirectUrl;
        if (resource.customerId && !resource.customerReference) resource.customerReference = resource.customerId;
        if (['/checkouts', '/intents'].some((prefix) => path === prefix || path.startsWith(`${prefix}/`)) && resource.aggregateVersion === undefined) resource.aggregateVersion = 1;
        return resource;
      };
      payload.data = normalizeResource(payload.data);
      return Buffer.from(JSON.stringify(payload));
    } catch {
      return raw;
    }
  }

  private mapPath(method: string, publicPath: string, body: Record<string, unknown> | undefined): string | null {
    if (publicPath === '/checkouts' && method === 'POST') return '/checkout/sessions';
    if (publicPath.startsWith('/checkouts/by-reference/') && method === 'GET') return `/checkout/sessions/by-reference/${encodeURIComponent(publicPath.split('/')[3])}/status`;
    const checkout = publicPath.match(/^\/checkouts\/([^/]+)$/);
    if (checkout && method === 'GET') return `/checkout/sessions/${encodeURIComponent(checkout[1])}/status`;
    const cancelCheckout = publicPath.match(/^\/checkouts\/([^/]+)\/cancel$/);
    if (cancelCheckout && method === 'POST') return `/checkout/sessions/${encodeURIComponent(cancelCheckout[1])}/cancelled`;

    if (publicPath === '/intents' && method === 'POST') return '/payment-intents';
    const intent = publicPath.match(/^\/intents\/([^/]+)$/);
    if (intent && method === 'GET') return `/payment-intents/${encodeURIComponent(intent[1])}`;
    const confirmIntent = publicPath.match(/^\/intents\/([^/]+)\/confirm$/);
    if (confirmIntent && method === 'POST') return `/payment-intents/${encodeURIComponent(confirmIntent[1])}/confirm`;
    const cancelIntent = publicPath.match(/^\/intents\/([^/]+)\/cancel$/);
    if (cancelIntent && method === 'POST') return `/payment-intents/${encodeURIComponent(cancelIntent[1])}/cancel`;
    if (publicPath === '/payment-method-setups' && method === 'POST') return '/payment-method-setups';

    if (publicPath === '/customers' || publicPath.startsWith('/customers/')) return publicPath;
    if (publicPath === '/subscriptions' || publicPath.startsWith('/subscriptions/')) return publicPath;
    if (publicPath.startsWith('/refunds/')) return publicPath;
    if (publicPath.startsWith('/invoices/')) return publicPath;
    if (publicPath === '/refunds' && method === 'POST') {
      const paymentId = body?.paymentId || body?.payment_id;
      return typeof paymentId === 'string' ? `/payments/${encodeURIComponent(paymentId)}/refunds` : null;
    }
    return null;
  }
}
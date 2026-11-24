// Who a payment request acts for. The gateway signs that in X-APICenter-Context (audience
// apicenter-runtime:payments), as for every other runtime. The X-APICenter-* identity headers are
// the older, unsigned form: anyone holding the runtime token could name any project with them, so
// they are accepted only while this runtime has no context public keys to verify with.

import { readRuntimeApplicationContext } from '@apicenter/runtime';
import { PayMongoError } from './payment-errors';
import type { PaymentContext } from './payment-owner-store';

export const PAYMENTS_RUNTIME_AUDIENCE = 'apicenter-runtime:payments';

type HeaderSource = { get(name: string): string | undefined };

export interface PaymentContextOptions {
  /** Whether APICENTER_RUNTIME_CONTEXT_PUBLIC_KEYS is set, so signed contexts can be verified. */
  canVerify: boolean;
  production: boolean;
  /** For tests: verification keys and clock. */
  contextKeys?: Map<string, unknown>;
  now?: number;
  requireSigned?: boolean;
}

export function readPaymentContext(req: HeaderSource, options: PaymentContextOptions): PaymentContext {
  if (options.canVerify) {
    let signed;
    try {
      signed = readRuntimeApplicationContext(req, {
        runtimeAudience: PAYMENTS_RUNTIME_AUDIENCE,
        ...(options.contextKeys ? { contextKeys: options.contextKeys } : {}),
        ...(options.now === undefined ? {} : { now: options.now }),
      });
    } catch {
      throw new PayMongoError('The payment request context could not be verified', 401, 'UNAUTHORIZED');
    }
    if (signed) {
      const context: PaymentContext = {
        tribeId: signed.ownerGroupId,
        projectId: signed.ownerProjectId,
        consumerServiceId: signed.applicationId,
        environment: signed.environmentKind,
      };
      assertHeadersAgree(req, context);
      return context;
    }
  }
  if (options.requireSigned || (options.canVerify && options.production)) {
    throw new PayMongoError('A signed payment request context is required', 401, 'UNAUTHORIZED');
  }
  return headerContext(req);
}

function headerContext(req: HeaderSource): PaymentContext {
  const tribeId = req.get('X-APICenter-Owner-Tribe-ID');
  const projectId = req.get('X-APICenter-Project-ID');
  const consumerServiceId = req.get('X-APICenter-Consumer-Service-ID');
  const environment = req.get('X-APICenter-Environment');
  if (!tribeId || !projectId || !consumerServiceId || (environment !== 'test' && environment !== 'live')) {
    throw new PayMongoError('Trusted payment context is required', 401, 'UNAUTHORIZED');
  }
  return { tribeId, projectId, consumerServiceId, environment };
}

/** The gateway still sends the unsigned headers during rollout; when it does, they must match. */
function assertHeadersAgree(req: HeaderSource, context: PaymentContext): void {
  const pairs: [string, string][] = [
    ['X-APICenter-Owner-Tribe-ID', context.tribeId],
    ['X-APICenter-Project-ID', context.projectId],
    ['X-APICenter-Consumer-Service-ID', context.consumerServiceId],
    ['X-APICenter-Environment', context.environment],
  ];
  for (const [name, expected] of pairs) {
    const sent = req.get(name);
    if (sent !== undefined && sent !== expected) {
      throw new PayMongoError('Payment request headers do not match the signed context', 401, 'UNAUTHORIZED');
    }
  }
}

import { randomUUID } from 'node:crypto';
import {
  ApiCenter,
  ApiCenterError,
  parsePaymentEvent,
  type Checkout,
  type EmailSendResponse,
  type PaymentResource,
} from '@alpha-explora/apicenter-sdk';

const api = new ApiCenter({
  baseUrl: process.env.APICENTER_URL ?? 'https://apicenter.example.test',
  auth: {
    serviceId: process.env.APICENTER_SERVICE_ID ?? 'orders-api',
    environment: 'test',
    secret: process.env.APICENTER_SERVICE_SECRET ?? 'server-only-example',
  },
});

const emailResult: Promise<EmailSendResponse> = api.email.send(
  { to: 'person@example.com', subject: 'Welcome', text: 'Hello' },
  { idempotencyKey: randomUUID() },
);
const checkoutResult: Promise<PaymentResource<Checkout>> = api.payments.checkouts.create(
  {
    referenceId: 'order-123',
    amount: { amountMinor: 49900, currency: 'PHP' },
    successUrl: 'https://app.example.test/success',
    cancelUrl: 'https://app.example.test/cancel',
  },
  { idempotencyKey: randomUUID() },
);

void emailResult;
void checkoutResult;
void parsePaymentEvent;
void ApiCenterError;

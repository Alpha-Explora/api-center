// Compiles against the built package as a consumer would, to catch export and typing breaks.
import {
  ApiCenter,
  ApiCenterError,
  PermissionError,
  createWebhookHandler,
  isPending,
  verifyWebhook,
  type Checkout,
  type EmailSendResponse,
  type PaymentEvent,
  type PaymentResource,
  type WhoAmI,
} from '@alpha-explora/apicenter-sdk';

const api = new ApiCenter({ apiKey: process.env.APICENTER_API_KEY ?? `ak_test_abcdefghijklmnop_${'B'.repeat(43)}` });

const emailResult: Promise<EmailSendResponse> = api.email.send({ to: 'person@example.com', subject: 'Welcome', text: 'Hello' });
const checkoutResult: Promise<PaymentResource<Checkout>> = api.payments.checkouts.create(
  {
    referenceId: 'order-123',
    amount: { amountMinor: 49900, currency: 'PHP' },
    successUrl: 'https://app.example.test/success',
    cancelUrl: 'https://app.example.test/cancel',
  },
  { idempotencyKey: 'order-123-checkout-create' },
);
const me: Promise<WhoAmI> = api.whoami();

async function handle(event: PaymentEvent): Promise<void> {
  if (event.eventType === 'payment.checkout.paid') {
    const amount: number = event.data.amount;
    void amount;
  }
}

export const POST = createWebhookHandler({ secret: process.env.APICENTER_WEBHOOK_SECRET ?? 'whsec_x', onEvent: handle });

void emailResult;
void checkoutResult.then((result) => (isPending(result) ? result.resourceId : result.checkoutId));
void me;
void verifyWebhook;
void ApiCenterError;
void PermissionError;

import type {
  Allocation,
  CashOutPayout,
  Checkout,
  CreatePayeeInput,
  ListPayeesOptions,
  ListPayoutsOptions,
  Payee,
  PayeeDetail,
  PayeeOnboarding,
  PayeeOnboardingInput,
  PayeePage,
  RecordPayeeVerificationInput,
  Payout,
  PayoutDestination,
  PayoutPage,
  ConfirmPaymentIntentInput,
  CreateCheckoutInput,
  CreateCustomerInput,
  CreatePaymentIntentInput,
  CreatePaymentLinkInput,
  CreatePlanInput,
  CreateQrPhPaymentIntentInput,
  CreateWalletPaymentIntentInput,
  CreateRefundInput,
  CreateSubscriptionInput,
  Customer,
  Invoice,
  ListPaymentRecordsOptions,
  PaymentCapabilities,
  PaymentIntent,
  PaymentLink,
  PaymentRecord,
  PaymentRecordPage,
  PaymentResource,
  PendingResource,
  Plan,
  QrPhPaymentIntent,
  Refund,
  Subscription,
} from '@alpha-explora/apicenter-contracts';
import type { ApiCenterTransport } from '../internal/transport.js';
import type { RequestOptions, WriteOptions } from '../types.js';

/**
 * True when APICenter accepted a payment write but the provider has not finished it yet. Read the
 * resource again with its `resourceId`, or wait for its webhook event.
 */
export function isPending<T extends object>(result: PaymentResource<T>): result is PendingResource {
  const candidate = result as Partial<PendingResource>;
  return candidate.status === 'pending' && typeof candidate.resourceId === 'string' && Object.keys(result).length === 2;
}

/** Request helpers shared by the payment resource clients. */
abstract class PaymentsResource {
  constructor(protected readonly transport: ApiCenterTransport) {}

  protected read<T>(path: string, options?: RequestOptions, query?: Record<string, string | number | undefined>): Promise<T> {
    return this.transport.request({ path: `/api/v1/payments${path}`, method: 'GET', query, options });
  }

  protected write<T>(path: string, body: unknown, options?: WriteOptions, method: 'POST' | 'PUT' | 'PATCH' = 'POST'): Promise<PaymentResource<T>> {
    return this.transport.request({ path: `/api/v1/payments${path}`, method, body, write: true, idempotencyKey: options?.idempotencyKey, options });
  }
}

const id = encodeURIComponent;

class CheckoutClient extends PaymentsResource {
  /** @sdk-operation createCheckout POST /api/v1/payments/checkouts */
  create(input: CreateCheckoutInput, options?: WriteOptions): Promise<PaymentResource<Checkout>> {
    return this.write('/checkouts', input, options);
  }

  /** @sdk-operation getCheckout GET /api/v1/payments/checkouts/{checkoutId} */
  get(checkoutId: string, options?: RequestOptions): Promise<Checkout> {
    return this.read(`/checkouts/${id(checkoutId)}`, options);
  }

  /** @sdk-operation getCheckoutByReference GET /api/v1/payments/checkouts/by-reference/{referenceId} */
  getByReference(referenceId: string, options?: RequestOptions): Promise<Checkout> {
    return this.read(`/checkouts/by-reference/${id(referenceId)}`, options);
  }

  /** @sdk-operation cancelCheckout POST /api/v1/payments/checkouts/{checkoutId}/cancel */
  cancel(checkoutId: string, input?: { reason?: string }, options?: WriteOptions): Promise<PaymentResource<Checkout>> {
    return this.write(`/checkouts/${id(checkoutId)}/cancel`, input ?? {}, options);
  }
}

class IntentClient extends PaymentsResource {
  /**
   * With `paymentMethod` and `returnUrl`, opens that wallet directly: send the customer to
   * `nextAction.redirectUrl`, then confirm the result with `get` or a `payment.intent.*` event.
   * @sdk-operation createPaymentIntent POST /api/v1/payments/intents
   */
  create(input: CreatePaymentIntentInput | CreateWalletPaymentIntentInput, options?: WriteOptions): Promise<PaymentResource<PaymentIntent>> {
    return this.write('/intents', input, options);
  }

  /** @sdk-operation createQrPhPaymentIntent POST /api/v1/payments/intents/qrph */
  createQrPh(input: CreateQrPhPaymentIntentInput, options?: WriteOptions): Promise<PaymentResource<QrPhPaymentIntent>> {
    return this.write('/intents/qrph', input, options);
  }

  /** @sdk-operation getPaymentIntent GET /api/v1/payments/intents/{paymentIntentId} */
  get(paymentIntentId: string, options?: RequestOptions): Promise<PaymentIntent> {
    return this.read(`/intents/${id(paymentIntentId)}`, options);
  }

  /** @sdk-operation confirmPaymentIntent POST /api/v1/payments/intents/{paymentIntentId}/confirm */
  confirm(paymentIntentId: string, input: ConfirmPaymentIntentInput, options?: WriteOptions): Promise<PaymentResource<PaymentIntent>> {
    return this.write(`/intents/${id(paymentIntentId)}/confirm`, input, options);
  }

  /** @sdk-operation cancelPaymentIntent POST /api/v1/payments/intents/{paymentIntentId}/cancel */
  cancel(paymentIntentId: string, options?: WriteOptions): Promise<PaymentResource<PaymentIntent>> {
    return this.write(`/intents/${id(paymentIntentId)}/cancel`, {}, options);
  }
}

class CustomerClient extends PaymentsResource {
  /** @sdk-operation createCustomer POST /api/v1/payments/customers */
  create(input: CreateCustomerInput, options?: WriteOptions): Promise<PaymentResource<Customer>> {
    return this.write('/customers', input, options);
  }

  /** @sdk-operation getCustomer GET /api/v1/payments/customers/{customerId} */
  get(customerId: string, options?: RequestOptions): Promise<Customer> {
    return this.read(`/customers/${id(customerId)}`, options);
  }
}

class PlanClient extends PaymentsResource {
  /** @sdk-operation createPlan POST /api/v1/payments/plans */
  create(input: CreatePlanInput, options?: WriteOptions): Promise<PaymentResource<Plan>> {
    return this.write('/plans', input, options);
  }

  /** @sdk-operation getPlan GET /api/v1/payments/plans/{planId} */
  get(planId: string, options?: RequestOptions): Promise<Plan> {
    return this.read(`/plans/${id(planId)}`, options);
  }

  /** @sdk-operation listPlans GET /api/v1/payments/plans */
  list(options?: RequestOptions): Promise<Plan[]> {
    return this.read('/plans', options);
  }
}

class PaymentLinkClient extends PaymentsResource {
  /** @sdk-operation createPaymentLink POST /api/v1/payments/payment-links */
  create(input: CreatePaymentLinkInput, options?: WriteOptions): Promise<PaymentResource<PaymentLink>> {
    return this.write('/payment-links', input, options);
  }

  /** @sdk-operation listPaymentLinks GET /api/v1/payments/payment-links */
  list(options?: RequestOptions): Promise<PaymentLink[]> {
    return this.read('/payment-links', options);
  }

  /** @sdk-operation getPaymentLink GET /api/v1/payments/payment-links/{paymentLinkId} */
  get(paymentLinkId: string, options?: RequestOptions): Promise<PaymentLink> {
    return this.read(`/payment-links/${id(paymentLinkId)}`, options);
  }

  /** @sdk-operation setPaymentLinkArchived PATCH /api/v1/payments/payment-links/{paymentLinkId} */
  archive(paymentLinkId: string, options?: WriteOptions): Promise<PaymentResource<PaymentLink>> {
    return this.write(`/payment-links/${id(paymentLinkId)}`, { archive: true }, options, 'PATCH');
  }

  /** Restores an archived link; the same operation as archive, with archive set to false. */
  unarchive(paymentLinkId: string, options?: WriteOptions): Promise<PaymentResource<PaymentLink>> {
    return this.write(`/payment-links/${id(paymentLinkId)}`, { archive: false }, options, 'PATCH');
  }
}

class RefundClient extends PaymentsResource {
  /** @sdk-operation createRefund POST /api/v1/payments/refunds */
  create(input: CreateRefundInput, options?: WriteOptions): Promise<PaymentResource<Refund>> {
    return this.write('/refunds', input, options);
  }

  /** @sdk-operation getRefund GET /api/v1/payments/refunds/{refundId} */
  get(refundId: string, options?: RequestOptions): Promise<Refund> {
    return this.read(`/refunds/${id(refundId)}`, options);
  }
}

class SubscriptionClient extends PaymentsResource {
  /** @sdk-operation createSubscription POST /api/v1/payments/subscriptions */
  create(input: CreateSubscriptionInput, options?: WriteOptions): Promise<PaymentResource<Subscription>> {
    return this.write('/subscriptions', input, options);
  }

  /** @sdk-operation getSubscription GET /api/v1/payments/subscriptions/{subscriptionId} */
  get(subscriptionId: string, options?: RequestOptions): Promise<Subscription> {
    return this.read(`/subscriptions/${id(subscriptionId)}`, options);
  }

  /** @sdk-operation cancelSubscription POST /api/v1/payments/subscriptions/{subscriptionId}/cancel */
  cancel(subscriptionId: string, input?: { reason?: string }, options?: WriteOptions): Promise<PaymentResource<Subscription>> {
    return this.write(`/subscriptions/${id(subscriptionId)}/cancel`, input ?? {}, options);
  }

  /** @sdk-operation listSubscriptionInvoices GET /api/v1/payments/subscriptions/{subscriptionId}/invoices */
  listInvoices(subscriptionId: string, options?: RequestOptions): Promise<Invoice[]> {
    return this.read(`/subscriptions/${id(subscriptionId)}/invoices`, options);
  }
}

class InvoiceClient extends PaymentsResource {
  /** @sdk-operation getInvoice GET /api/v1/payments/invoices/{invoiceId} */
  get(invoiceId: string, options?: RequestOptions): Promise<Invoice> {
    return this.read(`/invoices/${id(invoiceId)}`, options);
  }
}

class PaymentRecordsClient extends PaymentsResource {
  /**
   * One page of records, newest first; pass the returned nextCursor for the next page.
   * @sdk-operation listPaymentRecords GET /api/v1/payments/records
   */
  list(filters: ListPaymentRecordsOptions = {}, options?: RequestOptions): Promise<PaymentRecordPage> {
    return this.read('/records', options, { ...filters });
  }

  /** Every matching record, fetching pages as you iterate: `for await (const record of records.listAll())`. */
  async *listAll(filters: Omit<ListPaymentRecordsOptions, 'cursor'> = {}, options?: RequestOptions): AsyncGenerator<PaymentRecord, void, undefined> {
    let cursor: string | undefined;
    do {
      const page = await this.list({ ...filters, ...(cursor ? { cursor } : {}) }, options);
      yield* page.records;
      cursor = page.nextCursor;
    } while (cursor);
  }
}

class PaymentCapabilitiesClient extends PaymentsResource {
  /** @sdk-operation getPaymentCapabilities GET /api/v1/payments/capabilities */
  get(options?: RequestOptions): Promise<PaymentCapabilities> {
    return this.read('/capabilities', options);
  }
}

class PayeeClient extends PaymentsResource {
  /** @sdk-operation startPayeeOnboarding POST /api/v1/payments/payees/{payeeId}/onboarding */
  startOnboarding(payeeId: string, details: PayeeOnboardingInput, options?: WriteOptions): Promise<PaymentResource<PayeeOnboarding>> {
    return this.write(`/payees/${id(payeeId)}/onboarding`, details, options);
  }

  /** @sdk-operation getPayeeOnboarding GET /api/v1/payments/payees/{payeeId}/onboarding */
  getOnboarding(payeeId: string, options?: RequestOptions): Promise<PayeeOnboarding> {
    return this.read(`/payees/${id(payeeId)}/onboarding`, options);
  }

  /** @sdk-operation reissuePayeeOnboardingLink POST /api/v1/payments/payees/{payeeId}/onboarding/verification-link */
  reissueOnboardingLink(payeeId: string, options?: WriteOptions): Promise<PaymentResource<PayeeOnboarding>> {
    return this.write(`/payees/${id(payeeId)}/onboarding/verification-link`, {}, options);
  }

  /** @sdk-operation activatePayeeOnboarding POST /api/v1/payments/payees/{payeeId}/onboarding/activate */
  activateOnboarding(payeeId: string, options?: WriteOptions): Promise<PaymentResource<PayeeOnboarding>> {
    return this.write(`/payees/${id(payeeId)}/onboarding/activate`, {}, options);
  }

  /**
   * Registers a payee. Creating the same externalRef again returns the existing payee.
   * @sdk-operation createPayee POST /api/v1/payments/payees
   */
  create(input: CreatePayeeInput, options?: WriteOptions): Promise<PaymentResource<Payee>> {
    return this.write('/payees', input, options);
  }

  /** @sdk-operation listPayees GET /api/v1/payments/payees */
  list(filters: ListPayeesOptions = {}, options?: RequestOptions): Promise<PayeePage> {
    return this.read('/payees', options, { ...filters });
  }

  /** @sdk-operation getPayee GET /api/v1/payments/payees/{payeeId} */
  get(payeeId: string, options?: RequestOptions): Promise<PayeeDetail> {
    return this.read(`/payees/${id(payeeId)}`, options);
  }

  /**
   * Sets where the payee is paid. A new destination holds payouts to the payee for 24 hours;
   * sending the same destination again does not restart the hold.
   * @sdk-operation setPayeeDestination PUT /api/v1/payments/payees/{payeeId}/destination
   */
  setDestination(payeeId: string, destination: PayoutDestination, options?: WriteOptions): Promise<PaymentResource<Payee>> {
    return this.write(`/payees/${id(payeeId)}/destination`, destination, options, 'PUT');
  }

  /** @sdk-operation recordPayeeVerification PUT /api/v1/payments/payees/{payeeId}/verification */
  recordVerification(payeeId: string, verification: RecordPayeeVerificationInput, options?: WriteOptions): Promise<PaymentResource<Payee>> {
    return this.write(`/payees/${id(payeeId)}/verification`, verification, options, 'PUT');
  }

  /**
   * Pays the payee's released earnings now, within the daily cash-out cap. A refusal is an
   * ApiCenterError with status 409 and a code such as DAILY_CAP_REACHED or DESTINATION_HOLD.
   * @sdk-operation cashOutPayee POST /api/v1/payments/payees/{payeeId}/cash-out
   */
  cashOut(payeeId: string, options?: WriteOptions): Promise<PaymentResource<CashOutPayout>> {
    return this.write(`/payees/${id(payeeId)}/cash-out`, {}, options);
  }
}

class AllocationClient extends PaymentsResource {
  /**
   * Releases a held share so it is paid in the payee's next payout. Call it when your own completion rule is met.
   * @sdk-operation releaseAllocation POST /api/v1/payments/allocations/{allocationId}/release
   */
  release(allocationId: string, options?: WriteOptions): Promise<PaymentResource<Allocation>> {
    return this.write(`/allocations/${id(allocationId)}/release`, {}, options);
  }

  /** @sdk-operation cancelAllocation POST /api/v1/payments/allocations/{allocationId}/cancel */
  cancel(allocationId: string, options?: WriteOptions): Promise<PaymentResource<Allocation>> {
    return this.write(`/allocations/${id(allocationId)}/cancel`, {}, options);
  }
}

class PayoutClient extends PaymentsResource {
  /** @sdk-operation listPayouts GET /api/v1/payments/payouts */
  list(filters: ListPayoutsOptions = {}, options?: RequestOptions): Promise<PayoutPage> {
    return this.read('/payouts', options, { ...filters });
  }

  /** @sdk-operation getPayout GET /api/v1/payments/payouts/{payoutId} */
  get(payoutId: string, options?: RequestOptions): Promise<Payout> {
    return this.read(`/payouts/${id(payoutId)}`, options);
  }
}

export class PaymentsNamespace {
  readonly checkouts: CheckoutClient;
  readonly intents: IntentClient;
  readonly customers: CustomerClient;
  readonly plans: PlanClient;
  readonly paymentLinks: PaymentLinkClient;
  readonly refunds: RefundClient;
  readonly subscriptions: SubscriptionClient;
  readonly invoices: InvoiceClient;
  readonly records: PaymentRecordsClient;
  readonly capabilities: PaymentCapabilitiesClient;
  readonly payees: PayeeClient;
  readonly allocations: AllocationClient;
  readonly payouts: PayoutClient;

  constructor(transport: ApiCenterTransport) {
    this.checkouts = new CheckoutClient(transport);
    this.intents = new IntentClient(transport);
    this.customers = new CustomerClient(transport);
    this.plans = new PlanClient(transport);
    this.paymentLinks = new PaymentLinkClient(transport);
    this.refunds = new RefundClient(transport);
    this.subscriptions = new SubscriptionClient(transport);
    this.invoices = new InvoiceClient(transport);
    this.records = new PaymentRecordsClient(transport);
    this.capabilities = new PaymentCapabilitiesClient(transport);
    this.payees = new PayeeClient(transport);
    this.allocations = new AllocationClient(transport);
    this.payouts = new PayoutClient(transport);
  }
}

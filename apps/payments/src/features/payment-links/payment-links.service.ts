import crypto from 'node:crypto';
import { PayMongoError } from '../../shared/payment-errors';
import { isMockMode, paymongoRequest } from '../../shared/paymongo-client';
import { toProviderId, toPublicId } from '../../shared/payment-ids';

type PayMongoCall = typeof paymongoRequest;

function flatResource(response: any) {
  const resource = response?.data || {};
  return { ...resource, ...(resource.attributes || {}) };
}

const isoTime = (value: unknown): string | undefined => typeof value === 'number' && Number.isFinite(value)
  ? new Date(value * 1000).toISOString() : typeof value === 'string' && value ? value : undefined;

type PaymentLinkView = {
  paymentLinkId?: string; amount?: number; currency?: string; description?: string; url?: string; status?: string;
  active: boolean; archived: boolean; referenceNumber?: string; metadata?: Record<string, string>;
  createdAt?: string; updatedAt?: string;
};

// PayMongo describes a link only by status: 'active' or 'archived'. Paid state comes from webhooks.
// Fields PayMongo leaves out are omitted, so merging a response never erases a stored value.
function paymentLink(resource: any): PaymentLinkView {
  const value = flatResource(resource);
  const status = typeof value.status === 'string' ? value.status : undefined;
  const view: PaymentLinkView = { paymentLinkId: typeof value.id === 'string' && value.id ? toPublicId('pl', value.id) : undefined,
    amount: value.amount, currency: value.currency, description: value.description, url: value.url, status,
    active: status === 'active', archived: status === 'archived',
    referenceNumber: typeof value.reference_number === 'string' && value.reference_number ? value.reference_number : undefined,
    metadata: value.metadata, createdAt: isoTime(value.created_at), updatedAt: isoTime(value.updated_at) };
  return Object.fromEntries(Object.entries(view).filter(([, entry]) => entry !== undefined)) as PaymentLinkView;
}

/** PayMongo accepts only string metadata values. APICenter's reference is set last so a caller cannot replace it. */
function linkMetadata(metadata: unknown, referenceId: string): Record<string, string> {
  if (metadata !== undefined && (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata))) {
    throw new PayMongoError('metadata must be an object with string values', 400, 'INVALID_METADATA');
  }
  const entries = Object.entries((metadata ?? {}) as Record<string, unknown>);
  if (entries.some(([, value]) => typeof value !== 'string')) {
    throw new PayMongoError('metadata values must be strings', 400, 'INVALID_METADATA');
  }
  return { ...Object.fromEntries(entries) as Record<string, string>, apicenter_reference_id: referenceId };
}

function stepIdempotencyKey(key: string | undefined, step: string): string | undefined {
  return key ? crypto.createHash('sha256').update(`${key}:${step}`).digest('hex') : undefined;
}

export class PaymentLinksService {
  constructor(private readonly request: PayMongoCall = paymongoRequest,
    private readonly mockMode: () => boolean = isMockMode) {}

  async create(payload: any, idempotencyKey?: string) {
    const { amount, currency = 'PHP', referenceId, description, remarks, metadata } = payload || {};
    if (!Number.isSafeInteger(amount) || amount < 100) {
      throw new PayMongoError('amount must be an integer of at least 100 centavos', 400, 'INVALID_AMOUNT');
    }
    if (currency !== 'PHP') throw new PayMongoError('currency must be PHP', 400, 'INVALID_CURRENCY');
    if (!referenceId || typeof referenceId !== 'string') throw new PayMongoError('referenceId is required', 400, 'INVALID_REFERENCE');
    const text = typeof description === 'string' ? description.trim() : '';
    if (!text || text.length > 255) {
      throw new PayMongoError('description is required and must be 1 to 255 characters', 400, 'INVALID_DESCRIPTION');
    }
    const providerMetadata = linkMetadata(metadata, referenceId);
    if (this.mockMode()) return { paymentLinkId: `pl_mock_${crypto.randomUUID().replace(/-/g, '')}`,
      amount, currency, description: text, url: 'https://paymongo.test/link', status: 'active', active: true,
      archived: false, referenceNumber: `mock${crypto.randomBytes(6).toString('hex')}`, metadata: providerMetadata };
    const response = await this.request('/payment_links', { method: 'POST', idempotencyKey,
      body: { amount, currency, description: text, remarks, metadata: providerMetadata } });
    const link = paymentLink(response);
    // A link without PayMongo's reference number could never be matched to its paid event.
    if (!link.paymentLinkId || !link.referenceNumber) {
      throw new PayMongoError('PayMongo did not return the payment link ID and reference number', 502, 'INVALID_PROVIDER_RESPONSE');
    }
    return { ...link, paymentLinkId: link.paymentLinkId, referenceNumber: link.referenceNumber };
  }

  async get(id: string) {
    if (this.mockMode()) return { paymentLinkId: id, status: 'active', active: true, archived: false };
    return paymentLink(await this.request(`/payment_links/${encodeURIComponent(toProviderId('pl', id))}`));
  }

  async setArchived(id: string, archive: boolean, idempotencyKey?: string) {
    if (typeof archive !== 'boolean') throw new PayMongoError('archive must be a boolean', 400, 'INVALID_ARCHIVE_STATE');
    if (this.mockMode()) return { paymentLinkId: id, status: archive ? 'archived' : 'active', active: !archive, archived: archive };
    const response = await this.request(`/payment_links/${encodeURIComponent(toProviderId('pl', id))}`, {
      method: 'PATCH', body: { archive }, idempotencyKey });
    return paymentLink(response);
  }
}

export class QrPhService {
  constructor(private readonly request: PayMongoCall = paymongoRequest,
    private readonly mockMode: () => boolean = isMockMode) {}

  async create(payload: any, idempotencyKey?: string) {
    const { amount, currency = 'PHP', referenceId, description, expirySeconds } = payload || {};
    if (!Number.isSafeInteger(amount) || amount < 100) {
      throw new PayMongoError('amount must be an integer of at least 100 centavos', 400, 'INVALID_AMOUNT');
    }
    if (currency !== 'PHP') throw new PayMongoError('currency must be PHP', 400, 'INVALID_CURRENCY');
    if (!referenceId || typeof referenceId !== 'string') throw new PayMongoError('referenceId is required', 400, 'INVALID_REFERENCE');
    if (expirySeconds !== undefined && (!Number.isInteger(expirySeconds) || expirySeconds < 60 || expirySeconds > 9000)) {
      throw new PayMongoError('expirySeconds must be an integer from 60 to 9000', 400, 'INVALID_EXPIRY');
    }
    if (this.mockMode()) return { paymentIntentId: `pi_mock_${crypto.randomUUID().replace(/-/g, '')}`,
      referenceId, status: 'awaiting_next_action', amount, currency, qrCodeImageUrl: 'data:image/png;base64,bW9jaw==',
      expirySeconds: expirySeconds ?? 1800 };

    const intentResponse = await this.request('/payment_intents', { method: 'POST', idempotencyKey: stepIdempotencyKey(idempotencyKey, 'intent'),
      body: { data: { attributes: { amount, currency, description, payment_method_allowed: ['qrph'], metadata: { referenceId } } } } });
    const intent = intentResponse?.data || {};
    const intentAttrs = intent.attributes || {};
    if (!intent.id || !intentAttrs.client_key) throw new PayMongoError('PayMongo did not return the intent client key', 502, 'INVALID_PROVIDER_RESPONSE');
    const methodResponse = await this.request('/payment_methods', { method: 'POST', idempotencyKey: stepIdempotencyKey(idempotencyKey, 'method'),
      body: { data: { attributes: { type: 'qrph', ...(expirySeconds === undefined ? {} : { expiry_seconds: expirySeconds }) } } } });
    const paymentMethodId = methodResponse?.data?.id;
    if (!paymentMethodId) throw new PayMongoError('PayMongo did not return a QR Ph payment method', 502, 'INVALID_PROVIDER_RESPONSE');
    const attachedResponse = await this.request(`/payment_intents/${encodeURIComponent(intent.id)}/attach`, {
      method: 'POST', idempotencyKey: stepIdempotencyKey(idempotencyKey, 'attach'),
      body: { data: { attributes: { payment_method: paymentMethodId, client_key: intentAttrs.client_key } } } });
    const attached = attachedResponse?.data || intent;
    const attrs = attached.attributes || {};
    const imageUrl = attrs.next_action?.code?.image_url;
    if (typeof imageUrl !== 'string' || !imageUrl) throw new PayMongoError('PayMongo did not return a QR Ph image', 502, 'INVALID_PROVIDER_RESPONSE');
    return { paymentIntentId: toPublicId('pi', attached.id || intent.id), referenceId,
      status: attrs.status || 'awaiting_next_action', amount: attrs.amount ?? amount,
      currency: attrs.currency || currency, qrCodeImageUrl: imageUrl, expirySeconds: expirySeconds ?? 1800 };
  }
}

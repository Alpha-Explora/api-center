const crypto = require('node:crypto');
const publisherCache = new Map();
const { toPublicId } = require('../shared/payment-ids');

function getPublisher(environment) {
  if (process.env.PUBSUB_DISPATCHER_ENABLED !== 'true') return null;
  if (publisherCache.has(environment)) return publisherCache.get(environment).publisher;

  const { PubSub } = require('@google-cloud/pubsub');
  const client = new PubSub({ projectId: process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT });
  const topicName = paymentEventTopicName(environment);
  const publisher = client.topic(topicName);
  publisherCache.set(environment, { client, publisher });
  return publisher;
}

function paymentEventTopicName(environment) {
  return process.env[`APICENTER_PAYMENT_EVENTS_TOPIC_${environment.toUpperCase()}`]
    || `apicenter.payment-events.${environment}`;
}

function omitUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}


function publicEventId(providerEventId) {
  const value = String(providerEventId || '');
  if (value.startsWith('evt_')) return value;
  return `evt_${crypto.createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}
function publicResourceId(aggregateType, value) {
  const kinds = { checkout: 'chk', payment_intent: 'pi', payment: 'pay', refund: 'ref', subscription: 'sub', invoice: 'inv' };
  return value ? toPublicId(kinds[aggregateType] || 'res', value) : value;
}
/**
 * The public payment event (contract 2.0) for an outbox row. Internally a resource's owner is stored
 * as owner_tribe_id (the organization) and consumer_service_id (the application that created it).
 */
function toCanonicalPaymentEvent(event) {
  const payload = event?.payload || {};
  const applicationId = event.consumerServiceId || payload.consumerServiceId;
  const organizationId = payload.ownerTribeId || event.ownerTribeId;
  const projectId = payload.ownerProjectId || event.ownerProjectId;
  const referenceId = payload.referenceId;
  if (!event.providerEventId) throw new Error('Payment event providerEventId is required');
  if (!event.eventType) throw new Error('Payment event eventType is required');
  if (!['test', 'live'].includes(event.environment)) throw new Error('Payment event environment must be test or live');
  if (!event.aggregateType || !event.aggregateId) throw new Error('Payment event aggregate identity is required');
  if (!organizationId) throw new Error('Payment event organization is required');
  if (!projectId) throw new Error('Payment event project is required');
  if (!applicationId) throw new Error('Payment event application is required');
  if (!referenceId) throw new Error('Payment event referenceId is required');

  const aggregateVersion = Number(event.aggregateVersion || 1);
  if (!Number.isInteger(aggregateVersion) || aggregateVersion < 1) throw new Error('Payment event aggregateVersion must be a positive integer');
  if (event.eventType === 'payment.checkout.paid' && !payload.amount) throw new Error('Paid checkout event amount is required');

  return {
    eventId: publicEventId(event.providerEventId),
    contractVersion: '2.0',
    eventType: event.eventType,
    environment: event.environment,
    organizationId,
    projectId,
    applicationId,
    referenceId,
    aggregateType: event.aggregateType,
    aggregateId: publicResourceId(event.aggregateType, event.aggregateId),
    aggregateVersion,
    occurredAt: payload.occurredAt || (event.createdAt ? new Date(event.createdAt).toISOString() : new Date().toISOString()),
    ...(payload.correlationId ? { correlationId: publicEventId(payload.correlationId) } : {}),
    data: omitUndefined({
      status: payload.status,
      checkoutId: publicResourceId('checkout', payload.checkoutId),
      subscriptionId: publicResourceId('subscription', payload.subscriptionId),
      invoiceId: publicResourceId('invoice', payload.invoiceId),
      paymentId: publicResourceId('payment', payload.paymentId),
      refundId: publicResourceId('refund', payload.refundId),
      amount: payload.amount,
      currency: payload.currency,
    }),
  };
}

async function publishPaymentEvent(event, { topic: providedTopic } = {}) {
  const topic = providedTopic || getPublisher(event.environment);
  if (!topic) return { published: false, disabled: true };

  const canonicalEvent = toCanonicalPaymentEvent(event);
  const messageId = await topic.publishMessage({
    json: canonicalEvent,
    attributes: {
      eventId: canonicalEvent.eventId,
      eventType: canonicalEvent.eventType,
      contractVersion: canonicalEvent.contractVersion,
      environment: canonicalEvent.environment,
      aggregateType: canonicalEvent.aggregateType,
      aggregateId: canonicalEvent.aggregateId,
      aggregateVersion: String(canonicalEvent.aggregateVersion),
      organizationId: canonicalEvent.organizationId,
      projectId: canonicalEvent.projectId,
      applicationId: canonicalEvent.applicationId,
      // Each destination's Pub/Sub subscription filters on this attribute.
      consumerServiceId: canonicalEvent.applicationId,
      referenceId: canonicalEvent.referenceId,
    },
  });
  return { published: true, messageId };
}

/** Close every cached Pub/Sub client so a short-lived job can exit. */
async function closePaymentEventPublishers() {
  await Promise.all([...publisherCache.values()].map(({ client }) => client.close()));
  publisherCache.clear();
}

module.exports = { closePaymentEventPublishers, paymentEventTopicName, publishPaymentEvent, toCanonicalPaymentEvent, publicEventId };

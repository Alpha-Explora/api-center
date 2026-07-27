const { publishPaymentEvent } = require('./pubsubPublisher');

/** Re-publish a committed outbox snapshot without changing its canonical event ID. */
async function replayPaymentEvent(event, { publish = publishPaymentEvent } = {}) {
  if (!event || typeof event !== 'object') throw new Error('Payment event is required for replay');
  if (!event.providerEventId) throw new Error('Payment event providerEventId is required for replay');
  if (!event.aggregateVersion) throw new Error('Payment event aggregateVersion is required for replay');
  return publish(event);
}

module.exports = { replayPaymentEvent };
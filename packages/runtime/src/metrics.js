function recordProviderMetric(event) {
  const payload = {
    type: 'shared_service_provider_metric',
    timestamp: new Date().toISOString(),
    ...event,
  };

  console.log(JSON.stringify(payload));
}

module.exports = { recordProviderMetric };

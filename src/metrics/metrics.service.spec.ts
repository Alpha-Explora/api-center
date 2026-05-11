// =============================================================================
// Unit tests — MetricsService
// =============================================================================
// Covers: showback metrics (tribeRequestsTotal, tribeRequestDuration)
// and the setRegistryServicesCount method.
// =============================================================================

import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    // prom-client registers metrics globally; reset between tests
    const { register: promRegister } = require('prom-client');
    promRegister.clear();
    service = new MetricsService();
    service.onModuleInit();
  });

  describe('recordTribeRequest()', () => {
    it('does not throw when recording valid request data', () => {
      expect(() =>
        service.recordTribeRequest('svc-alpha', 'svc-beta', 'GET', 200, 0.05),
      ).not.toThrow();
    });

    it('increments the counter for each call', async () => {
      service.recordTribeRequest('svc-a', 'svc-b', 'POST', 201, 0.1);
      service.recordTribeRequest('svc-a', 'svc-b', 'POST', 201, 0.2);

      const metric = await service.tribeRequestsTotal.get();
      const value = metric.values.find(
        (v) =>
          v.labels.source_tribe === 'svc-a' &&
          v.labels.target_service === 'svc-b' &&
          v.labels.method === 'POST',
      );
      expect(value?.value).toBe(2);
    });
  });

  describe('setRegistryServicesCount()', () => {
    it('updates the gauge', async () => {
      service.setRegistryServicesCount(5);
      const metric = await service.registryServicesTotal.get();
      expect(metric.values[0].value).toBe(5);
    });

    it('can reset to zero', async () => {
      service.setRegistryServicesCount(10);
      service.setRegistryServicesCount(0);
      const metric = await service.registryServicesTotal.get();
      expect(metric.values[0].value).toBe(0);
    });
  });

  describe('recordRegistryBootstrapSeed()', () => {
    it('increments bootstrap outcome metric labels', async () => {
      service.recordRegistryBootstrapSeed('loaded', 'examples/logistics-manifest.json', 'tribe', 'active');

      const metric = await service.registryBootstrapOperationsTotal.get();
      const value = metric.values.find(
        (entry) =>
          entry.labels.outcome === 'loaded' &&
          entry.labels.seed_source === 'examples/logistics-manifest.json' &&
          entry.labels.service_type === 'tribe' &&
          entry.labels.lifecycle_status === 'active',
      );

      expect(value?.value).toBe(1);
    });
  });

  describe('recordServiceDiscoverySnapshot()', () => {
    it('increments discovery request metrics for lifecycle statuses', async () => {
      service.recordServiceDiscoverySnapshot('tribe', 'authenticated', ['active', 'active', 'deprecated']);

      const metric = await service.registryDiscoveryRequestsTotal.get();
      const value = metric.values.find(
        (entry) =>
          entry.labels.namespace === 'tribe' &&
          entry.labels.caller_type === 'authenticated' &&
          entry.labels.lifecycle_status === 'active',
      );

      expect(value?.value).toBe(2);
    });
  });

  describe('recordKafkaGovernanceOperation()', () => {
    it('increments governance operation counters by action and outcome', async () => {
      service.recordKafkaGovernanceOperation('publish', 'success');
      service.recordKafkaGovernanceOperation('publish', 'success');

      const metric = await service.kafkaGovernanceOperationsTotal.get();
      const value = metric.values.find(
        (entry) =>
          entry.labels.operation === 'publish' &&
          entry.labels.outcome === 'success',
      );

      expect(value?.value).toBe(2);
    });
  });

  describe('recordKafkaPublish()', () => {
    it('increments publish outcome counters by topic and outcome', async () => {
      service.recordKafkaPublish('api-center.audit.log', 'success');
      service.recordKafkaPublish('api-center.audit.log', 'failure');
      service.recordKafkaPublish('api-center.audit.log', 'failure');

      const metric = await service.kafkaPublishOperationsTotal.get();
      const failure = metric.values.find(
        (entry) =>
          entry.labels.topic === 'api-center.audit.log' &&
          entry.labels.outcome === 'failure',
      );

      expect(failure?.value).toBe(2);
    });
  });

  describe('setKafkaProducerConnected()', () => {
    it('sets producer connection gauge to 1 when connected', async () => {
      service.setKafkaProducerConnected(true);

      const metric = await service.kafkaProducerConnected.get();
      expect(metric.values[0].value).toBe(1);
    });

    it('sets producer connection gauge to 0 when disconnected', async () => {
      service.setKafkaProducerConnected(true);
      service.setKafkaProducerConnected(false);

      const metric = await service.kafkaProducerConnected.get();
      expect(metric.values[0].value).toBe(0);
    });
  });
});

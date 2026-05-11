import { HealthMonitorService } from './health-monitor.service';
import { ServiceRegistryEntry } from '../types';

const baseEntry: ServiceRegistryEntry = {
  serviceId: 'payment-service',
  name: 'Payment Service',
  baseUrl: 'http://payment-v1',
  requiredScopes: ['shared:payment:charge'],
  exposes: ['/payments'],
  consumes: [],
  serviceType: 'shared',
  registeredAt: '2026-05-11T00:00:00.000Z',
  updatedAt: '2026-05-11T00:00:00.000Z',
  status: 'active',
};

describe('HealthMonitorService Redis drift reconciliation', () => {
  it('reloads from Redis when entry content diverges with the same updatedAt', async () => {
    const redisEntry: ServiceRegistryEntry = {
      ...baseEntry,
      baseUrl: 'http://payment-v2',
      exposes: ['/payments', '/refunds'],
    };

    const registry = {
      getRedisEntries: jest.fn().mockResolvedValue({ [baseEntry.serviceId]: redisEntry }),
      getAll: jest.fn().mockReturnValue({ [baseEntry.serviceId]: baseEntry }),
      loadFromRedis: jest.fn().mockResolvedValue(undefined),
    };

    const logger = {
      debug: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    };

    const service = new HealthMonitorService(
      registry as any,
      logger as any,
      { publishNonBlocking: jest.fn() } as any,
      { health: { checkTimeoutMs: 500 } } as any,
    );

    await service.handleRedisDriftReconciliation();

    expect(registry.loadFromRedis).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('diverged=1'),
      'HealthMonitor',
    );
  });
});

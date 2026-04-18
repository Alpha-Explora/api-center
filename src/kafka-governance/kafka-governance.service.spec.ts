import { KafkaService } from '../kafka/kafka.service';
import { MetricsService } from '../metrics/metrics.service';
import { ForbiddenError, ValidationError } from '../shared/errors';
import { LoggerService } from '../shared/logger.service';
import { KafkaGovernanceService } from './kafka-governance.service';

describe('KafkaGovernanceService', () => {
  const mockKafka = {
    publish: jest.fn().mockResolvedValue(undefined),
  } as unknown as KafkaService;

  const mockLogger = {
    info: jest.fn(),
  } as unknown as LoggerService;

  const mockMetrics = {
    recordKafkaGovernanceOperation: jest.fn(),
  } as unknown as MetricsService;

  let service: KafkaGovernanceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new KafkaGovernanceService(mockKafka, mockLogger, mockMetrics);
  });

  it('publishes governed messages to tenant-scoped topics', async () => {
    await service.publishMessage(
      'orders-service',
      {
        topic: 'tribe.orders-service.events',
        eventType: 'order.created',
        payload: { orderId: 'ord_123' },
      },
      'corr-1',
    );

    expect(mockKafka.publish).toHaveBeenCalledWith(
      'tribe.orders-service.events',
      expect.objectContaining({
        eventType: 'order.created',
        payload: { orderId: 'ord_123' },
        governance: expect.objectContaining({
          sourceTribeId: 'orders-service',
          correlationId: 'corr-1',
        }),
      }),
      'orders-service',
    );
  });

  it('rejects publish to non-tenant topic', async () => {
    await expect(
      service.publishMessage('orders-service', {
        topic: 'tribe.payments.events',
        eventType: 'order.created',
        payload: { orderId: 'ord_123' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects publish to reserved topics', async () => {
    await expect(
      service.publishMessage('orders-service', {
        topic: '__consumer_offsets',
        eventType: 'order.created',
        payload: { orderId: 'ord_123' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects invalid governed payloads', async () => {
    await expect(
      service.publishMessage('orders-service', {
        topic: 'tribe.orders-service.events',
        eventType: 'order.created',
        payload: null as unknown as Record<string, unknown>,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('returns governance topic recommendations for a tribe', () => {
    const result = service.getGovernanceCatalog('Orders Service');

    expect(result.tenantTopicPrefix).toBe('tribe.orders-service.');
    expect(result.recommendedTopics).toContain('tribe.orders-service.events');
  });
});

import { ExternalService } from './external.service';
import { ConfigService } from '../config/config.service';
import { LoggerService } from '../shared/logger.service';
import { KafkaService } from '../kafka/kafka.service';
import { MetricsService } from '../metrics/metrics.service';
import { NotFoundError, ServiceUnavailableError } from '../shared/errors';

describe('ExternalService', () => {
  let service: ExternalService;

  beforeEach(() => {
    const config = {} as ConfigService;
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as LoggerService;
    const kafka = {
      publish: jest.fn().mockResolvedValue(undefined),
    } as unknown as KafkaService;
    const metrics = {
      setCircuitBreakerState: jest.fn(),
    } as unknown as MetricsService;

    service = new ExternalService(config, logger, kafka, metrics);
  });

  it('should throw not found when requested API is not configured', async () => {
    (service as any).apis = {};

    await expect(
      service.call('unknown-api', { method: 'GET' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('should throw unavailable when API is configured but client is not initialized', async () => {
    (service as any).apis = {
      geo: {
        displayName: 'Geo API',
        baseUrl: 'https://geo.example.com',
        timeout: 5000,
        authType: 'none',
        authHeader: 'Authorization',
      },
    };

    await expect(
      service.call('geo', { method: 'GET' }),
    ).rejects.toThrow(ServiceUnavailableError);
  });

  it('should return breaker stats for every registered breaker', () => {
    (service as any).breakers = new Map([
      ['geo', { getStats: () => ({ name: 'geo', state: 'CLOSED', failureCount: 0 }) }],
      ['risk', { getStats: () => ({ name: 'risk', state: 'OPEN', failureCount: 3 }) }],
    ]);

    const stats = service.getAllBreakerStats();

    expect(stats).toHaveLength(2);
  });
});
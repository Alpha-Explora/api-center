import { ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { KafkaService } from '../../kafka/kafka.service';
import { TOPICS } from '../../kafka/topics';
import { LoggerService } from '../logger.service';
import { AuditLogInterceptor } from './audit-log.interceptor';

function createContext(request: Record<string, unknown>, response: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

describe('AuditLogInterceptor', () => {
  const mockKafka = {
    publish: jest.fn(),
  } as unknown as KafkaService;

  const mockLogger = {
    debug: jest.fn(),
  } as unknown as LoggerService;

  let interceptor: AuditLogInterceptor;

  beforeEach(() => {
    jest.clearAllMocks();
    (mockKafka.publish as jest.Mock).mockResolvedValue(undefined);
    interceptor = new AuditLogInterceptor(mockKafka, mockLogger);
  });

  it('should publish audit event on successful response with tribe route target', async () => {
    const request = {
      method: 'GET',
      originalUrl: '/api/v1/tribes/billing-service/invoices',
      ip: '127.0.0.1',
      tribeId: 'caller-service',
      correlationId: 'corr-1',
    };
    const response = {
      statusCode: 200,
    };

    await lastValueFrom(
      interceptor.intercept(createContext(request, response), {
        handle: () => of({ success: true }),
      }),
    );

    expect(mockKafka.publish).toHaveBeenCalledWith(
      TOPICS.AUDIT_LOG,
      expect.objectContaining({
        tribeId: 'caller-service',
        method: 'GET',
        path: '/api/v1/tribes/billing-service/invoices',
        statusCode: 200,
        targetServiceId: 'billing-service',
        correlationId: 'corr-1',
      }),
      'caller-service',
    );
  });

  it('should still emit audit log when handler throws an error', async () => {
    const request = {
      method: 'POST',
      originalUrl: '/api/v1/external/geolocation/reverse',
      ip: '127.0.0.1',
      tribeId: 'caller-service',
      correlationId: 'corr-2',
    };
    const response = {
      statusCode: 502,
    };

    await expect(
      lastValueFrom(
        interceptor.intercept(createContext(request, response), {
          handle: () => throwError(() => new Error('proxy-failed')),
        }),
      ),
    ).rejects.toThrow('proxy-failed');

    expect(mockKafka.publish).toHaveBeenCalled();
  });

  it('should keep request flow non-blocking when kafka publish fails', async () => {
    (mockKafka.publish as jest.Mock).mockRejectedValue(new Error('kafka-down'));
    const request = {
      method: 'GET',
      originalUrl: '/api/v1/health/ready',
      ip: '127.0.0.1',
      tribeId: 'health-check',
      correlationId: 'corr-3',
    };
    const response = {
      statusCode: 200,
    };

    await lastValueFrom(
      interceptor.intercept(createContext(request, response), {
        handle: () => of({ success: true }),
      }),
    );
    await Promise.resolve();

    expect(mockLogger.debug).toHaveBeenCalled();
  });
});

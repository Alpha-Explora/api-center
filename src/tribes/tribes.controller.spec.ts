import { TribesController } from './tribes.controller';
import { RegistryService } from '../registry/registry.service';
import { AuthService } from '../auth/auth.service';
import { LoggerService } from '../shared/logger.service';
import { MetricsService } from '../metrics/metrics.service';

describe('TribesController', () => {
  const mockRegistry = {
    onCacheInvalidation: jest.fn().mockReturnValue(() => undefined),
  } as unknown as RegistryService;

  const mockAuth = {} as AuthService;
  const mockLogger = {} as LoggerService;
  const mockMetrics = {} as MetricsService;

  let controller: TribesController;
  let handler: {
    listServices: jest.Mock;
    proxyRequest: jest.Mock;
    destroy: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new TribesController(mockRegistry, mockAuth, mockLogger, mockMetrics);

    handler = {
      listServices: jest.fn(),
      proxyRequest: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn(),
    };

    (controller as any).handler = handler;
  });

  it('should list tribe services with namespace metadata', () => {
    handler.listServices.mockReturnValue([{ serviceId: 'billing-service' }]);

    const result = controller.listServices({
      tribeId: 'caller-service',
      correlationId: 'corr-tribe-1',
    } as any);

    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ serviceId: 'billing-service' }]);
    expect(result.meta).toEqual(
      expect.objectContaining({
        total: 1,
        tribeId: 'caller-service',
        namespace: 'tribe',
        correlationId: 'corr-tribe-1',
      }),
    );
  });

  it('should delegate proxy requests to the shared proxy handler', async () => {
    const req = { tribeId: 'caller-service', correlationId: 'corr-tribe-2' } as any;
    const res = {} as any;

    await controller.proxy('billing-service', req, res);

    expect(handler.proxyRequest).toHaveBeenCalledWith('billing-service', req, res);
  });

  it('should destroy handler resources on module shutdown', () => {
    controller.onModuleDestroy();

    expect(handler.destroy).toHaveBeenCalledTimes(1);
  });
});

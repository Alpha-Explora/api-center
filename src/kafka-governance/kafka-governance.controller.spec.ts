import { AuthService } from '../auth/auth.service';
import { ForbiddenError } from '../shared/errors';
import { KafkaGovernanceController } from './kafka-governance.controller';
import { KafkaGovernanceService } from './kafka-governance.service';

describe('KafkaGovernanceController', () => {
  const mockKafkaGovernance = {
    getGovernanceCatalog: jest.fn(),
    getSchemaCatalog: jest.fn(),
    publishMessage: jest.fn(),
  } as unknown as KafkaGovernanceService;

  const mockAuth = {
    checkScopes: jest.fn().mockReturnValue([]),
  } as unknown as AuthService;

  let controller: KafkaGovernanceController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new KafkaGovernanceController(mockKafkaGovernance, mockAuth);
  });

  it('returns governance catalog for authorised caller', () => {
    (mockKafkaGovernance.getGovernanceCatalog as jest.Mock).mockReturnValue({
      tenantTopicPrefix: 'tribe.orders-service.',
    });

    const response = controller.getGovernanceCatalog({
      tribeId: 'orders-service',
      user: { tribeId: 'orders-service', scopes: ['external:kafka:read'] },
      correlationId: 'corr-kafka-1',
    } as any);

    expect(response.success).toBe(true);
    expect(response.data.tenantTopicPrefix).toBe('tribe.orders-service.');
  });

  it('throws forbidden when required scopes are missing', () => {
    (mockAuth.checkScopes as jest.Mock).mockReturnValue(['external:kafka:read']);

    expect(() =>
      controller.getGovernanceCatalog({
        tribeId: 'orders-service',
        user: { tribeId: 'orders-service', scopes: [] },
        correlationId: 'corr-kafka-2',
      } as any),
    ).toThrow(ForbiddenError);
  });

  it('publishes governed messages for authorised caller', async () => {
    (mockAuth.checkScopes as jest.Mock).mockReturnValue([]);
    (mockKafkaGovernance.publishMessage as jest.Mock).mockResolvedValue({
      topic: 'tribe.orders-service.events',
      eventType: 'order.created',
      accepted: true,
    });

    const response = await controller.publishMessage(
      {
        topic: 'tribe.orders-service.events',
        eventType: 'order.created',
        payload: { orderId: 'ord_123' },
      },
      {
        tribeId: 'orders-service',
        user: { tribeId: 'orders-service', scopes: ['external:kafka:write'] },
        correlationId: 'corr-kafka-3',
      } as any,
    );

    expect(response.success).toBe(true);
    expect(mockKafkaGovernance.publishMessage).toHaveBeenCalledWith(
      'orders-service',
      expect.objectContaining({
        topic: 'tribe.orders-service.events',
      }),
      'corr-kafka-3',
    );
  });
});

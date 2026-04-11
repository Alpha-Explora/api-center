import { KafkaService } from './kafka.service';
import { ConfigService } from '../config/config.service';
import { LoggerService } from '../shared/logger.service';
import { TOPICS } from './topics';

jest.mock('kafkajs', () => ({
  Kafka: jest.fn().mockImplementation(() => ({
    producer: (() => {
      const producer = {
        connect: jest.fn(),
        send: jest.fn(),
        disconnect: jest.fn(),
      };
      return () => producer;
    })(),
    consumer: (() => {
      const consumer = {
        connect: jest.fn(),
        subscribe: jest.fn(),
        run: jest.fn(),
        disconnect: jest.fn(),
      };
      return () => consumer;
    })(),
  })),
  logLevel: {
    WARN: 4,
  },
}));

describe('KafkaService', () => {
  const mockConfig = {
    kafka: {
      clientId: 'api-center-test',
      brokers: ['localhost:9092'],
      groupId: 'api-center-group',
    },
  } as unknown as ConfigService;

  const mockLogger = {
    log: jest.fn(),
    error: jest.fn(),
  } as unknown as LoggerService;

  let mockProducer: {
    connect: jest.Mock;
    send: jest.Mock;
    disconnect: jest.Mock;
  };
  let mockConsumer: {
    connect: jest.Mock;
    subscribe: jest.Mock;
    run: jest.Mock;
    disconnect: jest.Mock;
  };
  let service: KafkaService;

  beforeEach(() => {
    jest.clearAllMocks();
    const kafkaModule = jest.requireMock('kafkajs') as {
      Kafka: jest.Mock;
    };

    service = new KafkaService(mockConfig, mockLogger);

    const kafkaInstance = kafkaModule.Kafka.mock.results[0].value as {
      producer: () => { connect: jest.Mock; send: jest.Mock; disconnect: jest.Mock };
      consumer: () => {
        connect: jest.Mock;
        subscribe: jest.Mock;
        run: jest.Mock;
        disconnect: jest.Mock;
      };
    };

    mockProducer = kafkaInstance.producer();
    mockConsumer = kafkaInstance.consumer();

    mockProducer.connect.mockResolvedValue(undefined);
    mockProducer.send.mockResolvedValue(undefined);
    mockProducer.disconnect.mockResolvedValue(undefined);
    mockConsumer.connect.mockResolvedValue(undefined);
    mockConsumer.subscribe.mockResolvedValue(undefined);
    mockConsumer.run.mockResolvedValue(undefined);
    mockConsumer.disconnect.mockResolvedValue(undefined);
  });

  it('should mark producer as connected after successful module init', async () => {
    await service.onModuleInit();

    expect(service.isConnected()).toBe(true);
    expect(mockProducer.connect).toHaveBeenCalledTimes(1);
  });

  it('should keep producer disconnected when module init connect fails', async () => {
    mockProducer.connect.mockRejectedValue(new Error('connect-failed'));

    await service.onModuleInit();

    expect(service.isConnected()).toBe(false);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('should reject publish when payload fails topic schema validation', async () => {
    await expect(service.publish(TOPICS.GATEWAY_REQUEST, {})).rejects.toThrow(
      'Kafka schema validation failed',
    );
    expect(mockProducer.send).not.toHaveBeenCalled();
  });

  it('should reject token-issued events when required schema fields are missing', async () => {
    await expect(
      service.publish(TOPICS.TOKEN_ISSUED, {
        tribeId: 'svc-alpha',
        sub: 'svc-alpha',
      }),
    ).rejects.toThrow('Kafka schema validation failed');
  });

  it('should publish payload with source metadata and key', async () => {
    await service.publish('custom.topic', { event: 'ok' }, 'tribe-a');

    expect(mockProducer.send).toHaveBeenCalledWith({
      topic: 'custom.topic',
      messages: [
        {
          key: 'tribe-a',
          value: expect.any(String),
        },
      ],
    });

    const sentPayload = JSON.parse(mockProducer.send.mock.calls[0][0].messages[0].value);
    expect(sentPayload.event).toBe('ok');
    expect(sentPayload._meta.source).toBe('api-center-test');
    expect(sentPayload._meta.timestamp).toEqual(expect.any(String));
  });

  it('should publish audit events when payload satisfies audit schema', async () => {
    await service.publish(TOPICS.AUDIT_LOG, {
      tribeId: 'svc-alpha',
      method: 'GET',
      path: '/api/v1/tribes/svc-alpha',
      statusCode: 200,
      durationMs: 15,
      ip: '127.0.0.1',
      correlationId: 'corr-1',
    });

    expect(mockProducer.send).toHaveBeenCalledWith(
      expect.objectContaining({ topic: TOPICS.AUDIT_LOG }),
    );
  });

  it('should disconnect producer and consumers on module destroy', async () => {
    (service as any).consumers.set('topic-a', mockConsumer);

    await service.onModuleDestroy();

    expect(mockProducer.disconnect).toHaveBeenCalledTimes(1);
    expect(mockConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(service.isConnected()).toBe(false);
  });
});
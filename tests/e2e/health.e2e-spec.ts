import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService } from '@nestjs/terminus';
import { HealthController } from '../../src/health/health.controller';
import { KafkaService } from '../../src/kafka/kafka.service';
import { RegistryService } from '../../src/registry/registry.service';
import { ExternalService } from '../../src/external/external.service';
import { TokenStoreService } from '../../src/auth/token-store.service';
import { GatewayTrafficService } from '../../src/analytics/gateway-traffic.service';
import { AuditEventsService } from '../../src/analytics/audit-events.service';
import { GovernanceReadinessService } from '../../src/health/governance-readiness.service';
import { ConfigService } from '../../src/config/config.service';

describe('HealthController (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;

  const tokenStore = {
    isRedisConnected: jest.fn().mockReturnValue(true),
  } as unknown as TokenStoreService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: {
            check: jest.fn(async (indicators: Array<() => Promise<Record<string, unknown>>>) => {
              const results = await Promise.all(indicators.map((indicator) => indicator()));
              const info = Object.assign({}, ...results);

              return {
                status: 'ok',
                info,
                error: {},
                details: info,
              };
            }),
          },
        },
        {
          provide: KafkaService,
          useValue: {
            isConnected: jest.fn().mockReturnValue(true),
          },
        },
        {
          provide: RegistryService,
          useValue: {
            count: jest.fn().mockReturnValue(2),
          },
        },
        {
          provide: ExternalService,
          useValue: {
            getAllBreakerStats: jest.fn().mockReturnValue([]),
          },
        },
        {
          provide: TokenStoreService,
          useValue: tokenStore,
        },
        {
          provide: GatewayTrafficService,
          useValue: {
            recordReadinessFailure: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: AuditEventsService,
          useValue: {
            record: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: GovernanceReadinessService,
          useValue: {
            snapshot: jest.fn().mockReturnValue({
              status: 'up',
              quotaEnforcer: 'up',
              policyEngine: 'up',
              approvals: 'up',
              sdkContractVersion: 'local',
              imageTag: 'local',
            }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            kafka: { enabled: true },
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('should return liveness payload at GET /api/v1/health/live', async () => {
    const response = await fetch(`${baseUrl}/api/v1/health/live`);
    const body = (await response.json()) as {
      info: { process: { status: string } };
    };

    expect(response.status).toBe(200);
    expect(body.info.process.status).toBe('up');
  });

  it('should return readiness payload including redis status at GET /api/v1/health/ready', async () => {
    tokenStore.isRedisConnected = jest.fn().mockReturnValue(false);

    const response = await fetch(`${baseUrl}/api/v1/health/ready`);
    const body = (await response.json()) as {
      info: {
        kafka: { status: string };
        redis: { status: string };
        registry: { registeredServices: number };
      };
    };

    expect(response.status).toBe(200);
    expect(body.info.kafka.status).toBe('up');
    expect(body.info.redis.status).toBe('down');
    expect(body.info.registry.registeredServices).toBe(2);
  });
});

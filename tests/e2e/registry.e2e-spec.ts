import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RegistryController } from '../../apps/gateway/src/domains/catalog-registry/registry/registry.controller';
import { RegistryService } from '../../apps/gateway/src/domains/catalog-registry';
import { LoggerService } from '../../apps/gateway/src/shared/logger.service';
import { ScopedAdminGuard } from '../../apps/gateway/src/domains/auth-security';
import { ConfigService } from '../../apps/gateway/src/config/config.service';
import { AuthService } from '../../apps/gateway/src/domains/auth-security/auth/auth.service';
import { AuditEventsService } from '../../apps/gateway/src/domains/compliance/audit/audit-events.service';
import { ApprovalRequestService } from '../../apps/gateway/src/domains/governance';

describe('RegistryController scopes (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;

  const registryService = {
    getAll: jest.fn(),
  } as unknown as RegistryService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [RegistryController],
      providers: [
        { provide: RegistryService, useValue: registryService },
        { provide: ApprovalRequestService, useValue: {} },
        {
          provide: LoggerService,
          useValue: {
            info: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
            error: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            platformAdminSecret: 'test-platform-secret',
          },
        },
        {
          provide: AuthService,
          useValue: {
            validateToken: jest.fn(),
            mergeCallerScopes: jest.fn().mockReturnValue([]),
          },
        },
        {
          provide: AuditEventsService,
          useValue: {
            record: jest.fn().mockResolvedValue(undefined),
          },
        },
        ScopedAdminGuard,
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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return deduplicated scope catalog from registry and policy definitions', async () => {
    (registryService.getAll as jest.Mock).mockReturnValue({
      'billing-service': {
        requiredScopes: ['billing:read', 'billing:write'],
      },
      'ledger-service': {
        requiredScopes: ['billing:read', 'ledger:read'],
      },
    });

    const response = await fetch(`${baseUrl}/api/v1/registry/scopes`, {
      headers: {
        'X-Platform-Secret': 'test-platform-secret',
      },
    });
    const body = (await response.json()) as {
      success: boolean;
      data: {
        platformScopes: string[];
        externalScopes: string[];
        dynamicServiceScopes: string[];
        allScopes: string[];
      };
      meta: { total: number };
    };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.platformScopes).toEqual(['platform:admin']);
    expect(body.data.dynamicServiceScopes).toEqual(['billing:read', 'billing:write', 'ledger:read']);
    expect(body.data.externalScopes).toEqual([]);
    expect(body.meta.total).toBe(body.data.allScopes.length);
  });

  it('should keep dynamic service scopes empty when no services are registered', async () => {
    (registryService.getAll as jest.Mock).mockReturnValue({});

    const response = await fetch(`${baseUrl}/api/v1/registry/scopes`, {
      headers: {
        'X-Platform-Secret': 'test-platform-secret',
      },
    });
    const body = (await response.json()) as {
      data: { dynamicServiceScopes: string[]; allScopes: string[] };
    };

    expect(response.status).toBe(200);
    expect(body.data.dynamicServiceScopes).toEqual([]);
    expect(body.data.allScopes).toEqual(expect.arrayContaining(['platform:admin']));
  });
});

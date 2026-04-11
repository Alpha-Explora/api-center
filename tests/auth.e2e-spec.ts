import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

jest.mock('../src/auth/providers/google.provider', () => ({
  GoogleProvider: class GoogleProvider {},
}));

import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { RegistryService } from '../src/registry/registry.service';
import { LoggerService } from '../src/shared/logger.service';
import { KafkaService } from '../src/kafka/kafka.service';
import { GoogleProvider } from '../src/auth/providers/google.provider';
import { ConfigService } from '../src/config/config.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';

describe('AuthController (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;

  const authService = {
    issueToken: jest.fn().mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: 3600,
    }),
    refreshToken: jest.fn().mockResolvedValue({
      accessToken: 'refreshed-access-token',
      refreshToken: 'refreshed-refresh-token',
      expiresIn: 3600,
    }),
    revokeToken: jest.fn().mockResolvedValue({
      sub: 'svc-alpha',
      revokedCount: 1,
    }),
    getJwksJson: jest.fn().mockReturnValue({ keys: [{ kid: 'dev-key' }] }),
  } as unknown as AuthService;

  const registryService = {
    get: jest.fn(),
    validateSecret: jest.fn().mockResolvedValue(true),
  } as unknown as RegistryService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: RegistryService, useValue: registryService },
        {
          provide: LoggerService,
          useValue: {
            info: jest.fn(),
            error: jest.fn(),
          },
        },
        {
          provide: KafkaService,
          useValue: {
            publish: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: GoogleProvider,
          useValue: {
            buildAuthorizationUrl: jest.fn(),
            exchangeCode: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            authProvider: 'dev-jwt',
            google: {
              redirectUri: 'http://localhost:3000/api/v1/auth/google/callback',
              allowedRedirectOrigins: ['http://localhost:3000'],
            },
          },
        },
        {
          provide: JwtAuthGuard,
          useValue: { canActivate: () => true },
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
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (registryService.validateSecret as jest.Mock).mockResolvedValue(true);
    (registryService.get as jest.Mock).mockImplementation((serviceId: string) => {
      if (serviceId === 'svc-alpha') {
        return {
          serviceId: 'svc-alpha',
          requiredScopes: ['scope:read'],
          consumes: [],
        };
      }
      return null;
    });
  });

  it('should issue a token for valid service credentials', async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tribeId: 'svc-alpha', secret: 'svc-secret' }),
    });
    const body = (await response.json()) as {
      success: boolean;
      data: { accessToken: string; refreshToken: string | null; tribeId: string };
    };

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.accessToken).toBe('access-token');
    expect(body.data.tribeId).toBe('svc-alpha');
  });

  it('should reject token issuance for unknown services', async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tribeId: 'unknown-service', secret: 'svc-secret' }),
    });

    expect(response.status).toBe(404);
  });

  it('should refresh token via /api/v1/auth/token/refresh', async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/token/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'refresh-token' }),
    });
    const body = (await response.json()) as {
      success: boolean;
      data: { accessToken: string; refreshToken: string | null };
    };

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.accessToken).toBe('refreshed-access-token');
  });

  it('should return JWKS when provider serves in-process keys', async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/.well-known/jwks.json`);
    const body = (await response.json()) as { keys: Array<{ kid: string }> };

    expect(response.status).toBe(200);
    expect(body.keys[0].kid).toBe('dev-key');
  });
});

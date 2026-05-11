import { ExecutionContext } from '@nestjs/common';
import { ExternalPolicyGuard } from './external-policy.guard';
import { AuthService } from '../../auth/auth.service';
import { LoggerService } from '../../shared/logger.service';
import { ForbiddenError } from '../../shared/errors';

function createContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('ExternalPolicyGuard', () => {
  const mockAuth = {
    mergeCallerScopes: jest.fn(),
  } as unknown as AuthService;

  const mockLogger = {
    debug: jest.fn(),
    warn: jest.fn(),
  } as unknown as LoggerService;

  let guard: ExternalPolicyGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.EXTERNAL_ALLOWLIST_GEOLOCATION;
    delete process.env.EXTERNAL_ALLOWLIST_GEOFENCING;
    delete process.env.EXTERNAL_ALLOWLIST_GEOTAGGING;
    delete process.env.EXTERNAL_ALLOWLIST_KAFKA;

    guard = new ExternalPolicyGuard(mockAuth, mockLogger);
  });

  it('should allow platform admins without evaluating external policies', () => {
    (mockAuth.mergeCallerScopes as jest.Mock).mockReturnValue(['platform:admin']);

    const result = guard.canActivate(
      createContext({
        method: 'POST',
        params: { apiName: 'geolocation', 0: 'geolocation/v1/geolocate' },
        user: { tribeId: 'tribe-a' },
      }),
    );

    expect(result).toBe(true);
  });

  it('should deny requests to unknown external APIs', () => {
    (mockAuth.mergeCallerScopes as jest.Mock).mockReturnValue([]);

    expect(() =>
      guard.canActivate(
        createContext({
          method: 'POST',
          params: { apiName: 'unknown-api', 0: 'v1/anything' },
          user: { tribeId: 'tribe-a' },
        }),
      ),
    ).toThrow(ForbiddenError);
  });

  it('should deny when external API token has no tribe identity', () => {
    (mockAuth.mergeCallerScopes as jest.Mock).mockReturnValue(['external:geolocation:read']);
    process.env.EXTERNAL_ALLOWLIST_GEOLOCATION = '*';

    expect(() =>
      guard.canActivate(
        createContext({
          method: 'POST',
          params: { apiName: 'geolocation', 0: 'geolocation/v1/geolocate' },
          user: {},
        }),
      ),
    ).toThrow(ForbiddenError);
  });

  it('should deny when caller misses required geolocation scope', () => {
    (mockAuth.mergeCallerScopes as jest.Mock).mockReturnValue([]);
    process.env.EXTERNAL_ALLOWLIST_GEOLOCATION = 'tribe-a';

    expect(() =>
      guard.canActivate(
        createContext({
          method: 'POST',
          params: { apiName: 'geolocation', 0: 'geolocation/v1/geolocate' },
          user: { tribeId: 'tribe-a' },
        }),
      ),
    ).toThrow(ForbiddenError);
  });

  it('should allow geolocation read for allowlisted tribe with required scope', () => {
    (mockAuth.mergeCallerScopes as jest.Mock).mockReturnValue(['external:geolocation:read']);
    process.env.EXTERNAL_ALLOWLIST_GEOLOCATION = 'tribe-a';

    const result = guard.canActivate(
      createContext({
        method: 'POST',
        params: { apiName: 'geolocation', 0: 'geolocation/v1/geolocate' },
        user: { tribeId: 'tribe-a' },
      }),
    );

    expect(result).toBe(true);
  });

  it('should deny kafka topic access outside tribe tenant boundary', () => {
    (mockAuth.mergeCallerScopes as jest.Mock).mockReturnValue([
      'external:kafka:read',
      'external:kafka:write',
    ]);
    process.env.EXTERNAL_ALLOWLIST_KAFKA = 'tribe-a';

    expect(() =>
      guard.canActivate(
        createContext({
          method: 'POST',
          params: {
            apiName: 'kafka',
            0: 'v3/clusters/cluster-1/topics/tribe.tribe-b.orders/records',
          },
          user: { tribeId: 'tribe-a' },
        }),
      ),
    ).toThrow(ForbiddenError);
  });

  it('should still require explicit kafka allowlist when legacy Kafka REST is enabled', () => {
    (mockAuth.mergeCallerScopes as jest.Mock).mockReturnValue(['external:kafka:read']);
    process.env.KAFKA_EXTERNAL_REST_ENABLED = 'true';
    delete process.env.EXTERNAL_ALLOWLIST_KAFKA;

    expect(() =>
      guard.canActivate(
        createContext({
          method: 'GET',
          params: {
            apiName: 'kafka',
            0: 'v3/clusters',
          },
          user: { tribeId: 'tribe-a' },
        }),
      ),
    ).toThrow(ForbiddenError);
  });
});

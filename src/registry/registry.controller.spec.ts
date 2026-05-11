import { RegistryController } from './registry.controller';
import { RegistryService } from './registry.service';
import { LoggerService } from '../shared/logger.service';

describe('RegistryController', () => {
  const mockRegistry = {
    getAll: jest.fn(),
  } as unknown as RegistryService;

  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
  } as unknown as LoggerService;

  let controller: RegistryController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new RegistryController(mockRegistry, mockLogger);
  });

  describe('getScopes', () => {
    it('returns deduplicated platform, external, and dynamic service scopes', () => {
      (mockRegistry.getAll as jest.Mock).mockReturnValue({
        'billing-service': {
          requiredScopes: ['billing:read', 'billing:write'],
        },
        'ledger-service': {
          requiredScopes: ['billing:read', 'ledger:read'],
        },
      });

      const response = controller.getScopes();

      expect(response.success).toBe(true);
      expect(response.data.platformScopes).toEqual(['platform:admin']);
      expect(response.data.externalScopes).toEqual(
        expect.arrayContaining([
          'external:geolocation:read',
          'external:geotagging:read',
          'external:geotagging:write',
          'external:geofencing:read',
          'external:geofencing:write',
        ]),
      );
      expect(response.data.dynamicServiceScopes).toEqual([
        'billing:read',
        'billing:write',
        'ledger:read',
      ]);
      expect(response.data.allScopes).toEqual(
        expect.arrayContaining([
          'platform:admin',
          'external:geolocation:read',
          'billing:write',
        ]),
      );
      expect(response.meta.total).toBe(response.data.allScopes.length);
    });

    it('handles empty service registry gracefully', () => {
      (mockRegistry.getAll as jest.Mock).mockReturnValue({});

      const response = controller.getScopes();

      expect(response.data.dynamicServiceScopes).toEqual([]);
      expect(response.data.allScopes).toEqual(
        expect.arrayContaining(['platform:admin', 'external:geolocation:read']),
      );
    });
  });
});

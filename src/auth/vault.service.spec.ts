import axios from 'axios';
import { VaultService } from './vault.service';
import { ConfigService } from '../config/config.service';
import { LoggerService } from '../shared/logger.service';

jest.mock('axios');

describe('VaultService', () => {
  const client = {
    post: jest.fn(),
    get: jest.fn(),
  };

  const mockLogger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as LoggerService;

  const createConfig = (overrides: Partial<ConfigService['vault']> = {}) => ({
    vault: {
      addr: 'http://vault:8200',
      token: '',
      roleId: '',
      secretId: '',
      secretPath: 'secret/api-center/dev',
      transitKey: 'api-center-signing',
      devMode: false,
      ...overrides,
    },
  } as unknown as ConfigService);

  beforeEach(() => {
    jest.clearAllMocks();
    (axios.create as jest.Mock).mockReturnValue(client);
    delete process.env.NEW_SECRET;
    delete process.env.EXISTING_SECRET;
  });

  it('should enter available mode immediately when Vault dev mode is enabled', async () => {
    const service = new VaultService(createConfig({ devMode: true }), mockLogger);
    const loadSpy = jest.spyOn(service, 'loadSecrets').mockResolvedValue();

    await service.onModuleInit();

    expect(service.isAvailable).toBe(true);
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('should keep Vault unavailable when no credentials are configured', async () => {
    const service = new VaultService(
      createConfig({ devMode: false, token: '', roleId: '', secretId: '' }),
      mockLogger,
    );

    await service.onModuleInit();

    expect(service.isAvailable).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('should load Vault KV secrets without overriding existing environment variables', async () => {
    process.env.EXISTING_SECRET = 'keep-me';

    const service = new VaultService(createConfig(), mockLogger);
    (service as any).available = true;
    (service as any).vaultToken = 'vault-token';

    client.get.mockResolvedValue({
      data: {
        data: {
          data: {
            NEW_SECRET: 'new-value',
            EXISTING_SECRET: 'vault-value',
          },
        },
      },
    });

    await service.loadSecrets();

    expect(client.get).toHaveBeenCalledWith('/v1/secret/data/api-center/dev', {
      headers: { 'X-Vault-Token': 'vault-token' },
    });
    expect(process.env.NEW_SECRET).toBe('new-value');
    expect(process.env.EXISTING_SECRET).toBe('keep-me');
  });

  it('should return null when reading secrets while Vault is unavailable', async () => {
    const service = new VaultService(createConfig(), mockLogger);

    await expect(service.readSecret('secret/api-center/dev', 'JWT_PRIVATE_KEY')).resolves.toBeNull();
  });

  it('should reject signing requests when Vault is unavailable', async () => {
    const service = new VaultService(createConfig(), mockLogger);

    await expect(service.sign('payload')).rejects.toThrow('VaultService: Vault is not available for signing operations');
  });
});

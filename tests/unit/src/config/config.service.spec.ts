import { ConfigService } from '../../../../apps/gateway/src/config/config.service';

describe('ConfigService', () => {
  const originalEnv = process.env;
  const validProductionEnv = () => Object.assign(process.env, {
    NODE_ENV: 'production',
    PLATFORM_ADMIN_SECRET: 'secret',
    ALLOWED_ORIGINS: 'https://app.example.com',
    DATABASE_URL: 'postgresql://localhost/apicenter',
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => { process.env = originalEnv; });

  it('accepts a complete production configuration', () => {
    validProductionEnv();
    expect(() => new ConfigService().onApplicationBootstrap()).not.toThrow();
  });

  it('requires the platform credential in production', () => {
    validProductionEnv();
    delete process.env.PLATFORM_ADMIN_SECRET;
    expect(() => new ConfigService().onApplicationBootstrap()).toThrow('PLATFORM_ADMIN_SECRET must be set');
  });

  it('rejects wildcard CORS in production', () => {
    validProductionEnv();
    process.env.ALLOWED_ORIGINS = '*';
    expect(() => new ConfigService().onApplicationBootstrap()).toThrow('ALLOWED_ORIGINS must list explicit origins');
  });

  it('requires a database URL in production', () => {
    validProductionEnv();
    delete process.env.DATABASE_URL;
    expect(() => new ConfigService().onApplicationBootstrap()).toThrow('DATABASE_URL is required in production');
  });

  it('enables the database when DATABASE_URL is set', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/apicenter';
    expect(new ConfigService().database.enabled).toBe(true);
  });
});

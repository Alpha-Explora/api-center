import { ConfigService } from '../../../../apps/gateway/src/config/config.service';

describe('ConfigService', () => {
  const originalEnv = process.env;
  const validProductionEnv = () => Object.assign(process.env, {
    NODE_ENV: 'production', PLATFORM_ADMIN_SECRET: 'secret', AUTH_PROVIDER: 'descope',
    DESCOPE_PROJECT_ID: 'project-id', DESCOPE_TOKEN_ENDPOINT: 'https://api.descope.com/oauth2/v1/apps/token',
    DESCOPE_ISSUER: 'https://api.descope.com/v1/apps/project-id', DESCOPE_AUDIENCE: 'project-id',
    ALLOWED_ORIGINS: 'https://app.example.com',
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => { process.env = originalEnv; });

  it('rejects unknown auth providers', () => {
    validProductionEnv();
    process.env.AUTH_PROVIDER = 'google';
    expect(() => new ConfigService().onApplicationBootstrap()).toThrow('AUTH_PROVIDER must be one of');
  });

  it('requires persistent keys for production internal JWT', () => {
    validProductionEnv();
    process.env.AUTH_PROVIDER = 'internal-jwt';
    delete process.env.JWT_PRIVATE_KEY;
    delete process.env.JWT_PUBLIC_KEY;
    expect(() => new ConfigService().onApplicationBootstrap())
      .toThrow('JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must be set');
  });

  it('rejects wildcard CORS in production', () => {
    validProductionEnv();
    process.env.ALLOWED_ORIGINS = '*';
    expect(() => new ConfigService().onApplicationBootstrap())
      .toThrow('ALLOWED_ORIGINS must list explicit origins');
  });

  it('requires an explicit override for production registry bootstrap', () => {
    validProductionEnv();
    process.env.REGISTRY_BOOTSTRAP_ENABLED = 'true';
    process.env.REGISTRY_BOOTSTRAP_ALLOW_IN_PRODUCTION = 'false';
    expect(() => new ConfigService().onApplicationBootstrap())
      .toThrow('REGISTRY_BOOTSTRAP_ENABLED=true is blocked');
  });

  it('rejects an enabled database without a URL', () => {
    validProductionEnv();
    process.env.DATABASE_ENABLED = 'true';
    delete process.env.DATABASE_URL;
    expect(() => new ConfigService().onApplicationBootstrap())
      .toThrow('DATABASE_URL is required when DATABASE_ENABLED=true');
  });

  it('rejects an unsupported registry source', () => {
    validProductionEnv();
    process.env.REGISTRY_SOURCE = 'mysql';
    expect(() => new ConfigService().onApplicationBootstrap())
      .toThrow('REGISTRY_SOURCE must be one of: redis, postgres');
  });

  it('keeps environment routing enforcement enabled', () => {
    expect(new ConfigService().environmentContract).toEqual({ mode: 'enforce' });
  });
});

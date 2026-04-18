import { ConfigService } from './config.service';

describe('ConfigService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should parse unique Google redirect origins from configured callback URIs', () => {
    process.env.GOOGLE_ALLOWED_REDIRECT_URIS = [
      'https://app.example.com/auth/callback',
      'https://app.example.com/sso/callback',
      'not-a-url',
      'https://admin.example.com/auth/callback',
    ].join(',');

    const config = new ConfigService();

    expect(config.google.allowedRedirectOrigins).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
    ]);
  });

  it('should throw when auth provider is invalid', () => {
    process.env.NODE_ENV = 'production';
    process.env.PLATFORM_ADMIN_SECRET = 'secret';
    process.env.AUTH_PROVIDER = 'invalid-provider';
    process.env.ALLOWED_ORIGINS = 'https://app.example.com';

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow('AUTH_PROVIDER must be one of');
  });

  it('should throw in production when Google redirect allowlist is missing', () => {
    process.env.NODE_ENV = 'production';
    process.env.PLATFORM_ADMIN_SECRET = 'secret';
    process.env.AUTH_PROVIDER = 'google';
    process.env.GOOGLE_ALLOWED_REDIRECT_URIS = '';
    process.env.ALLOWED_ORIGINS = 'https://app.example.com';

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow('GOOGLE_ALLOWED_REDIRECT_URIS is not set or invalid');
  });

  it('should not throw in production when Google redirect allowlist is valid', () => {
    process.env.NODE_ENV = 'production';
    process.env.PLATFORM_ADMIN_SECRET = 'secret';
    process.env.AUTH_PROVIDER = 'google';
    process.env.GOOGLE_ALLOWED_REDIRECT_URIS = 'https://app.example.com/auth/callback';
    process.env.ALLOWED_ORIGINS = 'https://app.example.com';

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).not.toThrow();
  });

  it('should throw in production when ALLOWED_ORIGINS uses wildcard', () => {
    process.env.NODE_ENV = 'production';
    process.env.PLATFORM_ADMIN_SECRET = 'secret';
    process.env.AUTH_PROVIDER = 'google';
    process.env.GOOGLE_ALLOWED_REDIRECT_URIS = 'https://app.example.com/auth/callback';
    process.env.ALLOWED_ORIGINS = '*';

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow('ALLOWED_ORIGINS must list explicit origins in production');
  });

  it('should throw in production when Kafka SASL is configured without credentials', () => {
    process.env.NODE_ENV = 'production';
    process.env.PLATFORM_ADMIN_SECRET = 'secret';
    process.env.AUTH_PROVIDER = 'google';
    process.env.GOOGLE_ALLOWED_REDIRECT_URIS = 'https://app.example.com/auth/callback';
    process.env.ALLOWED_ORIGINS = 'https://app.example.com';
    process.env.KAFKA_SASL_MECHANISM = 'scram-sha-512';
    process.env.KAFKA_SASL_USERNAME = '';
    process.env.KAFKA_SASL_PASSWORD = '';

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow('KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD must be set');
  });

  it('should throw when Kafka SASL mechanism is invalid', () => {
    process.env.NODE_ENV = 'production';
    process.env.PLATFORM_ADMIN_SECRET = 'secret';
    process.env.AUTH_PROVIDER = 'google';
    process.env.GOOGLE_ALLOWED_REDIRECT_URIS = 'https://app.example.com/auth/callback';
    process.env.ALLOWED_ORIGINS = 'https://app.example.com';
    process.env.KAFKA_SASL_MECHANISM = 'unsupported';

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow('KAFKA_SASL_MECHANISM must be one of');
  });

  it('should throw in production when registry bootstrap is enabled without explicit override', () => {
    process.env.NODE_ENV = 'production';
    process.env.PLATFORM_ADMIN_SECRET = 'secret';
    process.env.AUTH_PROVIDER = 'google';
    process.env.GOOGLE_ALLOWED_REDIRECT_URIS = 'https://app.example.com/auth/callback';
    process.env.ALLOWED_ORIGINS = 'https://app.example.com';
    process.env.REGISTRY_BOOTSTRAP_ENABLED = 'true';
    process.env.REGISTRY_BOOTSTRAP_ALLOW_IN_PRODUCTION = 'false';

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow('REGISTRY_BOOTSTRAP_ENABLED=true is blocked in production');
  });

  it('should not throw in production when registry bootstrap override is explicitly enabled', () => {
    process.env.NODE_ENV = 'production';
    process.env.PLATFORM_ADMIN_SECRET = 'secret';
    process.env.AUTH_PROVIDER = 'google';
    process.env.GOOGLE_ALLOWED_REDIRECT_URIS = 'https://app.example.com/auth/callback';
    process.env.ALLOWED_ORIGINS = 'https://app.example.com';
    process.env.REGISTRY_BOOTSTRAP_ENABLED = 'true';
    process.env.REGISTRY_BOOTSTRAP_ALLOW_IN_PRODUCTION = 'true';
    process.env.REGISTRY_BOOTSTRAP_MANIFESTS = 'examples/logistics-manifest.json';

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).not.toThrow();
  });
});

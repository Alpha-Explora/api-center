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

    const run = () => new ConfigService().onModuleInit();

    expect(run).toThrow('AUTH_PROVIDER must be one of');
  });

  it('should throw in production when Google redirect allowlist is missing', () => {
    process.env.NODE_ENV = 'production';
    process.env.PLATFORM_ADMIN_SECRET = 'secret';
    process.env.AUTH_PROVIDER = 'google';
    process.env.GOOGLE_ALLOWED_REDIRECT_URIS = '';

    const run = () => new ConfigService().onModuleInit();

    expect(run).toThrow('GOOGLE_ALLOWED_REDIRECT_URIS is not set or invalid');
  });

  it('should not throw in production when Google redirect allowlist is valid', () => {
    process.env.NODE_ENV = 'production';
    process.env.PLATFORM_ADMIN_SECRET = 'secret';
    process.env.AUTH_PROVIDER = 'google';
    process.env.GOOGLE_ALLOWED_REDIRECT_URIS = 'https://app.example.com/auth/callback';

    const run = () => new ConfigService().onModuleInit();

    expect(run).not.toThrow();
  });
});
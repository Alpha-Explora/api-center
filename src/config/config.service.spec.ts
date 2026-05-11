import { ConfigService } from './config.service';

describe('ConfigService', () => {
  const originalEnv = process.env;

  const setValidProductionEnv = () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      PLATFORM_ADMIN_SECRET: 'secret',
      AUTH_PROVIDER: 'google',
      GOOGLE_ALLOWED_REDIRECT_URIS: 'https://app.example.com/auth/callback',
      ALLOWED_ORIGINS: 'https://app.example.com',
      KAFKA_BROKERS: 'pkc-ldvj1.ap-southeast-2.aws.confluent.cloud:9092',
      KAFKA_SSL_ENABLED: 'true',
      KAFKA_SASL_MECHANISM: 'plain',
      KAFKA_SASL_USERNAME: 'confluent-key',
      KAFKA_SASL_PASSWORD: 'confluent-secret',
    });
  };

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
    setValidProductionEnv();
    process.env.AUTH_PROVIDER = 'invalid-provider';

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow('AUTH_PROVIDER must be one of');
  });

  it('should throw in production when Google redirect allowlist is missing', () => {
    setValidProductionEnv();
    process.env.GOOGLE_ALLOWED_REDIRECT_URIS = '';

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow('GOOGLE_ALLOWED_REDIRECT_URIS is not set or invalid');
  });

  it('should not throw in production when Google redirect allowlist is valid', () => {
    setValidProductionEnv();

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).not.toThrow();
  });

  it('should throw in production when ALLOWED_ORIGINS uses wildcard', () => {
    setValidProductionEnv();
    process.env.ALLOWED_ORIGINS = '*';

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow('ALLOWED_ORIGINS must list explicit origins in production');
  });

  it('should throw in production when Kafka SASL is configured without credentials', () => {
    setValidProductionEnv();
    process.env.KAFKA_SASL_MECHANISM = 'scram-sha-512';
    process.env.KAFKA_SASL_USERNAME = '';
    process.env.KAFKA_SASL_PASSWORD = '';

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow('KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD must be set');
  });

  it('should throw when Kafka SASL mechanism is invalid', () => {
    setValidProductionEnv();
    process.env.KAFKA_SASL_MECHANISM = 'unsupported';

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow('KAFKA_SASL_MECHANISM must be one of');
  });

  it('should throw in production when registry bootstrap is enabled without explicit override', () => {
    setValidProductionEnv();
    process.env.REGISTRY_BOOTSTRAP_ENABLED = 'true';
    process.env.REGISTRY_BOOTSTRAP_ALLOW_IN_PRODUCTION = 'false';

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow('REGISTRY_BOOTSTRAP_ENABLED=true is blocked in production');
  });

  it('should not throw in production when registry bootstrap override is explicitly enabled', () => {
    setValidProductionEnv();
    process.env.REGISTRY_BOOTSTRAP_ENABLED = 'true';
    process.env.REGISTRY_BOOTSTRAP_ALLOW_IN_PRODUCTION = 'true';
    process.env.REGISTRY_BOOTSTRAP_MANIFESTS = 'examples/logistics-manifest.json';

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).not.toThrow();
  });

  it('should throw in production when Kafka broker points to localhost', () => {
    setValidProductionEnv();
    process.env.KAFKA_BROKERS = 'localhost:9092';

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow('KAFKA_BROKERS must point to Confluent Cloud in production');
  });

  it('should throw in production when Kafka broker is missing', () => {
    setValidProductionEnv();
    process.env.KAFKA_BROKERS = '';

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow('KAFKA_BROKERS must be set for Confluent Cloud in production');
  });

  it('should throw in production when Kafka broker points to a self-managed cluster', () => {
    setValidProductionEnv();
    process.env.KAFKA_BROKERS = 'api-center-kafka-kafka-bootstrap.kafka.svc.cluster.local:9092';

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow('KAFKA_BROKERS must point to Confluent Cloud in production');
  });

  it('should throw in production when any Kafka broker is not Confluent Cloud', () => {
    setValidProductionEnv();
    process.env.KAFKA_BROKERS = [
      'pkc-ldvj1.ap-southeast-2.aws.confluent.cloud:9092',
      'broker.example.com:9092',
    ].join(',');

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow('KAFKA_BROKERS must point to Confluent Cloud in production');
  });

  it('should throw in production when any Kafka broker uses a loopback address', () => {
    setValidProductionEnv();
    process.env.KAFKA_BROKERS = [
      'pkc-ldvj1.ap-southeast-2.aws.confluent.cloud:9092',
      '127.0.0.1:9092',
    ].join(',');

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow('KAFKA_BROKERS must point to Confluent Cloud in production');
  });

  it('should throw in production when Kafka TLS is disabled', () => {
    setValidProductionEnv();
    process.env.KAFKA_SSL_ENABLED = 'false';

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow('KAFKA_SSL_ENABLED=true is required for Confluent Cloud');
  });

  it('should throw in production when Kafka SASL mechanism is not plain', () => {
    setValidProductionEnv();
    process.env.KAFKA_SASL_MECHANISM = 'scram-sha-512';

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow('KAFKA_SASL_MECHANISM=plain is required for Confluent Cloud');
  });
});

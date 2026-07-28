import { ConfigService } from "../../../../apps/gateway/src/config/config.service";

describe("ConfigService", () => {
  const originalEnv = process.env;

  const setValidProductionEnv = () => {
    Object.assign(process.env, {
      NODE_ENV: "production",
      PLATFORM_ADMIN_SECRET: "secret",
      AUTH_PROVIDER: "descope",
      DESCOPE_PROJECT_ID: "project-id",
      DESCOPE_TOKEN_ENDPOINT: "https://api.descope.com/oauth2/v1/apps/token",
      DESCOPE_ISSUER: "https://api.descope.com/v1/apps/project-id",
      DESCOPE_AUDIENCE: "project-id",
      ALLOWED_ORIGINS: "https://app.example.com",
      KAFKA_BROKERS: "pkc-ldvj1.ap-southeast-2.aws.confluent.cloud:9092",
      KAFKA_SSL_ENABLED: "true",
      KAFKA_SASL_MECHANISM: "plain",
      KAFKA_SASL_USERNAME: "confluent-key",
      KAFKA_SASL_PASSWORD: "confluent-secret",
    });
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should throw when auth provider is invalid", () => {
    setValidProductionEnv();
    process.env.AUTH_PROVIDER = "invalid-provider";

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow("AUTH_PROVIDER must be one of");
  });

  it("should reject Google as an API Center auth provider", () => {
    setValidProductionEnv();
    process.env.AUTH_PROVIDER = "google";

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow("AUTH_PROVIDER must be one of");
  });

  it("should reject the removed legacy OIDC provider", () => {
    setValidProductionEnv();
    process.env.AUTH_PROVIDER = ["key", "cloak"].join("");

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow("AUTH_PROVIDER must be one of");
  });

  it("should allow composite auth provider with persistent JWT keys", () => {
    setValidProductionEnv();
    process.env.AUTH_PROVIDER = "composite";
    process.env.JWT_PRIVATE_KEY = "private-key";
    process.env.JWT_PUBLIC_KEY = "public-key";

    const config = new ConfigService();
    const run = () => config.onApplicationBootstrap();

    expect(run).not.toThrow();
    expect(config.authProvider).toBe("composite");
    expect(config.internalJwt.issuer).toBeDefined();
  });

  it("should require persistent JWT keys for production internal auth", () => {
    setValidProductionEnv();
    process.env.AUTH_PROVIDER = "internal-jwt";
    delete process.env.JWT_PRIVATE_KEY;
    delete process.env.JWT_PUBLIC_KEY;

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow(
      "JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must be set for production internal JWT auth",
    );
  });

  it("should throw in production when ALLOWED_ORIGINS uses wildcard", () => {
    setValidProductionEnv();
    process.env.ALLOWED_ORIGINS = "*";

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow(
      "ALLOWED_ORIGINS must list explicit origins in production",
    );
  });

  it("should throw in production when Kafka SASL is configured without credentials", () => {
    setValidProductionEnv();
    process.env.KAFKA_SASL_MECHANISM = "scram-sha-512";
    process.env.KAFKA_SASL_USERNAME = "";
    process.env.KAFKA_SASL_PASSWORD = "";

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow(
      "KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD must be set",
    );
  });

  it("should throw when Kafka SASL mechanism is invalid", () => {
    setValidProductionEnv();
    process.env.KAFKA_SASL_MECHANISM = "unsupported";

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow("KAFKA_SASL_MECHANISM must be one of");
  });

  it("should throw in production when registry bootstrap is enabled without explicit override", () => {
    setValidProductionEnv();
    process.env.REGISTRY_BOOTSTRAP_ENABLED = "true";
    process.env.REGISTRY_BOOTSTRAP_ALLOW_IN_PRODUCTION = "false";

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow(
      "REGISTRY_BOOTSTRAP_ENABLED=true is blocked in production",
    );
  });

  it("should not throw in production when registry bootstrap override is explicitly enabled", () => {
    setValidProductionEnv();
    process.env.REGISTRY_BOOTSTRAP_ENABLED = "true";
    process.env.REGISTRY_BOOTSTRAP_ALLOW_IN_PRODUCTION = "true";
    process.env.REGISTRY_BOOTSTRAP_MANIFESTS =
      "examples/logistics-manifest.json";

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).not.toThrow();
  });

  it("should expose database defaults with Postgres disabled", () => {
    delete process.env.DATABASE_ENABLED;
    delete process.env.DATABASE_PROVIDER;
    delete process.env.DATABASE_URL;
    delete process.env.REGISTRY_DUAL_WRITE;

    const config = new ConfigService();

    expect(config.database).toEqual({
      enabled: false,
      provider: "",
      url: "",
      registrySource: "redis",
      dualWrite: false,
    });
  });

  it("should expose registry dual-write when enabled", () => {
    process.env.REGISTRY_DUAL_WRITE = "true";

    const config = new ConfigService();

    expect(config.database.dualWrite).toBe(true);
  });

  it("should expose Kafka topic prefix for environment isolation", () => {
    process.env.KAFKA_TOPIC_PREFIX = "test.";

    const config = new ConfigService();

    expect(config.kafka.topicPrefix).toBe("test.");
  });

  it("should allow production core gateway mode without Kafka when data pipeline is disabled", () => {
    setValidProductionEnv();
    process.env.AUTH_PROVIDER = "internal-jwt";
    process.env.JWT_PRIVATE_KEY = "private-key";
    process.env.JWT_PUBLIC_KEY = "public-key";
    process.env.DATA_PIPELINE_ENABLED = "false";
    process.env.KAFKA_ENABLED = "false";
    process.env.KAFKA_BROKERS = "";
    process.env.KAFKA_SSL_ENABLED = "false";
    process.env.KAFKA_SASL_MECHANISM = "";
    process.env.KAFKA_SASL_USERNAME = "";
    process.env.KAFKA_SASL_PASSWORD = "";

    const config = new ConfigService();
    const run = () => config.onApplicationBootstrap();

    expect(run).not.toThrow();
    expect(config.dataPipeline.enabled).toBe(false);
    expect(config.kafka.enabled).toBe(false);
  });

  it("should require Confluent config in production when data pipeline is enabled", () => {
    setValidProductionEnv();
    process.env.DATA_PIPELINE_ENABLED = "true";
    process.env.KAFKA_ENABLED = "true";
    process.env.KAFKA_BROKERS = "";

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow(
      "KAFKA_BROKERS must be set when Kafka publishing is enabled",
    );
  });

  it("should throw when database is enabled without DATABASE_URL", () => {
    setValidProductionEnv();
    process.env.DATABASE_ENABLED = "true";
    delete process.env.DATABASE_URL;

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow("DATABASE_URL is required when DATABASE_ENABLED=true");
  });

  it("should throw when REGISTRY_SOURCE is not redis or postgres", () => {
    setValidProductionEnv();
    process.env.REGISTRY_SOURCE = "mysql";

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow("REGISTRY_SOURCE must be one of: redis, postgres");
  });

  it("should throw in production when Kafka broker points to localhost", () => {
    setValidProductionEnv();
    process.env.DATA_PIPELINE_ENABLED = "true";
    process.env.KAFKA_ENABLED = "true";
    process.env.KAFKA_BROKERS = "localhost:9092";

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow(
      "KAFKA_BROKERS must point to Confluent Cloud when Kafka publishing is enabled",
    );
  });

  it("should throw in production when Kafka broker is missing", () => {
    setValidProductionEnv();
    process.env.DATA_PIPELINE_ENABLED = "true";
    process.env.KAFKA_ENABLED = "true";
    process.env.KAFKA_BROKERS = "";

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow(
      "KAFKA_BROKERS must be set when Kafka publishing is enabled",
    );
  });

  it("should throw in production when Kafka broker points to a self-managed cluster", () => {
    setValidProductionEnv();
    process.env.DATA_PIPELINE_ENABLED = "true";
    process.env.KAFKA_ENABLED = "true";
    process.env.KAFKA_BROKERS =
      "api-center-kafka-kafka-bootstrap.kafka.svc.cluster.local:9092";

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow(
      "KAFKA_BROKERS must point to Confluent Cloud when Kafka publishing is enabled",
    );
  });

  it("should throw in production when any Kafka broker is not Confluent Cloud", () => {
    setValidProductionEnv();
    process.env.DATA_PIPELINE_ENABLED = "true";
    process.env.KAFKA_ENABLED = "true";
    process.env.KAFKA_BROKERS = [
      "pkc-ldvj1.ap-southeast-2.aws.confluent.cloud:9092",
      "broker.example.com:9092",
    ].join(",");

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow(
      "KAFKA_BROKERS must point to Confluent Cloud when Kafka publishing is enabled",
    );
  });

  it("should throw in production when any Kafka broker uses a loopback address", () => {
    setValidProductionEnv();
    process.env.DATA_PIPELINE_ENABLED = "true";
    process.env.KAFKA_ENABLED = "true";
    process.env.KAFKA_BROKERS = [
      "pkc-ldvj1.ap-southeast-2.aws.confluent.cloud:9092",
      "127.0.0.1:9092",
    ].join(",");

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow(
      "KAFKA_BROKERS must point to Confluent Cloud when Kafka publishing is enabled",
    );
  });

  it("should throw in production when Kafka TLS is disabled", () => {
    setValidProductionEnv();
    process.env.DATA_PIPELINE_ENABLED = "true";
    process.env.KAFKA_ENABLED = "true";
    process.env.KAFKA_SSL_ENABLED = "false";

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow(
      "KAFKA_SSL_ENABLED=true is required when Kafka publishing is enabled",
    );
  });

  it("should throw in production when Kafka SASL mechanism is not plain", () => {
    setValidProductionEnv();
    process.env.DATA_PIPELINE_ENABLED = "true";
    process.env.KAFKA_ENABLED = "true";
    process.env.KAFKA_SASL_MECHANISM = "scram-sha-512";

    const run = () => new ConfigService().onApplicationBootstrap();

    expect(run).toThrow(
      "KAFKA_SASL_MECHANISM=plain is required when Kafka publishing is enabled",
    );
  });

  it("keeps the one-URL environment contract in enforce mode", () => {
    const config = new ConfigService();

    expect(config.environmentContract).toEqual({
      mode: "enforce",
    });
  });
});

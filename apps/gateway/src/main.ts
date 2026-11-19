// =============================================================================
// Gateway entry point. Applications call /api/v1/shared/:capability/*, /api/v1/payments/* and
// /api/v1/apis/:apiId/* with an application key; the console and operator scripts use
// /api/v1/admin/* with the platform credential. Durable state lives in Postgres; rate-limit
// counters are per instance, in memory, so instances are interchangeable.
// =============================================================================

// OTel MUST be initialized first — patches http/express before any require
import { initTracing } from "./tracing";
initTracing();

import { NestFactory } from "@nestjs/core";
import express, { Request } from "express";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { LoggerService } from "./shared/logger.service";
import { ConfigService } from "./config/config.service";
import { loadGcpSecretsIntoEnv } from "./config/gcp-secret-loader";
import { AllExceptionsFilter } from "./shared/filters/all-exceptions.filter";
import { CorrelationIdInterceptor } from "./shared/interceptors/correlation-id.interceptor";
import { AuditLogInterceptor } from "./shared/interceptors/audit-log.interceptor";
import { MetricsInterceptor } from "./metrics/metrics.interceptor";

async function bootstrap() {
  await loadGcpSecretsIntoEnv({
    info: (message: string) => console.log(`[Bootstrap] ${message}`),
    warn: (message: string) => console.warn(`[Bootstrap] ${message}`),
  });

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });

  const captureRawBody = (
    request: Request,
    _response: unknown,
    body: Buffer,
  ) => {
    (request as Request & { rawBody?: Buffer }).rawBody = Buffer.from(body);
  };
  app.use(express.json({ limit: "100kb", verify: captureRawBody }));
  app.use(
    express.urlencoded({
      extended: true,
      limit: "100kb",
      verify: captureRawBody,
    }),
  );

  const logger = app.get(LoggerService);
  const config = app.get(ConfigService);
  app.useLogger(logger);

  // ── Security headers ──────────────────────────────────────────────────────
  app.use(
    helmet({
      // The gateway serves JSON to other origins; pages set their own CSP.
      crossOriginResourcePolicy: { policy: "cross-origin" },
      contentSecurityPolicy: false,
    }),
  );

  // ── CORS ── ALLOWED_ORIGINS: * in development, an explicit list in production.
  app.enableCors({
    origin: config.cors.origin,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Correlation-ID",
      "X-Platform-Secret",
      "Idempotency-Key",
      "APICenter-Version",
      "APICenter-SDK",
    ],
    exposedHeaders: [
      "X-Correlation-ID",
      "Retry-After",
      "x-idempotency-replayed",
    ],
    credentials: true, // allow Authorization header from browsers
    maxAge: 86_400, // cache preflight for 24 h — reduces OPTIONS volume
  });

  // ── Request validation ────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties from DTOs
      forbidNonWhitelisted: true, // reject requests with unknown properties
      transform: true, // auto-coerce strings to numbers/booleans
    }),
  );

  // ── Global interceptors ───────────────────────────────────────────────────
  // Run on every request, in this order:
  //   1. CorrelationId — assign / propagate X-Correlation-ID
  //   2. AuditLog      — log the request after the response
  //   3. Metrics       — record Prometheus counter + histogram
  app.useGlobalInterceptors(
    app.get(CorrelationIdInterceptor),
    app.get(AuditLogInterceptor),
    app.get(MetricsInterceptor),
  );

  // ── Global exception filter ───────────────────────────────────────────────
  app.useGlobalFilters(app.get(AllExceptionsFilter));

  // ── API versioning ────────────────────────────────────────────────────────
  // All routes are prefixed /api/v1/ — version bumps get a new prefix.
  app.setGlobalPrefix("api/v1");

  const isSwaggerEnabled = process.env.ENABLE_SWAGGER === "true";
  if (isSwaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("APICenter Gateway API")
      .setDescription(
        "Shared services, payments and published APIs for applications with an APICenter key",
      )
      .setVersion("1.0.0")
      .addBearerAuth()
      .build();

    const swaggerDoc = SwaggerModule.createDocument(app, swaggerConfig, {
      deepScanRoutes: true,
    });
    SwaggerModule.setup("api/docs", app, swaggerDoc, {
      jsonDocumentUrl: "api/docs-json",
    });
  }

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  // On SIGTERM/SIGINT, NestJS calls onModuleDestroy() on all modules before
  // the process exits, so database connections close cleanly.
  app.enableShutdownHooks();

  await app.listen(config.port);

  logger.log(
    `────────────────────────────────────────────────────`,
    "Bootstrap",
  );
  logger.log(`  APICenter gateway  |  port: ${config.port}`, "Bootstrap");
  logger.log(`  environment        |  ${config.nodeEnv}`, "Bootstrap");
  logger.log(
    `  CORS origins       |  ${JSON.stringify(config.cors.origin)}`,
    "Bootstrap",
  );
  logger.log(`  swagger enabled    |  ${isSwaggerEnabled}`, "Bootstrap");
  logger.log(`  shared state       |  Postgres; counters in memory`, "Bootstrap");
  logger.log(
    `────────────────────────────────────────────────────`,
    "Bootstrap",
  );
}

bootstrap();

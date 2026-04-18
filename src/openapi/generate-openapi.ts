import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from '../app.module';

async function generateOpenApi(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');

  const config = new DocumentBuilder()
    .setTitle('APICenter Gateway API')
    .setDescription('Gateway contracts for tribe, shared-service, and external API routing')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    deepScanRoutes: true,
  });

  const outputDir = join(process.cwd(), 'docs', 'openapi');
  mkdirSync(outputDir, { recursive: true });

  const outputPath = join(outputDir, 'openapi.json');
  writeFileSync(outputPath, JSON.stringify(document, null, 2), 'utf-8');

  await app.close();
  // eslint-disable-next-line no-console
  console.log(`OpenAPI schema generated at ${outputPath}`);
}

generateOpenApi().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to generate OpenAPI schema', error);
  process.exit(1);
});

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from '../../apps/gateway/src/domains/runtime-ops/health/health.controller';

describe('HealthController (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  const saved = { databaseUrl: process.env.DATABASE_URL, databaseEnabled: process.env.DATABASE_ENABLED };

  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_ENABLED;
    const moduleFixture = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    if (saved.databaseUrl !== undefined) process.env.DATABASE_URL = saved.databaseUrl;
    if (saved.databaseEnabled !== undefined) process.env.DATABASE_ENABLED = saved.databaseEnabled;
  });

  it('answers liveness at GET /api/v1/health/live', async () => {
    const response = await fetch(`${baseUrl}/api/v1/health/live`);
    const body = (await response.json()) as { info: { process: { status: string } } };
    expect(response.status).toBe(200);
    expect(body.info.process.status).toBe('up');
  });

  it('answers readiness with the database and release at GET /api/v1/health/ready', async () => {
    const response = await fetch(`${baseUrl}/api/v1/health/ready`);
    const body = (await response.json()) as { info: Record<string, { status: string }> };
    expect(response.status).toBe(200);
    expect(Object.keys(body.info).sort()).toEqual(['database', 'process', 'release']);
  });
});

// =============================================================================
// src/config/secrets.service.ts — Runtime secrets management
// =============================================================================
// Attempts to load secrets from GCP Secret Manager when GCP_SECRET_NAME is
// set. Falls back gracefully to process.env for local development.
//
// HOW IT WORKS:
//  1. On module init, checks for GCP_SECRET_NAME env var
//  2. Resolves the GCP project from GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT
//  3. Fetches the specified secret version (GCP_SECRET_VERSION, default: latest)
//  4. Parses the JSON payload and merges keys into process.env
//     (existing env vars are NOT overridden — explicit env always wins)
//  5. If GCP is not configured or the fetch fails, logs a warning and continues
//
// This runs BEFORE ConfigService reads env vars, so the rest of the app
// is unaffected — it just sees process.env with secrets already populated.
// =============================================================================

import { Injectable, OnModuleInit } from '@nestjs/common';
import { LoggerService } from '../shared/logger.service';
import { loadGcpSecretsIntoEnv } from './gcp-secret-loader';

@Injectable()
export class SecretsService implements OnModuleInit {
  constructor(private readonly logger: LoggerService) {}

  async onModuleInit() {
    await loadGcpSecretsIntoEnv({
      info: (message: string) => this.logger.info(message, {}),
      warn: (message: string) => this.logger.warn(message, 'SecretsService'),
    });
  }
}

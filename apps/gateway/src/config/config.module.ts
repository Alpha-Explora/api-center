// =============================================================================
// src/config/config.module.ts — Configuration module
// =============================================================================
// Provides ConfigService as a global singleton.
// GCP Secret Manager payloads are loaded in main.ts before Nest creates this
// module, so ConfigService constructors read already-populated process.env.
// =============================================================================

import { Global, Module } from "@nestjs/common";
import { ConfigService } from "./config.service";

@Global()
@Module({
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}

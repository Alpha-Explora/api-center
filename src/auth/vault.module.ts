// =============================================================================
// src/auth/vault.module.ts — Vault service module
// =============================================================================

import { Module } from '@nestjs/common';
import { VaultService } from './vault.service';

@Module({
  providers: [VaultService],
  exports: [VaultService],
})
export class VaultModule {}

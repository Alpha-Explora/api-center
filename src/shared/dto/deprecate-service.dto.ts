// =============================================================================
// src/shared/dto/deprecate-service.dto.ts — DTO for PATCH .../deprecate
// =============================================================================

import { IsString, IsOptional, IsDateString, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class DeprecateServiceDto {
  @ApiPropertyOptional({ example: '2026-12-31T00:00:00.000Z' })
  @IsDateString({}, { message: 'sunsetDate must be a valid ISO-8601 date' })
  @IsOptional()
  sunsetDate?: string;

  @ApiPropertyOptional({ example: 'payment-service-v2' })
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'replacementService must be a valid serviceId',
  })
  @IsOptional()
  replacementService?: string;
}

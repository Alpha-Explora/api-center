// =============================================================================
// src/shared/dto/google-callback.dto.ts — DTO for POST /api/v1/auth/google/callback
// =============================================================================

import { IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

export class GoogleCallbackDto {
  @IsString()
  @IsNotEmpty({ message: 'code is required' })
  code!: string;

  @IsOptional()
  @IsUrl(
    { require_protocol: true, protocols: ['http', 'https'], require_tld: false },
    { message: 'redirectUri must be a valid http or https URL' },
  )
  redirectUri?: string;
}
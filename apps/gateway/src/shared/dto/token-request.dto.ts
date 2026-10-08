// =============================================================================
// src/shared/dto/token-request.dto.ts - DTO for POST /api/v1/auth/token
// =============================================================================
// A token is issued to one tribe service, proven by that service's own environment secret.
// The service's project and tribe come from the registry; callers cannot choose them.
// =============================================================================

import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsNotEmpty, IsString, Matches, MaxLength } from "class-validator";
import {
  APICENTER_RUNTIME_ENVIRONMENT_KEYS,
  ApicenterRuntimeEnvironment,
} from "../../types";

export class TokenRequestDto {
  @ApiProperty({ example: "logistics-orders", maxLength: 64 })
  @IsString()
  @IsNotEmpty({ message: "serviceId is required" })
  @MaxLength(64, { message: "serviceId is too long" })
  @Matches(/^[a-z0-9-]+$/, { message: "serviceId must be lowercase alphanumeric with hyphens only" })
  serviceId!: string;

  @ApiProperty({ example: "test", enum: APICENTER_RUNTIME_ENVIRONMENT_KEYS })
  @IsString()
  @IsNotEmpty({ message: "environment is required" })
  @IsIn(APICENTER_RUNTIME_ENVIRONMENT_KEYS, {
    message: "environment must be one of: test, live",
  })
  environment!: ApicenterRuntimeEnvironment;

  @ApiProperty({ example: "super-secret-value" })
  @IsString()
  @IsNotEmpty({ message: "secret is required" })
  secret!: string;
}

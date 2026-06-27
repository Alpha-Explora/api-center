// =============================================================================
// src/shared/dto/token-request.dto.ts - DTO for POST /api/v1/auth/token
// =============================================================================
// NestJS uses class-validator decorators instead of Zod schemas.
// The ValidationPipe automatically validates incoming request bodies
// against these DTOs before the controller method runs.
// =============================================================================

import { ApiProperty } from "@nestjs/swagger";
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";
import {
  APICENTER_RUNTIME_ENVIRONMENT_KEYS,
  ApicenterRuntimeEnvironment,
} from "../../types";

export class TokenRequestDto {
  @ApiProperty({ example: "payment-service", maxLength: 50 })
  @IsString()
  @IsNotEmpty({ message: "tribeId is required" })
  @MaxLength(50, { message: "tribeId is too long" })
  tribeId!: string;

  @ApiProperty({ example: "payment-api", required: false, maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80, { message: "sourceServiceId is too long" })
  sourceServiceId?: string;

  @ApiProperty({ example: "test", enum: APICENTER_RUNTIME_ENVIRONMENT_KEYS })
  @IsOptional()
  @IsString()
  @IsIn(APICENTER_RUNTIME_ENVIRONMENT_KEYS, {
    message: "environment must be one of: test, live",
  })
  environment?: ApicenterRuntimeEnvironment;

  @ApiProperty({ example: "super-secret-value" })
  @IsString()
  @IsNotEmpty({ message: "secret is required" })
  secret!: string;
}

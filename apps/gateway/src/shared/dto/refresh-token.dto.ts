// =============================================================================
// src/shared/dto/refresh-token.dto.ts — DTO for POST /api/v1/auth/token/refresh
// =============================================================================

import { IsString, IsNotEmpty } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class RefreshTokenDto {
  @ApiProperty({ example: "refresh-token-value" })
  @IsString()
  @IsNotEmpty({ message: "refreshToken is required" })
  refreshToken!: string;
}

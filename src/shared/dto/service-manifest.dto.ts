// =============================================================================
// src/shared/dto/service-manifest.dto.ts — DTO for service registration
// =============================================================================
// Validates service registration manifests using class-validator decorators.
// Replaces the Zod serviceManifestSchema from the Express version.
// =============================================================================

import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsUrl,
  IsArray,
  ArrayMinSize,
  IsOptional,
  IsIn,
  IsDateString,
  Matches,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ServiceManifestDto {
  @ApiProperty({ example: "payment-service" })
  @IsString()
  @IsNotEmpty({ message: "serviceId is required" })
  @MaxLength(64, { message: "serviceId is too long" })
  @Matches(/^[a-z0-9-]+$/, {
    message: "serviceId must be lowercase alphanumeric with hyphens only",
  })
  serviceId!: string;

  @ApiProperty({ example: "Payment Service" })
  @IsString()
  @IsNotEmpty({ message: "name is required" })
  @MaxLength(128, { message: "name is too long" })
  name!: string;

  @ApiProperty({ example: "http://payment-service:4001" })
  @IsString()
  @IsUrl(
    {
      require_tld: false,
      require_protocol: true,
      protocols: ["http", "https"],
    },
    { message: "baseUrl must be a valid URL" },
  )
  baseUrl!: string;

  @ApiProperty({ example: ["payments:read", "payments:write"] })
  @IsArray()
  @ArrayMinSize(1, { message: "At least one required scope must be defined" })
  @IsString({ each: true })
  requiredScopes!: string[];

  @ApiProperty({ example: ["/payments", "/payments/:id"] })
  @IsArray()
  @ArrayMinSize(1, { message: "At least one exposed route must be defined" })
  @IsString({ each: true })
  exposes!: string[];

  @ApiPropertyOptional({ example: ["user-service", "email-service"] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  consumes?: string[] = [];

  @ApiPropertyOptional({
    example: "logistics",
    description:
      "Tribe that owns this service. Defaults to serviceId for legacy tribe entries.",
  })
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: "ownerTribeId must be lowercase alphanumeric with hyphens only",
  })
  @IsOptional()
  ownerTribeId?: string;

  @ApiPropertyOptional({ example: "/health" })
  @IsString()
  @IsOptional()
  healthCheck?: string;

  @ApiPropertyOptional({ example: "1.0.0" })
  @IsString()
  @IsOptional()
  @Matches(/^\d+\.\d+\.\d+/, {
    message: "version must follow semver (e.g. 1.0.0)",
  })
  version?: string;

  @ApiPropertyOptional({ example: "Handles all payment operations" })
  @IsString()
  @MaxLength(500, { message: "description is too long" })
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: ["finance", "pci"] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  // ── Governance fields ──────────────────────────────────────────────────────

  @ApiPropertyOptional({ example: "Finance Tribe" })
  @IsString()
  @MaxLength(128)
  @IsOptional()
  ownerTeam?: string;

  @ApiPropertyOptional({ example: "finance-platform@example.com" })
  @IsString()
  @MaxLength(256, { message: "contact is too long" })
  @IsOptional()
  contact?: string;

  @ApiPropertyOptional({
    example: "critical",
    enum: ["critical", "standard", "experimental"],
  })
  @IsString()
  @IsIn(["critical", "standard", "experimental"], {
    message: "serviceTier must be critical, standard, or experimental",
  })
  @IsOptional()
  serviceTier?: string;

  @ApiPropertyOptional({ example: "FIN-001" })
  @IsString()
  @MaxLength(64)
  @IsOptional()
  costCenter?: string;

  @ApiPropertyOptional({ example: "2026-12-31T00:00:00.000Z" })
  @IsDateString({}, { message: "sunsetDate must be a valid ISO-8601 date" })
  @IsOptional()
  sunsetDate?: string;

  @ApiPropertyOptional({ example: "payment-service-v2" })
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: "replacementService must be a valid serviceId",
  })
  @IsOptional()
  replacementService?: string;

  // ── Routing namespace ──────────────────────────────────────────────────────

  @ApiPropertyOptional({
    example: "tribe",
    enum: ["shared", "tribe"],
    default: "tribe",
  })
  @IsString()
  @IsIn(["shared", "tribe"], {
    message: "serviceType must be either shared or tribe",
  })
  @IsOptional()
  serviceType?: string = "tribe";
}

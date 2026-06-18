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
  ArrayUnique,
  IsOptional,
  IsIn,
  IsDateString,
  IsBoolean,
  Matches,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { isOwnerTribeIdRequiredForManifest } from "../service-manifest-governance";

@ValidatorConstraint({ name: "ownerTribeId", async: false })
class OwnerTribeIdConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const manifest = args.object as {
      serviceId?: string;
      serviceType?: string;
      ownerTribeId?: string;
    };
    if (value === undefined || value === null || value === "") {
      return !isOwnerTribeIdRequiredForManifest(manifest);
    }

    return typeof value === "string" && /^[a-z0-9-]+$/.test(value);
  }

  defaultMessage(args: ValidationArguments): string {
    if (args.value === undefined || args.value === null || args.value === "") {
      return "ownerTribeId is required for tribe microservices or hyphenated tribe service IDs";
    }

    return "ownerTribeId must be lowercase alphanumeric with hyphens only";
  }
}

export class ServiceEnvironmentDto {
  @ApiProperty({
    example: "test",
    enum: ["test", "staging", "uat", "demo", "live"],
  })
  @IsString()
  @IsIn(["test", "staging", "uat", "demo", "live"], {
    message: "environment must be one of test, staging, uat, demo, or live",
  })
  environment!: string;

  @ApiProperty({ example: "https://trinithrive-test.example.com" })
  @IsString()
  @IsUrl(
    {
      require_tld: false,
      require_protocol: true,
      protocols: ["http", "https"],
    },
    { message: "environment baseUrl must be a valid URL" },
  )
  baseUrl!: string;

  @ApiPropertyOptional({ example: "/health" })
  @IsString()
  @IsOptional()
  healthCheck?: string;
}

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
  @Validate(OwnerTribeIdConstraint)
  ownerTribeId?: string;

  @ApiPropertyOptional({ example: "/health" })
  @IsString()
  @IsOptional()
  healthCheck?: string;

  @ApiPropertyOptional({ type: [ServiceEnvironmentDto] })
  @IsArray()
  @ArrayUnique(
    (environment: ServiceEnvironmentDto) => environment.environment,
    { message: "Environment keys must be unique" },
  )
  @ValidateNested({ each: true })
  @Type(() => ServiceEnvironmentDto)
  @IsOptional()
  environments?: ServiceEnvironmentDto[];

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

  @ApiPropertyOptional({ example: "live", enum: ["test", "live"] })
  @IsString()
  @IsIn(["test", "live"], {
    message: "targetEnvironment must be test or live",
  })
  @IsOptional()
  targetEnvironment?: string;

  @ApiPropertyOptional({ example: "approval-request-id" })
  @IsString()
  @MaxLength(128)
  @IsOptional()
  approvalRequestId?: string;

  @ApiPropertyOptional({ example: "Payments API" })
  @IsString()
  @MaxLength(128)
  @IsOptional()
  apiProductName?: string;

  @ApiPropertyOptional({ example: "Checkout and subscription operations." })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  apiProductDescription?: string;

  @ApiPropertyOptional({ example: "gold" })
  @IsString()
  @MaxLength(64)
  @IsOptional()
  slaTier?: string;

  @ApiPropertyOptional({ example: "#payments-support" })
  @IsString()
  @MaxLength(128)
  @IsOptional()
  supportChannel?: string;

  @ApiPropertyOptional({ example: "https://docs.example.com/payments" })
  @IsString()
  @IsUrl(
    {
      require_tld: false,
      require_protocol: true,
      protocols: ["http", "https"],
    },
    { message: "documentationUrl must be a valid URL" },
  )
  @IsOptional()
  documentationUrl?: string;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  providerCostSensitive?: boolean;
}

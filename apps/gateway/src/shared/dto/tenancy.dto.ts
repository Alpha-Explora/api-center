import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from "class-validator";
import { PROJECT_ID_PATTERN, TRIBE_ID_PATTERN } from "../tenancy-identifiers";

const STATUSES = ["active", "suspended", "archived"] as const;

export class CreateTribeDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiProperty({ example: "alphaci" })
  @IsString()
  @Matches(TRIBE_ID_PATTERN, { message: "tribeId must be a lowercase slug of 1-64 characters" })
  tribeId!: string;

  @ApiProperty({ example: "AlphaCI" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateTribeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];
}

export class CreateProjectDto {
  @ApiProperty({ example: "alphaci-billing" })
  @IsString()
  @Matches(PROJECT_ID_PATTERN, { message: "projectId must be a lowercase slug of 1-80 characters" })
  projectId!: string;

  @ApiProperty({ example: "Billing" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: "FIN-001" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  costCenter?: string;
}

export class UpdateProjectDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  costCenter?: string;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];
}

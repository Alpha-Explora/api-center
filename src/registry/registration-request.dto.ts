import { Type } from "class-transformer";
import {
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ServiceManifestDto } from "../shared/dto/service-manifest.dto";

export class CreateRegistrationRequestDto {
  @ApiProperty({ type: ServiceManifestDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ServiceManifestDto)
  manifest!: ServiceManifestDto;

  @ApiPropertyOptional({
    example: "github:logistics/orders-api/.github/workflows/register.yml",
  })
  @IsString()
  @MaxLength(256)
  @IsOptional()
  requestedBy?: string;
}

export class RejectRegistrationRequestDto {
  @ApiProperty({
    example: "Consumes list references an unapproved production service.",
  })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class RegistrationRequestIdDto {
  @Matches(/^[0-9a-fA-F-]{36}$/)
  requestId!: string;
}

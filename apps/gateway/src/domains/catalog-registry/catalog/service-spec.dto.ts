import {
  IsIn,
  IsObject,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export const SERVICE_SPEC_FORMATS = [
  "openapi-3.0",
  "openapi-3.1",
  "asyncapi-2",
  "asyncapi-3",
] as const;

export class PublishServiceSpecDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  version!: string;

  @IsIn(SERVICE_SPEC_FORMATS)
  format!: (typeof SERVICE_SPEC_FORMATS)[number];

  @IsObject()
  document!: Record<string, unknown>;
}

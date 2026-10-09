import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export const API_SUBSCRIPTION_ENVIRONMENTS = ["test", "live"] as const;

export class RequestApiSubscriptionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  consumerProjectId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  apiServiceId!: string;

  @IsIn(API_SUBSCRIPTION_ENVIRONMENTS)
  environment!: (typeof API_SUBSCRIPTION_ENVIRONMENTS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class SubscriptionDecisionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  apiServiceId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

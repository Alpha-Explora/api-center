import {
  IsNotEmpty,
  IsNotEmptyObject,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const TOPIC_PATTERN = /^[A-Za-z0-9._-]+$/;

export class KafkaPublishMessageDto {
  @ApiProperty({
    example: "tribe.orders-service.events",
    description: "Tenant-scoped Kafka topic name",
    maxLength: 200,
  })
  @IsString()
  @IsNotEmpty({ message: "topic is required" })
  @MaxLength(200, { message: "topic is too long" })
  @Matches(TOPIC_PATTERN, {
    message: "topic contains unsupported characters",
  })
  topic!: string;

  @ApiPropertyOptional({
    example: "order-123",
    description: "Optional Kafka message key for partition affinity",
  })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: "key is too long" })
  key?: string;

  @ApiProperty({
    example: "order.created",
    description: "Domain event type for schema governance",
    maxLength: 120,
  })
  @IsString()
  @IsNotEmpty({ message: "eventType is required" })
  @MaxLength(120, { message: "eventType is too long" })
  eventType!: string;

  @ApiProperty({
    example: { orderId: "ord_123", amount: 99900 },
    description: "Event payload object",
  })
  @IsObject({ message: "payload must be an object" })
  @IsNotEmptyObject({}, { message: "payload must not be empty" })
  payload!: Record<string, unknown>;

  @ApiPropertyOptional({
    example: { sourceService: "checkout-service" },
    description: "Optional event metadata map",
  })
  @IsOptional()
  @IsObject({ message: "metadata must be an object when provided" })
  metadata?: Record<string, string>;
}

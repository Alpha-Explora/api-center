import { ApiProperty } from "@nestjs/swagger";
import {
  APICENTER_RUNTIME_ENVIRONMENT_KEYS,
  ApicenterRuntimeEnvironment,
} from "../../types";

export class TokenIssueDataDto {
  @ApiProperty({ example: "eyJhbGciOi..." })
  accessToken!: string;

  @ApiProperty({ example: "eyJhbGciOi...", nullable: true })
  refreshToken!: string | null;

  @ApiProperty({ example: 3600 })
  expiresIn!: number;

  @ApiProperty({ example: "logistics-orders" })
  serviceId!: string;

  @ApiProperty({ example: "logistics-fulfilment" })
  projectId!: string;

  @ApiProperty({ example: "logistics" })
  tribeId!: string;

  @ApiProperty({ example: "test", enum: APICENTER_RUNTIME_ENVIRONMENT_KEYS })
  environment!: ApicenterRuntimeEnvironment;

  @ApiProperty({ type: [String], example: ["service:logistics-orders:read"] })
  permissions!: string[];

  @ApiProperty({ type: [String], example: ["payment:charge"] })
  scopes!: string[];
}

export class TokenIssueMetaDto {
  @ApiProperty({ example: "2026-06-27T00:00:00.000Z" })
  timestamp!: string;

  @ApiProperty({ example: "req_01JZ..." })
  correlationId!: string;
}

export class TokenIssueResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ type: () => TokenIssueDataDto })
  data!: TokenIssueDataDto;

  @ApiProperty({ type: () => TokenIssueMetaDto })
  meta!: TokenIssueMetaDto;
}

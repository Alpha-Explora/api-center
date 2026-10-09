import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";

export const ORGANIZATION_ROLES = ["admin", "operator", "observer"] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export class UpsertOrganizationMemberDto {
  @ApiProperty({ enum: ORGANIZATION_ROLES, example: "operator" })
  @IsIn(ORGANIZATION_ROLES)
  role!: OrganizationRole;
}

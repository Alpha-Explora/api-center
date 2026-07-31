import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import {
  DriftSnapshot,
  GovernanceDriftService,
} from "./governance-drift.service";

@Controller("admin/operations/drift")
@UseGuards(ScopedAdminGuard)
export class GovernanceDriftController {
  constructor(private readonly drift: GovernanceDriftService) {}

  @Post("compare")
  compare(@Body() snapshot: DriftSnapshot) {
    return { success: true, data: this.drift.compare(snapshot) };
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import {
  EmergencyControl,
  EmergencyControlService,
  parseEmergencyControl,
  parseEmergencyControlTarget,
} from "./emergency-control.service";

@Controller("admin/operations/emergency")
@UseGuards(ScopedAdminGuard)
export class EmergencyControlController {
  constructor(private readonly controls: EmergencyControlService) {}

  @Get()
  list() {
    return { success: true, data: this.controls.list() };
  }

  @Post()
  apply(@Body() input: EmergencyControl) {
    return {
      success: true,
      data: this.controls.apply(parseEmergencyControl(input)),
    };
  }

  @Delete()
  clear(
    @Query("targetType") targetType: EmergencyControl["targetType"],
    @Query("targetId") targetId: string,
  ) {
    const target = parseEmergencyControlTarget({ targetType, targetId });
    this.controls.clear(target.targetType, target.targetId);
    return { success: true, data: { ...target, cleared: true } };
  }
}

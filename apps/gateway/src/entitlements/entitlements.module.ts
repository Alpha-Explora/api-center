import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../database/database.module";
import { TribePlanAdminController } from "./tribe-plan-admin.controller";
import { TribePlanService } from "./tribe-plan.service";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [TribePlanAdminController],
  providers: [TribePlanService],
  exports: [TribePlanService],
})
export class EntitlementsModule {}

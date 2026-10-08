import { Module, forwardRef } from "@nestjs/common";
import { AuthModule } from "@auth/auth.module";
import { DatabaseModule } from "@database/database.module";
import { RegistryModule } from "@registry/registry.module";
import { TribePlanAdminController } from "./tribe-plan-admin.controller";
import { TribePlanService } from "./tribe-plan.service";

@Module({
  imports: [AuthModule, DatabaseModule, forwardRef(() => RegistryModule)],
  controllers: [TribePlanAdminController],
  providers: [TribePlanService],
  exports: [TribePlanService],
})
export class EntitlementsModule {}

import { Module } from "@nestjs/common";
import { AuthModule } from "@auth/auth.module";
import { DatabaseModule } from "@database/database.module";
import { RegistryModule } from "@registry/registry.module";
import { ApiSubscriptionsController } from "./api-subscriptions.controller";
import { ApiSubscriptionsService } from "./api-subscriptions.service";

@Module({
  imports: [AuthModule, DatabaseModule, RegistryModule],
  controllers: [ApiSubscriptionsController],
  providers: [ApiSubscriptionsService],
})
export class ApiSubscriptionsModule {}

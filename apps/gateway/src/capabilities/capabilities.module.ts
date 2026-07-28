import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CapabilitiesController } from "./capabilities.controller";
import { CapabilitiesService } from "./capabilities.service";

@Module({
  imports: [AuthModule],
  controllers: [CapabilitiesController],
  providers: [CapabilitiesService],
  exports: [CapabilitiesService],
})
export class CapabilitiesModule {}

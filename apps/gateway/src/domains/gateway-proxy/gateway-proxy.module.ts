import { Module } from "@nestjs/common";
import { TribesModule } from "./tribes/tribes.module";
import { SharedServicesModule } from "./shared-services/shared-services.module";
import { ExternalModule } from "./external/external.module";

@Module({
  imports: [TribesModule, SharedServicesModule, ExternalModule],
  exports: [TribesModule, SharedServicesModule, ExternalModule],
})
export class GatewayProxyModule {}

import { Module } from "@nestjs/common";
import { ControlPlaneModule } from "@domains/control-plane/control-plane.module";
import { PublishedApiForwarder, PublishedApiProxyController } from "./published-api-proxy.controller";

/** /api/v1/apis/:apiId/* — calls to control-plane published APIs. */
@Module({
  imports: [ControlPlaneModule],
  controllers: [PublishedApiProxyController],
  providers: [PublishedApiForwarder],
})
export class PublishedApisModule {}

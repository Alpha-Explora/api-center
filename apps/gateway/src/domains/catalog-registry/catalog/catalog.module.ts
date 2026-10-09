import { Module } from "@nestjs/common";
import { AuthModule } from "@auth/auth.module";
import { RegistryModule } from "@registry/registry.module";
import { ApiProductController } from "./api-product.controller";
import { ApiProductService } from "./api-product.service";
import {
  ServiceSpecCatalogController,
  ServiceSpecController,
} from "./service-spec.controller";
import { ServiceSpecService } from "./service-spec.service";
import { ServiceSpecPublishGuard } from "./service-spec-publish.guard";
import { DatabaseModule } from "@database/database.module";

@Module({
  imports: [AuthModule, RegistryModule, DatabaseModule],
  controllers: [
    ApiProductController,
    ServiceSpecController,
    ServiceSpecCatalogController,
  ],
  providers: [ApiProductService, ServiceSpecService, ServiceSpecPublishGuard],
  exports: [ApiProductService, ServiceSpecService],
})
export class CatalogModule {}

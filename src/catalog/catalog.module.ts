import { Module } from "@nestjs/common";
import { RegistryModule } from "../registry/registry.module";
import { ApiProductController } from "./api-product.controller";
import { ApiProductService } from "./api-product.service";

@Module({
  imports: [RegistryModule],
  controllers: [ApiProductController],
  providers: [ApiProductService],
  exports: [ApiProductService],
})
export class CatalogModule {}

import { Module } from "@nestjs/common";
import { RegistryModule } from "./registry/registry.module";
import { CatalogModule } from "./catalog/catalog.module";

@Module({
  imports: [RegistryModule, CatalogModule],
  exports: [RegistryModule, CatalogModule],
})
export class CatalogRegistryModule {}

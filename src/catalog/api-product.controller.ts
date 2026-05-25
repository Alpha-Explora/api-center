import { Controller, Get, UseGuards } from "@nestjs/common";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import { RegistryService } from "../registry/registry.service";
import { ApiProductService } from "./api-product.service";

@Controller("admin/catalog/products")
@UseGuards(ScopedAdminGuard)
export class ApiProductController {
  constructor(
    private readonly registry: RegistryService,
    private readonly products: ApiProductService,
  ) {}

  @Get()
  listProducts() {
    return {
      success: true,
      data: this.products.fromRegistry(Object.values(this.registry.getAll())),
    };
  }
}

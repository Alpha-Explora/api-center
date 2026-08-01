import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import { PaymentCatalogManagementService } from "./payment-catalog-management.service";

@Controller("admin/payments/catalog")
@UseGuards(ScopedAdminGuard)
export class PaymentCatalogManagementController {
  constructor(private readonly catalog: PaymentCatalogManagementService) {}

  @Post("products")
  async createProduct(@Body() body: unknown) {
    return { success: true, data: await this.catalog.createProduct(body) };
  }

  @Post("prices")
  async createPrice(@Body() body: unknown) {
    return { success: true, data: await this.catalog.createPrice(body) };
  }
}

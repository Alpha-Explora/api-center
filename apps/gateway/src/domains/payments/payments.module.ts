import { Module } from "@nestjs/common";
import { AuthModule } from "@auth/auth.module";
import { DatabaseModule } from "@database/database.module";
import { ControlPlaneModule } from "@domains/control-plane/control-plane.module";
import { PaymentsController } from "./features/payment-facade";
import { PaymentIdempotencyService } from "./shared/payment-idempotency.service";
import { PaymentLimitsService } from "./features/payment-limits";
import { PaymentReturnController } from "./features/payment-return/payment-return.controller";
import { PaymentReturnLinks } from "./features/payment-return/payment-return-links";

/** The payments facade for application keys, payment return pages, and payment event subscription provisioning. */
@Module({
  imports: [AuthModule, DatabaseModule, ControlPlaneModule],
  controllers: [PaymentsController, PaymentReturnController],
  providers: [PaymentIdempotencyService, PaymentLimitsService, PaymentReturnLinks],
})
export class PaymentsModule {}

import { Module } from '@nestjs/common';
import { PaymentsModule } from '../../../domains/payments/payments/payments.module';

@Module({
  imports: [PaymentsModule],
  exports: [PaymentsModule],
})
export class PaymentFacadeModule {}

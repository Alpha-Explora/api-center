import { Module } from '@nestjs/common';
import { SharedServicesModule } from '../../../domains/gateway-proxy/shared-services/shared-services.module';

@Module({
  imports: [SharedServicesModule],
  exports: [SharedServicesModule],
})
export class SharedProxyModule {}

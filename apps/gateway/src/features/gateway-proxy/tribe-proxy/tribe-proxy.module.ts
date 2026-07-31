import { Module } from '@nestjs/common';
import { TribesModule } from '../../../domains/gateway-proxy/tribes/tribes.module';

@Module({
  imports: [TribesModule],
  exports: [TribesModule],
})
export class TribeProxyModule {}

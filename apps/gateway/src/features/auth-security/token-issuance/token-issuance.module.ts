import { Module } from '@nestjs/common';
import { AuthModule } from '../../../domains/auth-security/auth/auth.module';

@Module({
  imports: [AuthModule],
  exports: [AuthModule],
})
export class TokenIssuanceModule {}

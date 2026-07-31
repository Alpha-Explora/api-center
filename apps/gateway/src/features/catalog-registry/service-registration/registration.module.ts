import { Module } from '@nestjs/common';
import { RegistryModule } from '../../../domains/catalog-registry/registry/registry.module';

@Module({
  imports: [RegistryModule],
  exports: [RegistryModule],
})
export class ServiceRegistrationModule {}

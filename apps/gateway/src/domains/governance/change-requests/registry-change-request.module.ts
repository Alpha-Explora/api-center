import { Module } from "@nestjs/common";
import { DatabaseModule } from "@database/database.module";
import { RegistryChangeRequestStoreService } from "./registry-change-request-store.service";
import { REGISTRY_CHANGE_REQUEST_STORE } from "./registry-change-request.types";

@Module({
  imports: [DatabaseModule],
  providers: [
    RegistryChangeRequestStoreService,
    { provide: REGISTRY_CHANGE_REQUEST_STORE, useExisting: RegistryChangeRequestStoreService },
  ],
  exports: [REGISTRY_CHANGE_REQUEST_STORE],
})
export class RegistryChangeRequestModule {}

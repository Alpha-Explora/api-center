// Platform-operator authentication for the gateway's admin routes (the management console's
// server and operator scripts). Application callers authenticate with application keys in the
// control plane; there are no service tokens.
import { Module } from "@nestjs/common";
import { ScopedAdminGuard } from "./guards/scoped-admin.guard";

@Module({
  providers: [ScopedAdminGuard],
  exports: [ScopedAdminGuard],
})
export class AuthModule {}

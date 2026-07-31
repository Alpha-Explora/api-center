// =============================================================================
// src/auth/auth.module.ts - Authentication module
// =============================================================================
// Wires the pluggable AuthProvider, VaultService, and TokenStoreService.
//
// PROVIDER SELECTION (AUTH_PROVIDER env var):
//   descope      -> DescopeProvider      - OIDC/JWKS validation and legacy M2M
//   internal-jwt -> InternalJwtProvider  - API Center-signed tribe M2M JWTs
//   composite    -> Internal JWT issuer + Descope validation fallback
//   dev-jwt      -> DevJwtProvider       - local dev / CI [default]
// =============================================================================

import { Module, forwardRef } from "@nestjs/common";
import { AUTH_PROVIDER } from "./auth-provider.interface";
import { DescopeProvider } from "./providers/descope.provider";
import { DevJwtProvider } from "./providers/dev-jwt.provider";
import { InternalJwtProvider } from "./providers/internal-jwt.provider";
import { CompositeAuthProvider } from "./providers/composite-auth.provider";
import { TokenStoreService } from "./token-store.service";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { PlatformAdminGuard } from "./guards/platform-admin.guard";
import { ScopedAdminGuard } from "./guards/scoped-admin.guard";
import { AuthController } from "./auth.controller";
import { RegistryModule } from "@registry/registry.module";
import { ConfigService } from "@config/config.service";
import { VaultModule } from "./vault.module";

const authProviderFactory = {
  provide: AUTH_PROVIDER,
  inject: [
    ConfigService,
    DescopeProvider,
    DevJwtProvider,
    InternalJwtProvider,
    CompositeAuthProvider,
  ],
  useFactory: (
    config: ConfigService,
    descope: DescopeProvider,
    devJwt: DevJwtProvider,
    internalJwt: InternalJwtProvider,
    composite: CompositeAuthProvider,
  ) => {
    if (config.authProvider === "descope") return descope;
    if (config.authProvider === "internal-jwt") return internalJwt;
    if (config.authProvider === "composite") return composite;
    return devJwt;
  },
};

@Module({
  imports: [forwardRef(() => RegistryModule), VaultModule],
  controllers: [AuthController],
  providers: [
    TokenStoreService,
    DescopeProvider,
    DevJwtProvider,
    InternalJwtProvider,
    CompositeAuthProvider,
    authProviderFactory,
    AuthService,
    JwtAuthGuard,
    PlatformAdminGuard,
    ScopedAdminGuard,
  ],
  exports: [
    AuthService,
    VaultModule,
    TokenStoreService,
    JwtAuthGuard,
    PlatformAdminGuard,
    ScopedAdminGuard,
  ],
})
export class AuthModule {}

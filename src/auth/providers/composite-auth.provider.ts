import { Injectable, Logger } from "@nestjs/common";
import { AuthProvider, JwtClaims } from "../auth-provider.interface";
import { DescopeProvider } from "./descope.provider";
import { InternalJwtProvider } from "./internal-jwt.provider";

@Injectable()
export class CompositeAuthProvider implements AuthProvider {
  private readonly logger = new Logger(CompositeAuthProvider.name);

  constructor(
    private readonly internalJwt: InternalJwtProvider,
    private readonly descope: DescopeProvider,
  ) {}

  issueToken(serviceId: string, permissions: string[], scopes: string[]) {
    return this.internalJwt.issueToken(serviceId, permissions, scopes);
  }

  async validateToken(token: string): Promise<JwtClaims> {
    try {
      return await this.internalJwt.validateToken(token);
    } catch (error) {
      this.logger.debug(
        `Internal JWT validation failed, trying Descope fallback: ${(error as Error).message}`,
      );
      return this.descope.validateToken(token);
    }
  }

  refreshToken(refreshToken: string) {
    return this.internalJwt.refreshToken(refreshToken);
  }

  getJwksJson() {
    return this.internalJwt.getJwksJson();
  }
}

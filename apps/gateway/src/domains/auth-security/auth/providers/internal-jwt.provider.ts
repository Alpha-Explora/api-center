import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  exportJWK,
  importPKCS8,
  importSPKI,
  JWK,
  jwtVerify,
  SignJWT,
  type CryptoKey,
} from "jose";
import { randomUUID } from "node:crypto";
import {
  AuthProvider,
  IssuedToken,
  JwtClaims,
  TokenIssueContext,
} from "../auth-provider.interface";
import { ConfigService } from "@config/config.service";

const KEY_ID = "api-center-internal-1";

@Injectable()
export class InternalJwtProvider implements AuthProvider, OnModuleInit {
  private readonly logger = new Logger(InternalJwtProvider.name);
  private privateKey?: CryptoKey;
  private publicKey?: CryptoKey;
  private publicJwk?: JWK;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    if (!["internal-jwt", "composite"].includes(this.config.authProvider)) {
      return;
    }

    await this.initialiseKeys();
  }

  async validateToken(token: string): Promise<JwtClaims> {
    await this.ensureKeysReady();

    const { payload } = await jwtVerify(token, this.publicKey!, {
      issuer: this.config.internalJwt.issuer,
      audience: this.config.internalJwt.audience,
      algorithms: ["RS256"],
    });

    const permissions = Array.isArray(payload["permissions"])
      ? payload["permissions"].filter(
          (permission): permission is string => typeof permission === "string",
        )
      : [];
    const scopes = Array.isArray(payload["scopes"])
      ? payload["scopes"].filter(
          (scope): scope is string => typeof scope === "string",
        )
      : [];

    return {
      sub: payload.sub ?? "",
      tribeId: payload["tribeId"] as string | undefined,
      projectId: payload["projectId"] as string | undefined,
      sourceServiceId: payload["sourceServiceId"] as string | undefined,
      environment: payload["environment"] as JwtClaims["environment"],
      permissions,
      scopes,
      exp: payload.exp,
      ...payload,
    };
  }

  async issueToken(
    serviceId: string,
    permissions: string[],
    scopes: string[],
    context: TokenIssueContext = {},
  ): Promise<IssuedToken> {
    const commonClaims = {
      tribeId: context.tribeId,
      projectId: context.projectId,
      sourceServiceId: context.sourceServiceId ?? serviceId,
      environment: context.environment,
      permissions,
      scopes,
    };

    const accessToken = await this.signJwt(
      {
        ...commonClaims,
        tokenType: "access",
      },
      serviceId,
      this.config.internalJwt.accessTtlSeconds,
    );

    const refreshToken = await this.signJwt(
      {
        ...commonClaims,
        tokenType: "refresh",
      },
      serviceId,
      this.config.internalJwt.refreshTtlSeconds,
    );

    this.logger.log(`Internal M2M token issued for service '${serviceId}'`);

    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.internalJwt.accessTtlSeconds,
      refreshExpiresIn: this.config.internalJwt.refreshTtlSeconds,
    };
  }

  async refreshToken(refreshToken: string): Promise<IssuedToken> {
    const claims = await this.validateToken(refreshToken);
    if (claims["tokenType"] !== "refresh") {
      throw new Error("Provided token is not a refresh token");
    }

    return this.issueToken(
      claims.sub,
      claims.permissions ?? [],
      claims.scopes ?? [],
      {
        tribeId: claims.tribeId,
        projectId: claims.projectId,
        sourceServiceId: claims.sourceServiceId ?? claims.sub,
        environment: claims.environment,
      },
    );
  }

  getJwksJson(): Record<string, unknown> {
    if (!this.publicJwk) {
      throw new Error("InternalJwtProvider JWKS requested before key init");
    }
    return { keys: [this.publicJwk] };
  }

  private async ensureKeysReady(): Promise<void> {
    if (this.privateKey && this.publicKey && this.publicJwk) {
      return;
    }

    await this.initialiseKeys();
  }

  private async initialiseKeys(): Promise<void> {
    const privatePem = this.config.internalJwt.privateKey;
    const publicPem = this.config.internalJwt.publicKey;
    if (!privatePem || !publicPem) {
      throw new Error(
        "InternalJwtProvider requires JWT_PRIVATE_KEY and JWT_PUBLIC_KEY",
      );
    }

    this.privateKey = await importPKCS8(
      privatePem.replace(/\\n/g, "\n"),
      "RS256",
    );
    this.publicKey = await importSPKI(publicPem.replace(/\\n/g, "\n"), "RS256");
    this.publicJwk = await exportJWK(this.publicKey);
    this.publicJwk.kid = KEY_ID;
    this.publicJwk.use = "sig";
    this.publicJwk.alg = "RS256";
  }

  private async signJwt(
    claims: Record<string, unknown>,
    subject: string,
    ttlSeconds: number,
  ): Promise<string> {
    await this.ensureKeysReady();

    return new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
      .setJti(randomUUID())
      .setSubject(subject)
      .setIssuer(this.config.internalJwt.issuer)
      .setAudience(this.config.internalJwt.audience)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(this.privateKey!);
  }
}

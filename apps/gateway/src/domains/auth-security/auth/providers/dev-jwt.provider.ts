// =============================================================================
// src/auth/providers/dev-jwt.provider.ts - Lightweight RS256 JWT provider
// =============================================================================
// Purpose-built for local development and CI environments.
// =============================================================================

import { Injectable, Logger, OnModuleInit, Optional } from "@nestjs/common";
import {
  generateKeyPair,
  exportJWK,
  SignJWT,
  jwtVerify,
  importPKCS8,
  importSPKI,
  JWK,
  type CryptoKey,
} from "jose";
import {
  AuthProvider,
  IssuedToken,
  JwtClaims,
  TokenIssueContext,
} from "../auth-provider.interface";
import { ConfigService } from "@config/config.service";
import { VaultService } from "../vault.service";

const DEFAULT_TTL_SECONDS = 3_600;
const KEY_ID = "dev-key-1";

@Injectable()
export class DevJwtProvider implements AuthProvider, OnModuleInit {
  private readonly logger = new Logger(DevJwtProvider.name);

  private privateKey!: CryptoKey;
  private publicKey!: CryptoKey;
  private publicJwk!: JWK;
  private readonly issuer: string;

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly vault: VaultService,
  ) {
    this.issuer = config.devJwt.issuer;
  }

  async onModuleInit(): Promise<void> {
    if (this.config.authProvider !== "dev-jwt") {
      return;
    }

    if (this.vault?.isAvailable && this.config.vault.transitKey) {
      const pubKeyPem = await this.vault.getPublicKey();
      if (pubKeyPem) {
        this.publicKey = await importSPKI(pubKeyPem, "RS256");
        this.publicJwk = await exportJWK(this.publicKey);
        this.publicJwk.kid = KEY_ID;
        this.publicJwk.use = "sig";
        this.publicJwk.alg = "RS256";
        this.logger.log(
          "DevJwtProvider: Using Vault Transit engine for signing, local key for verification",
        );
        return;
      }
    }

    if (this.vault?.isAvailable) {
      const privatePem = await this.vault.readSecret(
        this.config.vault.secretPath,
        "jwt_private_key",
      );
      const publicPem = await this.vault.readSecret(
        this.config.vault.secretPath,
        "jwt_public_key",
      );
      if (privatePem && publicPem) {
        this.privateKey = await importPKCS8(privatePem, "RS256");
        this.publicKey = await importSPKI(publicPem, "RS256");
        this.publicJwk = await exportJWK(this.publicKey);
        this.publicJwk.kid = KEY_ID;
        this.publicJwk.use = "sig";
        this.publicJwk.alg = "RS256";
        this.logger.log("DevJwtProvider: Loaded RS256 key pair from Vault KV");
        return;
      }
    }

    const envPrivateKey = process.env.JWT_PRIVATE_KEY;
    const envPublicKey = process.env.JWT_PUBLIC_KEY;
    if (envPrivateKey && envPublicKey) {
      this.privateKey = await importPKCS8(
        envPrivateKey.replace(/\\n/g, "\n"),
        "RS256",
      );
      this.publicKey = await importSPKI(
        envPublicKey.replace(/\\n/g, "\n"),
        "RS256",
      );
      this.publicJwk = await exportJWK(this.publicKey);
      this.publicJwk.kid = KEY_ID;
      this.publicJwk.use = "sig";
      this.publicJwk.alg = "RS256";
      this.logger.log(
        "DevJwtProvider: Loaded RS256 key pair from JWT_PRIVATE_KEY / JWT_PUBLIC_KEY env vars",
      );
      return;
    }

    const { privateKey, publicKey } = await generateKeyPair("RS256");
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.publicJwk = await exportJWK(publicKey);
    this.publicJwk.kid = KEY_ID;
    this.publicJwk.use = "sig";
    this.publicJwk.alg = "RS256";

    this.logger.warn(
      "DevJwtProvider: Using ephemeral in-memory RS256 key pair. " +
        "All tokens will be invalidated on restart. " +
        "For persistent keys, set JWT_PRIVATE_KEY/JWT_PUBLIC_KEY or configure Vault. " +
        "DO NOT use in production. Use composite or internal-jwt.",
    );
  }

  // ---------------------------------------------------------------------------
  // AuthProvider implementation
  // ---------------------------------------------------------------------------

  async validateToken(token: string): Promise<JwtClaims> {
    const { payload } = await jwtVerify(token, this.publicKey, {
      issuer: this.issuer,
      algorithms: ["RS256"],
    });

    return {
      sub: payload.sub ?? "",
      tribeId: payload["tribeId"] as string | undefined,
      sourceServiceId: payload["sourceServiceId"] as string | undefined,
      environment: payload["environment"] as JwtClaims["environment"],
      permissions: (payload["permissions"] as string[] | undefined) ?? [],
      scopes: (payload["scopes"] as string[] | undefined) ?? [],
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
    const ttl = this.config.devJwt.tokenTtlSeconds ?? DEFAULT_TTL_SECONDS;
    const tribeId = context.tribeId ?? serviceId;
    const sourceServiceId = context.sourceServiceId ?? tribeId;
    const commonClaims = {
      tribeId,
      sourceServiceId,
      environment: context.environment,
      permissions,
      scopes,
    };

    const accessToken = await this.signJwt(commonClaims, serviceId, ttl);

    const refreshMultiplier = this.config.devJwt.refreshTtlMultiplier;
    const refreshToken = await this.signJwt(
      { ...commonClaims, type: "refresh" },
      serviceId,
      ttl * refreshMultiplier,
    );

    return { accessToken, refreshToken, expiresIn: ttl };
  }

  async refreshToken(refreshToken: string): Promise<IssuedToken> {
    const { payload } = await jwtVerify(refreshToken, this.publicKey, {
      issuer: this.issuer,
      algorithms: ["RS256"],
    });

    if (payload["type"] !== "refresh") {
      throw new Error("Provided token is not a refresh token");
    }

    const serviceId = payload.sub ?? "";
    const permissions = (payload["permissions"] as string[] | undefined) ?? [];
    const scopes = (payload["scopes"] as string[] | undefined) ?? [];

    return this.issueToken(serviceId, permissions, scopes, {
      tribeId: (payload["tribeId"] as string | undefined) ?? serviceId,
      sourceServiceId:
        (payload["sourceServiceId"] as string | undefined) ??
        (payload["tribeId"] as string | undefined) ??
        serviceId,
      environment: payload["environment"] as JwtClaims["environment"],
    });
  }

  getJwksJson(): Record<string, unknown> {
    return { keys: [this.publicJwk] };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async signJwt(
    claims: Record<string, unknown>,
    subject: string,
    ttlSeconds: number,
  ): Promise<string> {
    const builder = new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
      .setSubject(subject)
      .setIssuer(this.issuer)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`);

    if (!this.privateKey) {
      throw new Error(
        "DevJwtProvider: No private key available for signing. " +
          "Vault Transit key export is not supported - ensure JWT_PRIVATE_KEY is set or Vault KV has jwt_private_key.",
      );
    }

    return builder.sign(this.privateKey);
  }
}
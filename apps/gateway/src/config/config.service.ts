// =============================================================================
// Gateway configuration, read once from the environment. Fatal problems stop startup.
// =============================================================================

import { databaseConfigured } from "./database-configured";
import { Injectable, OnApplicationBootstrap } from "@nestjs/common";
import dotenv from "dotenv";

dotenv.config();

@Injectable()
export class ConfigService implements OnApplicationBootstrap {
  readonly port: number = parseInt(process.env.PORT || "3000", 10);
  readonly nodeEnv: string = process.env.NODE_ENV || "development";

  readonly cors = {
    origin: this.parseAllowedOrigins(),
    credentials: true,
  };

  readonly paymentWebhooks = {
    paymongoTestSecret: process.env.PAYMONGO_TEST_WEBHOOK_SECRET || "",
    paymongoLiveSecret: process.env.PAYMONGO_LIVE_WEBHOOK_SECRET || "",
  };

  readonly deliveryWebhooks = {
    resendWebhookSecret: process.env.RESEND_WEBHOOK_SECRET || "",
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || "",
    twilioStatusCallbackUrl: process.env.TWILIO_STATUS_CALLBACK_URL || "",
  };

  /** The credential the management console and operator scripts use for admin routes. */
  get platformAdminSecret(): string {
    return process.env.PLATFORM_ADMIN_SECRET || "";
  }

  /** Lowercased platform operator emails. They act as admin in every organization. */
  get platformAdminEmails(): string[] {
    return (process.env.PLATFORM_ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
  }

  readonly database = {
    enabled: databaseConfigured(),
    url: process.env.DATABASE_URL?.trim() || "",
  };

  readonly rateLimit = {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || "100", 10),
  };

  get isProduction(): boolean {
    return this.nodeEnv === "production";
  }

  onApplicationBootstrap() {
    const errors: string[] = [];

    if (this.isProduction && !this.platformAdminSecret) {
      errors.push("PLATFORM_ADMIN_SECRET must be set in production");
    }
    if (this.isProduction && [this.cors.origin].flat().includes("*")) {
      errors.push("ALLOWED_ORIGINS must list explicit origins in production; wildcard (*) is not allowed");
    }
    if (this.isProduction && !this.database.url) {
      errors.push("DATABASE_URL is required in production");
    }

    if (errors.length > 0) {
      const message = `[ConfigService] Fatal configuration errors:\n${errors.map((e) => `  - ${e}`).join("\n")}`;
      console.error(message);
      throw new Error(message);
    }
  }

  private parseAllowedOrigins(): string | string[] {
    const raw = process.env.ALLOWED_ORIGINS;
    if (!raw || raw.trim() === "*") return "*";
    const origins = raw.split(",").map((origin) => origin.trim()).filter(Boolean);
    return origins.length > 0 ? origins : "*";
  }
}

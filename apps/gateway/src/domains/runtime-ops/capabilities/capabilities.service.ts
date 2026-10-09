import { Injectable } from "@nestjs/common";
import { ConfigService } from "@config/config.service";

export type TribeSecretSource = "env-hash" | "gcp-secret-manager";

export type CapabilitiesSnapshot = {
  coreGateway: {
    enabled: true;
    authProvider: string;
    registrySource: "postgres" | "memory";
    registryBootstrapEnabled: boolean;
  };
  tribeSecrets: {
    source: TribeSecretSource;
  };
};

@Injectable()
export class CapabilitiesService {
  constructor(private readonly config: ConfigService) {}

  snapshot(): CapabilitiesSnapshot {
    return {
      coreGateway: {
        enabled: true,
        authProvider: this.config.authProvider,
        registrySource: this.config.database.enabled ? "postgres" : "memory",
        registryBootstrapEnabled: this.config.registryBootstrap.enabled,
      },
      tribeSecrets: {
        source: this.tribeSecretSource(),
      },
    };
  }

  private tribeSecretSource(): TribeSecretSource {
    return process.env.TRIBE_SECRET_SOURCE === "gcp-secret-manager"
      ? "gcp-secret-manager"
      : "env-hash";
  }
}

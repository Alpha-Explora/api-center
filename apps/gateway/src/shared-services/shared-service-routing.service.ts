import { Injectable, Optional } from "@nestjs/common";
import { ServiceUnavailableError } from "../shared/errors";
import type { ApicenterRuntimeEnvironment } from "../types";

export interface SharedServiceRouteResolution {
  sharedServiceId: string;
  environment: ApicenterRuntimeEnvironment;
  targetUrl: string;
}

@Injectable()
export class SharedServiceRoutingService {
  constructor(@Optional() private readonly env: NodeJS.ProcessEnv = process.env) {}

  resolve(
    sharedServiceId: string,
    environment: ApicenterRuntimeEnvironment,
  ): SharedServiceRouteResolution {
    const key = this.buildRouteKey(sharedServiceId, environment);
    const targetUrl = this.env[key]?.trim();
    if (!targetUrl) {
      throw new ServiceUnavailableError(
        `Missing shared-service route ${key} for ${sharedServiceId} ${environment}`,
      );
    }

    return { sharedServiceId, environment, targetUrl };
  }

  private buildRouteKey(
    sharedServiceId: string,
    environment: ApicenterRuntimeEnvironment,
  ): string {
    return `SHARED_SERVICE_ROUTE_${sharedServiceId}_${environment}`
      .toUpperCase()
      .replaceAll("-", "_");
  }
}
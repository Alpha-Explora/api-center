import { Injectable, Optional } from "@nestjs/common";
import { resolveSharedServiceRoute } from "@shared/proxy/shared-service-route";
import type { ApicenterRuntimeEnvironment } from "../../../types";

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
    const targetUrl = resolveSharedServiceRoute(sharedServiceId, environment, this.env);
    return { sharedServiceId, environment, targetUrl };
  }
}
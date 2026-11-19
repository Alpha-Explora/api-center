// /api/v1/shared/:capability/* — calls to the capability runtimes (email, SMS, OTP, geo, Google
// sign-in). Callers present an application key; ApplicationCapabilityProxy authenticates it,
// checks the grant, quota and budget, and forwards the call with a signed runtime context.
import { All, Controller, Param, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { ForbiddenError, UnauthorizedError } from "@shared/errors";
import { isControlPlaneBearer } from "@domains/control-plane/control-plane.types";
import type { AuthenticatedRequest } from "../../../types";
import { ApplicationCapabilityProxy } from "./application-capability-proxy";

@Controller("shared")
export class SharedServicesController {
  constructor(private readonly applicationProxy: ApplicationCapabilityProxy) {}

  @All(":capability/*path")
  async proxy(@Param("capability") capability: string, @Req() req: AuthenticatedRequest, @Res() res: Response) {
    const header = req.headers?.authorization;
    const bearer = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!bearer || !isControlPlaneBearer(bearer)) {
      throw new UnauthorizedError("An application key is required (Authorization: Bearer ak_…)");
    }
    if (capability.toLowerCase() === "gauth" && isAdminPath(req.path)) {
      throw new ForbiddenError("Google sign-in administration is not available through the capability proxy");
    }
    await this.applicationProxy.forward(capability.toLowerCase(), bearer, req, res);
  }
}

function isAdminPath(path: string): boolean {
  try {
    return /\/admin(?:\/|$)/i.test(decodeURIComponent(path));
  } catch {
    return true;
  }
}

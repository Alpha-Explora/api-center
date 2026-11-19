// Admits the platform operator: the management console's server and operator scripts, which send
// the platform secret. The console forwards the signed-in person separately (ConsoleActorGuard).
import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { ConfigService } from "@config/config.service";
import { UnauthorizedError } from "@shared/errors";

@Injectable()
export class ScopedAdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const presented = request.headers["x-platform-secret"];
    const expected = this.config.platformAdminSecret;
    if (typeof presented === "string" && expected && sameSecret(presented, expected)) return true;
    throw new UnauthorizedError("Admin access requires the platform credential");
  }
}

function sameSecret(presented: string, expected: string): boolean {
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

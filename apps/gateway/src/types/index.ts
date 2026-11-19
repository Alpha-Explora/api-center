// Request and environment types shared across the gateway.
import type { Request } from "express";
import type { ApplicationIdentity } from "../domains/control-plane/control-plane.types";

export const APICENTER_RUNTIME_ENVIRONMENTS = ["test", "live"] as const;
export type ApicenterRuntimeEnvironment = (typeof APICENTER_RUNTIME_ENVIRONMENTS)[number];

export function isApicenterRuntimeEnvironment(value: unknown): value is ApicenterRuntimeEnvironment {
  return typeof value === "string" && APICENTER_RUNTIME_ENVIRONMENTS.includes(value as ApicenterRuntimeEnvironment);
}

/** Express request with the gateway's tracing fields and, once authorized, the calling application. */
export interface AuthenticatedRequest extends Request {
  /** Correlation ID for tracing a request across services. */
  correlationId?: string;
  /** The environment a request targets when no application is known yet (webhooks). */
  diagnosticEnvironment?: ApicenterRuntimeEnvironment;
  /** The application whose key the control plane accepted for this request. */
  caller?: ApplicationIdentity;
}

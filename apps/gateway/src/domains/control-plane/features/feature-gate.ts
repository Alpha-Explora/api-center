import { HttpStatus } from "@nestjs/common";
import { AppError, ValidationError } from "@shared/errors";
import { hasPlatformAccess, type ConsoleActor } from "../console-access.policy";
import { FEATURE_CATALOG, type FeatureContext, type FeatureKey } from "./feature-catalog";

export function parseChange(key: FeatureKey, raw: unknown): Record<string, unknown> {
  const result = FEATURE_CATALOG[key].change.safeParse(raw);
  if (!result.success) throw new ValidationError("Invalid change for this feature");
  return result.data;
}

export function assertFeatureAllowed(actor: ConsoleActor, feature: FeatureKey, change: unknown, context: FeatureContext) {
  const definition = FEATURE_CATALOG[feature];
  const escalation = definition.needsApproval(parseChange(feature, change), context);
  if (hasPlatformAccess(actor)) return escalation && actor.kind === "member" ? "override" : "allowed";
  if (escalation || (definition.release === "coming_soon" && context.current.enabled !== true)) {
    throw new AppError(`${definition.title} needs approval from APICenter. Request it in the console.`,
      HttpStatus.FORBIDDEN, "FEATURE_APPROVAL_REQUIRED", true, { feature });
  }
  return "allowed";
}

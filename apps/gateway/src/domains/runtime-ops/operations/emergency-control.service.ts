import { Injectable } from "@nestjs/common";
import { z, ZodError } from "zod";
import { ValidationError } from "@shared/errors";

export type EmergencyMode =
  | "pause"
  | "isolate"
  | "quota_lockdown"
  | "observe_only";

export interface EmergencyControl {
  targetType: "tribe" | "service" | "shared-service";
  targetId: string;
  mode: EmergencyMode;
  reason: string;
  appliedBy: string;
  expiresAt?: string;
}

const emergencyControlSchema = z.object({
  targetType: z.enum(["tribe", "service", "shared-service"]),
  targetId: z.string().trim().min(1),
  mode: z.enum(["pause", "isolate", "quota_lockdown", "observe_only"]),
  reason: z.string().trim().min(1),
  appliedBy: z.string().trim().min(1),
  expiresAt: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: "expiresAt must be a valid date string",
    })
    .optional(),
});

const emergencyControlTargetSchema = z.object({
  targetType: z.enum(["tribe", "service", "shared-service"]),
  targetId: z.string().trim().min(1),
});

export function parseEmergencyControl(input: unknown): EmergencyControl {
  try {
    return emergencyControlSchema.parse(input);
  } catch (error) {
    throw toValidationError(error);
  }
}

export function parseEmergencyControlTarget(
  input: unknown,
): Pick<EmergencyControl, "targetType" | "targetId"> {
  try {
    return emergencyControlTargetSchema.parse(input);
  } catch (error) {
    throw toValidationError(error);
  }
}

function toValidationError(error: unknown) {
  if (error instanceof ZodError) {
    return new ValidationError(
      error.issues[0]?.message ?? "Invalid emergency control input",
    );
  }
  return new ValidationError("Invalid emergency control input");
}

@Injectable()
export class EmergencyControlService {
  private readonly controls = new Map<string, EmergencyControl>();

  apply(control: EmergencyControl) {
    this.controls.set(`${control.targetType}:${control.targetId}`, control);
    return control;
  }

  clear(targetType: EmergencyControl["targetType"], targetId: string) {
    this.controls.delete(`${targetType}:${targetId}`);
  }

  list() {
    return Array.from(this.controls.values());
  }

  evaluate(input: { ownerTribeId: string; serviceId: string }) {
    const control =
      this.controls.get(`tribe:${input.ownerTribeId}`) ??
      this.controls.get(`service:${input.serviceId}`) ??
      this.controls.get(`shared-service:${input.serviceId}`);

    if (!control) return { allowed: true };
    if (control.expiresAt && Date.parse(control.expiresAt) < Date.now()) {
      return { allowed: true };
    }

    return {
      allowed: control.mode === "observe_only",
      reason: control.reason,
      mode: control.mode,
    };
  }
}

import { Injectable } from "@nestjs/common";

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

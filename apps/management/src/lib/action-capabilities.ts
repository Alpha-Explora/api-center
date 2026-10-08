import {
  authorizeManagementAction,
  type ActionRisk,
} from "@/lib/action-policy";
import type {
  ManagementEnvironment,
  ManagementRole,
} from "@/lib/server/management-auth";

export type ManagementActionCapability = {
  actionId: string;
  label: string;
  risk: ActionRisk;
  category: "read" | "registry" | "secret" | "confluent" | "provider" | "deployment";
};

export const managementActionCapabilities = [
  {
    actionId: "registry.read",
    label: "Read registry, usage, audit, readiness, and settings",
    risk: "read",
    category: "read",
  },
  {
    actionId: "registry.write",
    label: "Create or update tribe/shared-service registry entries",
    risk: "state-write",
    category: "registry",
  },
  {
    actionId: "tribe-secret.provision",
    label: "Provision or rotate per-service secret hashes",
    risk: "provider-write",
    category: "secret",
  },
  {
    actionId: "confluent.topic.provision",
    label: "Create or verify Confluent topics",
    risk: "provider-write",
    category: "confluent",
  },
  {
    actionId: "confluent.s3-sink.update",
    label: "Add or remove topics from the managed S3 sink",
    risk: "provider-write",
    category: "confluent",
  },
  {
    actionId: "smoke.provider-impacting",
    label: "Run provider-impacting shared-service smoke checks",
    risk: "provider-write",
    category: "provider",
  },
  {
    actionId: "deployment.restart",
    label: "Restart API Center deployment",
    risk: "destructive",
    category: "deployment",
  },
] satisfies ManagementActionCapability[];

export function getManagementActionAvailability(input: {
  role: ManagementRole;
  environment: ManagementEnvironment;
}) {
  return managementActionCapabilities.map((capability) => {
    const decision = authorizeManagementAction({
      role: input.role,
      environment: input.environment,
      actionRisk: capability.risk,
    });

    return {
      ...capability,
      allowed: decision.allowed,
      blockedReason: decision.allowed ? undefined : decision.reason,
      confirmationRequired: decision.confirmationRequired,
      reasonRequired: decision.reasonRequired,
    };
  });
}

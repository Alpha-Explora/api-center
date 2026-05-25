import { Injectable } from "@nestjs/common";

export type EnvironmentPromotionGateId =
  | "health_check"
  | "smoke_test"
  | "owner_contact"
  | "quota_policy"
  | "plan_tier"
  | "event_topic"
  | "s3_sink"
  | "sdk_handoff"
  | "live_approval";

export type EnvironmentPromotionGate = {
  id: EnvironmentPromotionGateId;
  label: string;
  passed: boolean;
  evidence: string;
  proposedAction: string;
  required: boolean;
};

export type EnvironmentPromotionEvidence = {
  healthCheckPassed: boolean;
  smokeTestPassed: boolean;
  ownerPresent: boolean;
  contactPresent: boolean;
  quotaPolicyExists: boolean;
  planTierAssigned: boolean;
  eventTopicRequired: boolean;
  eventTopicExists: boolean;
  s3ExportRequired: boolean;
  s3SinkIncluded: boolean;
  sdkHandoffPacketExists: boolean;
  liveApprovalApproved: boolean;
};

export type EnvironmentPromotionDecision = {
  canPromote: boolean;
  blockedGateCount: number;
  gates: EnvironmentPromotionGate[];
};

@Injectable()
export class EnvironmentPromotionService {
  evaluate(evidence: EnvironmentPromotionEvidence): EnvironmentPromotionDecision {
    const gates: EnvironmentPromotionGate[] = [
      {
        id: "health_check",
        label: "Health check",
        passed: evidence.healthCheckPassed,
        evidence: evidence.healthCheckPassed
          ? "Latest health check passed."
          : "No passing health check evidence.",
        proposedAction: "Run the service health check from the service detail page.",
        required: true,
      },
      {
        id: "smoke_test",
        label: "Smoke test",
        passed: evidence.smokeTestPassed,
        evidence: evidence.smokeTestPassed
          ? "Smoke test evidence is present."
          : "No passing smoke test evidence.",
        proposedAction: "Run safe shared-service smoke checks with a tribe token.",
        required: true,
      },
      {
        id: "owner_contact",
        label: "Owner and contact",
        passed: evidence.ownerPresent && evidence.contactPresent,
        evidence:
          evidence.ownerPresent && evidence.contactPresent
            ? "Owner and contact are present."
            : "Owner team or contact is missing.",
        proposedAction: "Update the service manifest ownership fields.",
        required: true,
      },
      {
        id: "quota_policy",
        label: "Quota policy",
        passed: evidence.quotaPolicyExists,
        evidence: evidence.quotaPolicyExists
          ? "Active observe or enforce quota policy exists."
          : "No active quota policy exists.",
        proposedAction: "Create an observe-mode quota policy before live rollout.",
        required: true,
      },
      {
        id: "plan_tier",
        label: "Plan tier",
        passed: evidence.planTierAssigned,
        evidence: evidence.planTierAssigned
          ? "Active live plan assignment exists."
          : "No active live plan assignment exists.",
        proposedAction: "Assign a tribe plan tier for the live environment.",
        required: true,
      },
      {
        id: "event_topic",
        label: "Event topic",
        passed: !evidence.eventTopicRequired || evidence.eventTopicExists,
        evidence: !evidence.eventTopicRequired
          ? "Not required for this service."
          : evidence.eventTopicExists
            ? "Required event topic exists."
            : "Required event topic is missing.",
        proposedAction: "Provision the tribe event topic.",
        required: evidence.eventTopicRequired,
      },
      {
        id: "s3_sink",
        label: "S3 sink inclusion",
        passed: !evidence.s3ExportRequired || evidence.s3SinkIncluded,
        evidence: !evidence.s3ExportRequired
          ? "Not required for this service."
          : evidence.s3SinkIncluded
            ? "Required topic is included in the S3 sink."
            : "Required topic is not included in the S3 sink.",
        proposedAction: "Add the topic to the managed Confluent S3 Sink.",
        required: evidence.s3ExportRequired,
      },
      {
        id: "sdk_handoff",
        label: "SDK handoff packet",
        passed: evidence.sdkHandoffPacketExists,
        evidence: evidence.sdkHandoffPacketExists
          ? "SDK handoff packet evidence exists."
          : "SDK handoff packet evidence is missing.",
        proposedAction: "Generate and send the tribe handoff packet.",
        required: true,
      },
      {
        id: "live_approval",
        label: "Live approval",
        passed: evidence.liveApprovalApproved,
        evidence: evidence.liveApprovalApproved
          ? "Approved live registration request exists."
          : "No approved live registration request evidence.",
        proposedAction: "Create and approve a live registration request.",
        required: true,
      },
    ];

    const blockedGateCount = gates.filter(
      (gate) => gate.required && !gate.passed,
    ).length;

    return {
      canPromote: blockedGateCount === 0,
      blockedGateCount,
      gates,
    };
  }
}

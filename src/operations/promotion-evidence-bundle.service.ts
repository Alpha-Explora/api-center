import { Injectable } from "@nestjs/common";

export interface PromotionEvidenceSection {
  key: string;
  status: "pass" | "fail";
  data: unknown;
}

export interface PromotionEvidenceBundleInput {
  serviceId: string;
  health?: { status?: string } | null;
  quotaPolicy?: unknown;
  planAssignment?: unknown;
  approval?: unknown;
  smoke?: { status?: string } | null;
  manifest?: { status?: string } | null;
  pipeline?: {
    topicExists?: boolean;
    s3SinkIncludesTopic?: boolean;
    [key: string]: unknown;
  } | null;
}

@Injectable()
export class PromotionEvidenceBundleService {
  build(input: PromotionEvidenceBundleInput) {
    const sections: PromotionEvidenceSection[] = [
      {
        key: "health",
        status: input.health?.status === "up" ? "pass" : "fail",
        data: input.health,
      },
      {
        key: "quota",
        status: input.quotaPolicy ? "pass" : "fail",
        data: input.quotaPolicy,
      },
      {
        key: "plan",
        status: input.planAssignment ? "pass" : "fail",
        data: input.planAssignment,
      },
      {
        key: "approval",
        status:
          readEvidenceStatus(input.approval) === "approved" ? "pass" : "fail",
        data: input.approval,
      },
      {
        key: "smoke",
        status: input.smoke?.status === "passed" ? "pass" : "fail",
        data: input.smoke,
      },
      {
        key: "manifest",
        status: input.manifest?.status === "valid" ? "pass" : "fail",
        data: input.manifest,
      },
      {
        key: "pipeline",
        status:
          input.pipeline?.topicExists && input.pipeline?.s3SinkIncludesTopic
            ? "pass"
            : "fail",
        data: input.pipeline,
      },
    ];

    return {
      serviceId: input.serviceId,
      ready: sections.every((section) => section.status === "pass"),
      generatedAt: new Date().toISOString(),
      sections,
    };
  }
}

function readEvidenceStatus(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const status = (input as { status?: unknown }).status;
  return typeof status === "string" ? status : undefined;
}

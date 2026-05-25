import { Injectable } from "@nestjs/common";

export interface PromotionEvidenceSection {
  key: string;
  status: "pass" | "fail";
  data: unknown;
}

@Injectable()
export class PromotionEvidenceBundleService {
  build(input: Record<string, any>) {
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
        status: input.approval?.status === "approved" ? "pass" : "fail",
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

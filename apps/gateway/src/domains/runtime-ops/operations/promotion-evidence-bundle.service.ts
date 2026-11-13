import { Injectable } from "@nestjs/common";
import {
  ManagementSourceMetadata,
  volatileSourceMetadata,
} from "@shared/source-metadata";

export interface PromotionEvidenceSection {
  key: string;
  status: "pass" | "fail" | "not_applicable";
  data: unknown;
}

export interface PromotionEvidenceBundleInput {
  serviceId: string;
  sourceEnvironment?: string;
  targetEnvironment?: string;
  health?: { status?: string } | null;
  quotaPolicy?: unknown;
  planAssignment?: unknown;
  approval?: unknown;
  approvalRequired?: boolean;
  paymentRequired?: boolean;
  paymentApproval?: unknown;
  smoke?: { status?: string } | null;
  manifest?: { status?: string } | null;
  pipeline?: {
    topicExists?: boolean;
    s3SinkIncludesTopic?: boolean;
    [key: string]: unknown;
  } | null;
  pipelineRequired?: boolean;
}

export type PromotionEvidenceBundle = {
  serviceId: string;
  sourceEnvironment?: string;
  targetEnvironment?: string;
  ready: boolean;
  generatedAt: string;
  sections: PromotionEvidenceSection[];
};

@Injectable()
export class PromotionEvidenceBundleService {
  private readonly bundles = new Map<string, PromotionEvidenceBundle>();

  build(input: PromotionEvidenceBundleInput): PromotionEvidenceBundle {
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
          input.approvalRequired === false
            ? "not_applicable"
            : ["approved", "applied"].includes(
                  readEvidenceStatus(input.approval) ?? "",
                )
              ? "pass"
              : "fail",
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
          input.pipelineRequired === false
            ? "not_applicable"
            : input.pipeline?.topicExists && input.pipeline?.s3SinkIncludesTopic
              ? "pass"
              : "fail",
        data: input.pipeline,
      },
    ];

    if (input.paymentRequired)
      sections.push({
        key: "payment_access",
        status: ["approved", "applied"].includes(
          readEvidenceStatus(input.paymentApproval) ?? "",
        )
          ? "pass"
          : "fail",
        data: input.paymentApproval,
      });
    const bundle = {
      serviceId: input.serviceId,
      sourceEnvironment: input.sourceEnvironment,
      targetEnvironment: input.targetEnvironment,
      ready: sections.every(
        (section) =>
          section.status === "pass" || section.status === "not_applicable",
      ),
      generatedAt: new Date().toISOString(),
      sections,
    };
    this.bundles.set(this.bundleKey(input), bundle);
    return bundle;
  }

  private bundleKey(input: PromotionEvidenceBundleInput): string {
    return [
      input.serviceId,
      input.sourceEnvironment ?? "unknown-source",
      input.targetEnvironment ?? "unknown-target",
    ].join(":");
  }

  listBundles(): PromotionEvidenceBundle[] {
    return Array.from(this.bundles.values());
  }

  listBundlesWithSourceMetadata(): {
    data: PromotionEvidenceBundle[];
    sourceMetadata: ManagementSourceMetadata;
  } {
    return {
      data: this.listBundles(),
      sourceMetadata: this.getSourceMetadata(),
    };
  }

  getSourceMetadata(): ManagementSourceMetadata {
    return volatileSourceMetadata({
      sourceName: "promotion-evidence-memory-bundles",
      degradedReason:
        "Promotion evidence bundles are held in process memory and are unavailable after a process restart.",
    });
  }
}

function readEvidenceStatus(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const status = (input as { status?: unknown }).status;
  return typeof status === "string" ? status : undefined;
}

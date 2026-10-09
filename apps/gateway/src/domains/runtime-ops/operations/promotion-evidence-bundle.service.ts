import { Injectable } from "@nestjs/common";
import {
  ManagementSourceMetadata,
  volatileSourceMetadata,
} from "@shared/source-metadata";

export interface PromotionEvidenceSection {
  key: string;
  status: "pass" | "fail";
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
  smoke?: { status?: string } | null;
  manifest?: { status?: string } | null;
  pipeline?: {
    topicExists?: boolean;
    s3SinkIncludesTopic?: boolean;
    [key: string]: unknown;
  } | null;
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

    const bundle = {
      serviceId: input.serviceId,
      sourceEnvironment: input.sourceEnvironment,
      targetEnvironment: input.targetEnvironment,
      ready: sections.every((section) => section.status === "pass"),
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

import type { ServiceManifest, ServiceRegistryEntry } from "@/lib/schemas";

export type ManifestDiffItem = {
  field: string;
  before: string;
  after: string;
  warning?: string;
};

export function getManifestDiff(
  before: ServiceRegistryEntry,
  after: ServiceManifest,
) {
  const diffs: ManifestDiffItem[] = [];

  compareValue(diffs, "name", before.name, after.name);
  compareValue(diffs, "baseUrl", before.baseUrl, after.baseUrl, "Base URL changes reroute live gateway traffic.");
  compareValue(diffs, "healthCheck", before.healthCheck ?? "", after.healthCheck ?? "");
  compareValue(diffs, "ownerTeam", before.ownerTeam ?? "", after.ownerTeam ?? "");
  compareValue(diffs, "contact", before.contact ?? "", after.contact ?? "");
  compareValue(diffs, "serviceTier", before.serviceTier ?? "", after.serviceTier ?? "");
  compareValue(diffs, "version", before.version ?? "", after.version ?? "");
  compareArray(diffs, "requiredScopes", before.requiredScopes, after.requiredScopes, "Removing scopes can break existing consumers.");
  compareArray(diffs, "exposes", before.exposes, after.exposes);
  compareArray(diffs, "consumes", before.consumes, after.consumes, "Changing consumed services changes downstream access expectations.");
  compareArray(diffs, "tags", before.tags ?? [], after.tags ?? []);

  return diffs;
}

function compareValue(
  diffs: ManifestDiffItem[],
  field: string,
  before: string,
  after: string,
  warning?: string,
) {
  if (before !== after) {
    diffs.push({ field, before: before || "Unset", after: after || "Unset", warning });
  }
}

function compareArray(
  diffs: ManifestDiffItem[],
  field: string,
  before: string[],
  after: string[],
  warning?: string,
) {
  const beforeText = before.join(", ");
  const afterText = after.join(", ");

  if (beforeText !== afterText) {
    diffs.push({
      field,
      before: beforeText || "None",
      after: afterText || "None",
      warning,
    });
  }
}


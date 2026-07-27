export type TenantOAuthEnvironment = "test" | "prod";
export type TenantOAuthStatus =
  | "draft"
  | "gcp_project_ready"
  | "pending_google_setup"
  | "pending_verification"
  | "active"
  | "disabled"
  | "archived";

export interface TenantOAuthStateRecord {
  tenantSlug: string;
  environment: TenantOAuthEnvironment;
  status: TenantOAuthStatus;
  displayName: string;
  authProjectId: string;
  secretName: string;
  redirectUri: string;
  allowSharedOauthFallback: boolean;
  updatedAt: string;
  updatedBy?: string;
}

export interface TenantOAuthPreviewInput {
  product: "apicenter";
  tenantName: string;
  environment: TenantOAuthEnvironment;
  runtimeFolderId: string;
  billingAccountName: string;
  callbackUrl: string;
}

export interface TenantOAuthPreview {
  tenantSlug: string;
  tenantFolderDisplayName: string;
  projectId: string;
  secretName: string;
  parentFolderId: string;
  billingAccountName: string;
  labels: Record<string, string>;
  googleSetupChecklist: string[];
  gcloudCommands: string[];
}

export function normalizeTenantSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  if (!normalized || normalized.length > 63) {
    throw new Error("Tenant slug must be 1-63 lowercase URL-safe characters.");
  }

  return normalized;
}

export function isTenantOAuthStatus(value: string): value is TenantOAuthStatus {
  return [
    "draft",
    "gcp_project_ready",
    "pending_google_setup",
    "pending_verification",
    "active",
    "disabled",
    "archived",
  ].includes(value);
}

export function buildTenantOAuthPreview(input: TenantOAuthPreviewInput): TenantOAuthPreview {
  const tenantSlug = normalizeTenantSlug(input.tenantName);
  const productPrefix = input.product === "apicenter" ? "apic" : input.product;
  const projectId = buildAuthProjectId(productPrefix, tenantSlug, input.environment);
  const secretName = `apic-gauth-${tenantSlug}-${input.environment}`;
  const tenantFolderDisplayName = `tenant-${tenantSlug}`;
  const labels = {
    product: input.product,
    tenant: tenantSlug,
    tenancy: "dedicated",
    runtime_category: "auth",
    environment: input.environment,
    managed_by: "apicenter",
  };

  return {
    tenantSlug,
    tenantFolderDisplayName,
    projectId,
    secretName,
    parentFolderId: input.runtimeFolderId,
    billingAccountName: input.billingAccountName,
    labels,
    googleSetupChecklist: [
      `Open Google Auth Platform in project ${projectId}.`,
      `Set app name to ${input.tenantName}.`,
      "Add tenant logo, support email, homepage, privacy policy, and terms URLs.",
      `Create a Web OAuth client with redirect URI ${input.callbackUrl}.`,
      `Store the one-time client secret in central Secret Manager secret ${secretName}.`,
      "Mark the tenant OAuth record active only after authorize URL generation and token exchange have been verified.",
    ],
    gcloudCommands: [
      `gcloud resource-manager folders create --display-name=${tenantFolderDisplayName} --folder=${input.runtimeFolderId}`,
      `$tenantFolderId = gcloud resource-manager folders list --folder=${input.runtimeFolderId} --filter="displayName=${tenantFolderDisplayName}" --format="value(ID)"`,
      `gcloud projects create ${projectId} --name=${projectId} --folder=$tenantFolderId`,
      `gcloud billing projects link ${projectId} --billing-account=${input.billingAccountName}`,
      `gcloud services enable secretmanager.googleapis.com --project=${projectId}`,
      `gcloud projects update ${projectId} --update-labels=${Object.entries(labels)
        .map(([key, labelValue]) => `${key}=${labelValue}`)
        .join(",")}`,
    ],
  };
}

function buildAuthProjectId(
  productPrefix: string,
  tenantSlug: string,
  environment: TenantOAuthEnvironment,
): string {
  const prefix = `ae-${productPrefix}-auth-`;
  const suffix = `-${environment}`;
  const maxTenantLength = 30 - prefix.length - suffix.length;
  const projectTenantSlug = tenantSlug.slice(0, maxTenantLength).replace(/-+$/g, "") || "tenant";

  return `${prefix}${projectTenantSlug}${suffix}`;
}

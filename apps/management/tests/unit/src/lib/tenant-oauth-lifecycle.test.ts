import { describe, expect, it } from "vitest";
import {
  buildTenantOAuthPreview,
  normalizeTenantSlug,
} from "../../../../src/lib/tenant-oauth-lifecycle";

describe("tenant OAuth lifecycle", () => {
  it("normalizes tenant slugs for GCP folder and project names", () => {
    expect(normalizeTenantSlug("Campus One!")).toBe("campus-one");
    expect(normalizeTenantSlug("  John   Doe  ")).toBe("john-doe");
  });

  it("builds a deterministic APIC tenant auth project preview", () => {
    const preview = buildTenantOAuthPreview({
      product: "apicenter",
      tenantName: "Campus One",
      environment: "prod",
      runtimeFolderId: "395026742173",
      billingAccountName: "billingAccounts/01C34F-9DCD67-86DB82",
      callbackUrl: "https://api-center.itsandbox.site/api/v1/shared/gauth/oauth/callback",
    });

    expect(preview.tenantSlug).toBe("campus-one");
    expect(preview.tenantFolderDisplayName).toBe("tenant-campus-one");
    expect(preview.projectId).toBe("ae-apic-auth-campus-one-prod");
    expect(preview.secretName).toBe("apic-gauth-campus-one-prod");
    expect(preview.labels).toEqual({
      product: "apicenter",
      tenant: "campus-one",
      tenancy: "dedicated",
      runtime_category: "auth",
      environment: "prod",
      managed_by: "apicenter",
    });
    expect(preview.googleSetupChecklist[0]).toContain("Google Auth Platform");
    expect(preview.gcloudCommands).toContain(
      "$tenantFolderId = gcloud resource-manager folders list --folder=395026742173 --filter=\"displayName=tenant-campus-one\" --format=\"value(ID)\"",
    );
  });

  it("keeps generated GCP project IDs within the 30-character limit", () => {
    const preview = buildTenantOAuthPreview({
      product: "apicenter",
      tenantName: "A Very Long Tenant Name For Project Limits",
      environment: "prod",
      runtimeFolderId: "395026742173",
      billingAccountName: "billingAccounts/01C34F-9DCD67-86DB82",
      callbackUrl: "https://api-center.itsandbox.site/api/v1/shared/gauth/oauth/callback",
    });

    expect(preview.tenantSlug).toBe("a-very-long-tenant-name-for-project-limits");
    expect(preview.projectId.length).toBeLessThanOrEqual(30);
    expect(preview.projectId).toMatch(/^ae-apic-auth-[a-z0-9-]+-prod$/);
    expect(preview.gcloudCommands).toContain(
      `gcloud projects create ${preview.projectId} --name=${preview.projectId} --folder=$tenantFolderId`,
    );
  });
});

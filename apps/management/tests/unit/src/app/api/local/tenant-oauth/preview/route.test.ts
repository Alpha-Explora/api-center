import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/local/tenant-oauth/preview/route";

describe("POST /api/local/tenant-oauth/preview", () => {
  it("returns a copy-ready tenant OAuth preview", async () => {
    const response = await POST(
      new Request("http://localhost/api/local/tenant-oauth/preview", {
        method: "POST",
        body: JSON.stringify({
          tenantName: "Campus One",
          environment: "prod",
          runtimeFolderId: "395026742173",
          billingAccountName: "billingAccounts/01C34F-9DCD67-86DB82",
        }),
      }),
    );

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.tenantSlug).toBe("campus-one");
    expect(body.data.projectId).toBe("ae-apic-auth-campus-one-prod");
    expect(body.data.secretName).toBe("apic-gauth-campus-one-prod");
  });
});

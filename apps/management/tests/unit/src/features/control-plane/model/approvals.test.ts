import { describe, expect, it } from "vitest";
import {
  approvalHref,
  approvalItemSchema,
  awaitingYou,
  type ApprovalItem,
} from "@/features/control-plane/model/approvals";

const base = {
  organizationId: "6f1c1d1e-0000-4000-8000-000000000001",
  organizationName: "Serbizio",
  projectId: "prj_owner",
  projectName: "Billing",
  summary: "…",
  requestedBy: "dana@example.test",
  requestedAt: "2026-11-20T01:00:00.000Z",
  requestedByYou: false,
};
const activation: ApprovalItem = {
  ...base,
  id: "apr_1",
  kind: "live_activation",
  reason: "Launch",
};
const access: ApprovalItem = {
  ...base,
  id: "acr_1",
  kind: "api_access",
  apiId: "api_x",
  apiName: "Invoices",
  action: "invoices.read",
  environmentKind: "test",
  consumerProjectId: "prj_consumer",
  consumerProjectName: "Storefront",
  consumerApplicationId: "app_1",
  consumerApplicationName: "Web",
};

describe("approvals", () => {
  it("links each item to where it is decided", () => {
    expect(approvalHref(activation)).toBe("/projects/prj_owner/live");
    expect(approvalHref(access)).toBe("/projects/prj_owner/test/apis/api_x");
  });

  it("counts only items someone else requested", () => {
    expect(awaitingYou(undefined)).toBe(0);
    expect(awaitingYou([activation, { ...access, requestedByYou: true }])).toBe(
      1,
    );
  });

  it("parses both kinds and refuses unknown ones", () => {
    expect(approvalItemSchema.parse(access)).toEqual(access);
    expect(() =>
      approvalItemSchema.parse({ ...activation, kind: "other" }),
    ).toThrow();
  });
});

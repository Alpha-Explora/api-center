import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { ApprovalRequestService } from "../../../../apps/gateway/src/domains/governance/approvals/approval-request.service";
import type { ConsoleRequest } from "../../../../apps/gateway/src/domains/control-plane/console-actor.guard";
import type { ConsoleActor } from "../../../../apps/gateway/src/domains/control-plane/console-access.policy";
import { ConsoleAccessService } from "../../../../apps/gateway/src/domains/control-plane/console-access.service";
import { ApprovalsQueueController } from "../../../../apps/gateway/src/domains/control-plane/approvals-queue.controller";
import { ApprovalsQueueService } from "../../../../apps/gateway/src/domains/control-plane/approvals-queue.service";
import { buildApprovalItems } from "../../../../apps/gateway/src/domains/control-plane/approvals-queue";
import { createFakeControlPlanePrisma, type FakeControlPlanePrisma } from "./fake-control-plane-prisma";

const ORG = "6f1c1d1e-0000-4000-8000-0000000000b1";
const OTHER = "6f1c1d1e-0000-4000-8000-0000000000b2";
const id = (prefix: string, n: number) => `${prefix}_${String(n).padStart(24, "0")}`;
const SHOP = id("prj", 1);
const BILLING = id("prj", 2);
const ELSEWHERE = id("prj", 3);
const API = id("api", 1);
const APP = id("app", 1);

const member = (email: string, platformAdmin = false): ConsoleActor => ({ kind: "member", email, subject: `s-${email}`, platformAdmin });
const req = (actor: ConsoleActor) => ({ consoleActor: actor }) as ConsoleRequest;

let prisma: FakeControlPlanePrisma;
let listPending: jest.Mock;
let controller: ApprovalsQueueController;

beforeAll(() => {
  process.env.DATABASE_ENABLED = "true";
});

beforeEach(() => {
  prisma = createFakeControlPlanePrisma();
  prisma.organization.rows.push({ id: ORG, name: "Serbizio", status: "active" }, { id: OTHER, name: "Elsewhere", status: "active" });
  prisma.cpProject.rows.push(
    { id: SHOP, organizationId: ORG, slug: "shop", name: "Shop" },
    { id: BILLING, organizationId: ORG, slug: "billing", name: "Billing" },
    { id: ELSEWHERE, organizationId: OTHER, slug: "else", name: "Else" },
  );
  for (const [email, role] of [
    ["owner@example.test", "owner"],
    ["lead@example.test", "developer"],
    ["viewer@example.test", "viewer"],
  ]) {
    prisma.organizationMember.rows.push({ organizationId: ORG, email, role, status: "active", subject: null });
  }
  // lead@ administers Billing only.
  prisma.cpProjectRoleAssignment.rows.push({ id: id("pra", 1), organizationId: ORG, projectId: BILLING, memberEmail: "lead@example.test", role: "admin" });
  // Billing publishes an API that Shop's application asked for.
  prisma.cpPublishedApi.rows.push({ id: API, organizationId: ORG, projectId: BILLING, environmentId: "env_b", environmentKind: "test", slug: "invoices", name: "Invoices" });
  prisma.cpApplication.rows.push({ id: APP, organizationId: ORG, projectId: SHOP, environmentId: "env_s", slug: "storefront", name: "Storefront" });
  prisma.cpApiAccessRequest.rows.push(
    {
      id: id("acr", 1),
      organizationId: ORG,
      apiId: API,
      action: "invoices:read",
      consumerProjectId: SHOP,
      consumerEnvironmentId: "env_s",
      consumerApplicationId: APP,
      status: "pending",
      requestedBy: "owner@example.test",
      createdAt: new Date("2026-11-19T10:00:00Z"),
    },
    {
      id: id("acr", 2),
      organizationId: ORG,
      apiId: API,
      action: "invoices:write",
      consumerProjectId: SHOP,
      consumerEnvironmentId: "env_s",
      consumerApplicationId: APP,
      status: "approved",
      requestedBy: "owner@example.test",
      createdAt: new Date("2026-11-18T10:00:00Z"),
    },
  );
  const activations = [
    { id: "apr-shop", actionType: "environment.activate_live", targetId: SHOP, status: "pending", reason: "Launch", requestedBy: "lead@example.test", createdAt: new Date("2026-11-20T08:00:00Z") },
    { id: "apr-else", actionType: "environment.activate_live", targetId: ELSEWHERE, status: "pending", reason: "Go", requestedBy: "x@else.test", createdAt: new Date("2026-11-17T08:00:00Z") },
  ];
  listPending = jest.fn(async (_action: string, targetIds?: string[]) =>
    activations.filter((row) => !targetIds || targetIds.includes(row.targetId)),
  );
  const db = prisma as unknown as PrismaService;
  const queue = new ApprovalsQueueService(db, { listPending } as unknown as ApprovalRequestService);
  controller = new ApprovalsQueueController(queue, new ConsoleAccessService(db));
});

describe("approvals queue", () => {
  it("lists every organization's pending items, newest first, for platform operators", async () => {
    const { data } = await controller.all(req(member("ops@example.test", true)));
    expect(data.map((item) => [item.kind, item.id, item.organizationName, item.projectName])).toEqual([
      ["live_activation", "apr-shop", "Serbizio", "Shop"],
      ["api_access", id("acr", 1), "Serbizio", "Billing"],
      ["live_activation", "apr-else", "Elsewhere", "Else"],
    ]);
    expect(listPending).toHaveBeenCalledWith("environment.activate_live", undefined);
    expect(prisma.tenantSettings).toContain("platform");
  });

  it("refuses the cross-organization queue to organization members", async () => {
    await expect(controller.all(req(member("owner@example.test")))).rejects.toMatchObject({ status: 403 });
  });

  it("shows owners their organization's items only, marking their own requests", async () => {
    const { data } = await controller.forOrganization(ORG, req(member("owner@example.test")));
    expect(data.map((item) => item.id)).toEqual(["apr-shop", id("acr", 1)]);
    expect(data.find((item) => item.kind === "api_access")).toMatchObject({
      apiName: "Invoices",
      action: "invoices:read",
      consumerProjectName: "Shop",
      consumerApplicationName: "Storefront",
      summary: "Storefront (Shop) wants invoices:read on Invoices",
      requestedByYou: true,
    });
    expect(listPending).toHaveBeenCalledWith("environment.activate_live", [SHOP, BILLING]);
  });

  it("shows a project admin only what their projects decide", async () => {
    // lead@ administers Billing (the API's project) but not Shop, whose live activation they requested.
    const { data } = await controller.forOrganization(ORG, req(member("lead@example.test")));
    expect(data.map((item) => item.id)).toEqual([id("acr", 1)]);
    expect((await controller.forOrganization(ORG, req(member("viewer@example.test")))).data).toEqual([]);
  });

  it("hides the organization from non-members", async () => {
    await expect(controller.forOrganization(ORG, req(member("stranger@example.test")))).rejects.toMatchObject({ status: 404 });
    await expect(controller.forOrganization("not-a-uuid", req(member("owner@example.test")))).rejects.toMatchObject({ status: 400 });
  });
});

describe("buildApprovalItems", () => {
  it("drops requests whose project or API no longer exists", () => {
    const items = buildApprovalItems({
      organizations: [],
      projects: [],
      activations: [{ id: "a", targetId: "gone", reason: "r", requestedBy: "x", createdAt: new Date() }],
      accessRequests: [
        { id: "r", organizationId: ORG, apiId: "missing", action: "x:y", consumerProjectId: "p", consumerApplicationId: "a", requestedBy: "x", createdAt: new Date() },
      ],
      apis: [],
      applications: [],
    });
    expect(items).toEqual([]);
  });
});

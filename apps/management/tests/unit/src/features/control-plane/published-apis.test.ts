import { describe, expect, it } from "vitest";
import {
  actorLabelOf,
  apiActions,
  catalogMatches,
  hasOperationErrors,
  isValidOperationPath,
  operationPathError,
  operationsChanged,
  sortAccessRequests,
  toOperationsBody,
  upstreamHost,
  upstreamUrlError,
  validateOperations,
  type AccessRequest,
} from "@/features/control-plane/model/published-apis";

const row = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, action: string, description = "") => ({ method, path, action, description });

describe("operation paths", () => {
  it("accepts the root, literal segments and {name} placeholders", () => {
    for (const path of ["/", "/orders", "/orders/{orderId}", "/orders/{orderId}/items/", "/v1.2/~me/a-b_c"]) expect(isValidOperationPath(path), path).toBe(true);
  });

  it("rejects relative paths, bad placeholders, dot segments and empty segments", () => {
    for (const path of ["", "orders", "/orders//items", "/{1st}", "/{order-id}", "/orders/{id", "/..", "/orders/.", "/a b", "/a?b=1"]) {
      expect(isValidOperationPath(path), path).toBe(false);
    }
  });
});

describe("operationPathError", () => {
  it("names what is wrong with the path", () => {
    expect(operationPathError("/orders/{orderId}")).toBeUndefined();
    expect(operationPathError("orders")).toBe("Start the path with /.");
    expect(operationPathError("/orders//items")).toMatch(/empty segment/);
    expect(operationPathError("/orders/..")).toMatch(/dots/);
    expect(operationPathError("/refunds/{refund-id}")).toMatch(/^\{refund-id\} is not a placeholder/);
    expect(operationPathError("/orders/id-{id}")).toMatch(/^id-\{id\} is not a placeholder/);
    expect(operationPathError("/a b")).toMatch(/letters, digits/);
  });
});

describe("validateOperations", () => {
  it("passes well-formed rows", () => {
    const result = validateOperations([row("GET", "/orders", "orders:read"), row("POST", "/orders", "orders:write")]);
    expect(hasOperationErrors(result)).toBe(false);
  });

  it("rejects a second row with the same METHOD and path, pointing at the first", () => {
    const result = validateOperations([row("GET", "/orders", "orders:read"), row("POST", "/orders", "orders:write"), row("GET", " /orders", "orders:list")]);
    expect(result.rows[0]).toBeUndefined();
    expect(result.rows[1]).toBeUndefined();
    expect(result.rows[2]?.path).toBe("GET /orders is already declared in row 1.");
  });

  it("checks the action format", () => {
    expect(validateOperations([row("GET", "/a", "orders")]).rows[0]?.action).toMatch(/orders:read/);
    expect(validateOperations([row("GET", "/a", "Orders:Read")]).rows[0]?.action).toBeDefined();
    expect(validateOperations([row("GET", "/a", "orders:")]).rows[0]?.action).toBeDefined();
    expect(validateOperations([row("GET", "/a", "billing:invoices:read")]).rows[0]).toBeUndefined();
    expect(validateOperations([row("GET", "/a", `a:${"b".repeat(63)}`)]).rows[0]?.action).toMatch(/64/);
  });

  it("requires path and action, limits descriptions, and needs one to 200 rows", () => {
    expect(validateOperations([row("GET", "", "")]).rows[0]).toEqual({ path: "Enter a path.", action: "Enter an action." });
    expect(validateOperations([row("GET", "/a", "a:b", "x".repeat(301))]).rows[0]?.description).toBeDefined();
    expect(validateOperations([]).form).toBe("Add at least one operation.");
    const many = Array.from({ length: 201 }, (_, index) => row("GET", `/r${index}`, "a:b"));
    expect(validateOperations(many).form).toMatch(/200/);
  });
});

describe("toOperationsBody", () => {
  it("trims values and leaves out empty descriptions, since the gateway rejects unknown or empty keys strictly", () => {
    expect(toOperationsBody([row("GET", " /orders ", " orders:read "), row("DELETE", "/orders/{id}", "orders:write", " Cancel an order ")])).toEqual([
      { method: "GET", path: "/orders", action: "orders:read" },
      { method: "DELETE", path: "/orders/{id}", action: "orders:write", description: "Cancel an order" },
    ]);
  });
});

describe("operationsChanged", () => {
  const current = [
    { method: "GET", path: "/orders", action: "orders:read", description: null },
    { method: "POST", path: "/orders", action: "orders:write", description: "Create" },
  ];

  it("ignores order and treats a null description as empty", () => {
    expect(operationsChanged(current, [row("POST", "/orders", "orders:write", "Create"), row("GET", "/orders", "orders:read")])).toBe(false);
  });

  it("notices an edited, added or removed row", () => {
    expect(operationsChanged(current, [row("GET", "/orders", "orders:list"), row("POST", "/orders", "orders:write", "Create")])).toBe(true);
    expect(operationsChanged(current, [row("GET", "/orders", "orders:read")])).toBe(true);
  });
});

describe("upstreamUrlError", () => {
  it("accepts a public https URL", () => {
    expect(upstreamUrlError("https://orders.example.com/v1")).toBeUndefined();
  });

  it("refuses http, credentials, internal hosts and private addresses", () => {
    expect(upstreamUrlError("")).toBeDefined();
    expect(upstreamUrlError("orders.example.com")).toMatch(/full URL/);
    expect(upstreamUrlError("http://orders.example.com")).toMatch(/https/);
    expect(upstreamUrlError("https://user:pw@orders.example.com")).toMatch(/credentials/);
    for (const host of ["localhost", "metadata.google.internal", "printer.local", "10.0.0.4", "192.168.1.1", "169.254.169.254", "127.0.0.1", "[::1]"]) {
      expect(upstreamUrlError(`https://${host}/`), host).toBeDefined();
    }
  });

  it("refuses private IPv6 literals, including IPv4-mapped ones the URL parser rewrites to hex", () => {
    for (const host of ["[::]", "[fd00::1]", "[fe80::1]", "[::ffff:10.0.0.1]", "[::ffff:169.254.169.254]"]) {
      expect(upstreamUrlError(`https://${host}/`), host).toMatch(/publicly routable/);
    }
    expect(upstreamUrlError("https://[2606:4700::1]/")).toBeUndefined();
    expect(upstreamUrlError("https://[::ffff:8.8.8.8]/")).toBeUndefined();
  });

  it("shows the host of an upstream, or the raw value when it is not a URL", () => {
    expect(upstreamHost("https://orders.example.com:8443/v1")).toBe("orders.example.com:8443");
    expect(upstreamHost("not a url")).toBe("not a url");
  });
});

describe("access requests", () => {
  const request = (id: string, status: string, createdAt: string, decidedAt: string | null = null): AccessRequest => ({
    id,
    apiId: "api_1",
    action: "orders:read",
    consumerProjectId: "prj_2",
    consumerEnvironmentId: "env_2",
    consumerApplicationId: "app_2",
    status,
    requestedBy: "jun@example.test",
    decidedBy: decidedAt ? "maria@example.test" : null,
    decidedAt,
    grantId: null,
    createdAt,
  });

  it("puts the longest-waiting pending request first and the latest decision first", () => {
    const { pending, decided } = sortAccessRequests([
      request("acr_new", "pending", "2026-11-19T10:00:00Z"),
      request("acr_old", "pending", "2026-11-18T10:00:00Z"),
      request("acr_a", "approved", "2026-11-10T10:00:00Z", "2026-11-11T10:00:00Z"),
      request("acr_b", "rejected", "2026-11-12T10:00:00Z", "2026-11-13T10:00:00Z"),
    ]);
    expect(pending.map((entry) => entry.id)).toEqual(["acr_old", "acr_new"]);
    expect(decided.map((entry) => entry.id)).toEqual(["acr_b", "acr_a"]);
  });

  it("labels the person the way the gateway records requesters", () => {
    expect(actorLabelOf({ actor: { kind: "member", email: "jun@example.test" }, platformAccess: false, organizationRole: "developer", projectRoles: {} })).toBe("jun@example.test");
    expect(actorLabelOf({ actor: { kind: "platform" }, platformAccess: true, organizationRole: "owner", projectRoles: {} })).toBe("platform");
    expect(actorLabelOf(undefined)).toBeUndefined();
  });
});

describe("catalog", () => {
  const api = {
    id: "api_1",
    projectId: "prj_1",
    slug: "orders",
    name: "Orders API",
    environmentKind: "test" as const,
    operations: [
      { method: "GET", path: "/orders/{id}", action: "orders:read", description: null },
      { method: "POST", path: "/orders", action: "orders:write" },
      { method: "GET", path: "/orders", action: "orders:read" },
    ],
  };

  it("lists each action once", () => {
    expect(apiActions(api)).toEqual(["orders:read", "orders:write"]);
  });

  it("matches every word against name, project, paths and actions", () => {
    expect(catalogMatches(api, "orders write")).toBe(true);
    expect(catalogMatches(api, "serbizio", "Serbizio")).toBe(true);
    expect(catalogMatches(api, "refunds")).toBe(false);
    expect(catalogMatches(api, "  ")).toBe(true);
  });
});

type SmokeConfig = {
  baseUrl: string;
  adminSecret: string;
  tribeId: string;
  token: string;
  targetServiceId: string;
  smokePath: string;
};

type JsonBody = Record<string, unknown> | undefined;

function readConfig(): SmokeConfig {
  const baseUrl = process.env.APICENTER_SMOKE_BASE_URL?.replace(/\/$/, "");
  const adminSecret = process.env.API_CENTER_PLATFORM_ADMIN_SECRET;
  const tribeId = process.env.APICENTER_SMOKE_TRIBE_ID ?? "smoke-tribe";
  const token = process.env.APICENTER_SMOKE_TRIBE_TOKEN;
  const targetServiceId =
    process.env.APICENTER_SMOKE_TARGET_SERVICE_ID ?? "payment-service";
  const smokePath = process.env.APICENTER_SMOKE_PATH ?? "/health";

  if (!baseUrl || !adminSecret || !token) {
    throw new Error(
      "Missing APICENTER_SMOKE_BASE_URL, API_CENTER_PLATFORM_ADMIN_SECRET, or APICENTER_SMOKE_TRIBE_TOKEN",
    );
  }

  return { baseUrl, adminSecret, tribeId, token, targetServiceId, smokePath };
}

async function request(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: JsonBody },
) {
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const bodyText = await response.text();
  return { response, bodyText, body: parseJson(bodyText) };
}

async function main() {
  const config = readConfig();
  const approvalRequestId = await createApprovedQuotaApproval(config);
  let policyId: string | undefined;

  try {
    const policyResult = await adminRequest(config, "/api/v1/quotas/policies", {
      method: "POST",
      body: {
        ownerTribeId: config.tribeId,
        scope: "shared",
        targetServiceId: config.targetServiceId,
        windowSeconds: 60,
        maxRequests: 2,
        mode: "enforce",
        reason: "CI quota smoke",
        approvalRequestId,
      },
    });
    policyId = readResponseId(policyResult.body, "quota policy");

    const statuses: number[] = [];
    const codes: Array<string | undefined> = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await request(
        `${config.baseUrl}/api/v1/shared/${encodeURIComponent(
          config.targetServiceId,
        )}${config.smokePath}`,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${config.token}`,
            "x-tribe-id": config.tribeId,
          },
        },
      );
      statuses.push(result.response.status);
      codes.push(readErrorCode(result.body));
    }

    if (
      statuses[0] !== 200 ||
      statuses[1] !== 200 ||
      statuses[2] !== 429 ||
      codes[2] !== "TRIBE_API_QUOTA_EXCEEDED"
    ) {
      throw new Error(
        `Expected 200,200,429 quota behavior; received ${statuses.join(
          ",",
        )} with codes ${codes.map((code) => code ?? "none").join(",")}`,
      );
    }
  } finally {
    if (policyId) {
      await adminRequest(
        config,
        `/api/v1/quotas/policies/${encodeURIComponent(policyId)}`,
        { method: "DELETE" },
      );
    }
  }
}

async function createApprovedQuotaApproval(config: SmokeConfig) {
  const approval = await adminRequest(config, "/api/v1/approvals/requests", {
    method: "POST",
    body: {
      actionType: "quota.enforce",
      targetId: config.tribeId,
      targetEnvironment: "live",
      riskLevel: "medium",
      reason: "CI quota smoke approval",
      before: { mode: "observe", ownerTribeId: config.tribeId },
      after: {
        mode: "enforce",
        ownerTribeId: config.tribeId,
        scope: "shared",
        targetServiceId: config.targetServiceId,
        windowSeconds: 60,
        maxRequests: 2,
      },
    },
  });
  const approvalRequestId = readResponseId(approval.body, "approval request");

  await adminRequest(
    config,
    `/api/v1/approvals/requests/${encodeURIComponent(
      approvalRequestId,
    )}/approve`,
    { method: "POST" },
  );

  return approvalRequestId;
}

async function adminRequest(
  config: SmokeConfig,
  path: string,
  init: { method: string; body?: JsonBody },
) {
  const result = await request(`${config.baseUrl}${path}`, {
    method: init.method,
    headers: {
      "content-type": "application/json",
      "x-platform-secret": config.adminSecret,
    },
    body: init.body,
  });

  if (!result.response.ok) {
    throw new Error(
      `Admin request ${init.method} ${path} failed: ${result.response.status} ${result.bodyText}`,
    );
  }

  return result;
}

function readResponseId(body: unknown, label: string) {
  const id = (body as { data?: { id?: unknown } } | undefined)?.data?.id;
  if (typeof id !== "string" || !id) {
    throw new Error(`${label} response did not include data.id`);
  }
  return id;
}

function readErrorCode(body: unknown): string | undefined {
  return (body as { error?: { code?: unknown } } | undefined)?.error?.code as
    | string
    | undefined;
}

function parseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

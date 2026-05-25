#!/usr/bin/env node

const baseUrl = env("API_CENTER_BASE_URL", "http://localhost:3000").replace(
  /\/$/,
  "",
);
const adminSecret = requiredEnv("API_CENTER_PLATFORM_ADMIN_SECRET");
const ownerTribeId = env("APICENTER_QUOTA_SMOKE_TRIBE_ID", "quota-smoke");
const targetServiceId = env(
  "APICENTER_QUOTA_SMOKE_TARGET_SERVICE_ID",
  "payment-service",
);
const token = process.env.APICENTER_QUOTA_SMOKE_TOKEN;
const tribeSecret = process.env.APICENTER_QUOTA_SMOKE_SECRET;
const smokePath = env("APICENTER_QUOTA_SMOKE_PATH", "/health");

async function main() {
  const bearerToken = token ?? (await requestSmokeToken());
  let policyId;

  try {
    const approvalRequestId = await createApprovedQuotaApproval();
    const policy = await adminRequest("/api/v1/quotas/policies", {
      method: "POST",
      body: {
        ownerTribeId,
        scope: "shared",
        targetServiceId,
        windowSeconds: 60,
        maxRequests: 2,
        mode: "enforce",
        reason: "Automated tribe quota smoke test",
        approvalRequestId,
      },
    });
    policyId = policy.data.id;
    console.log(`Created quota policy ${policyId} for ${ownerTribeId}.`);

    const attempts = [];
    for (let index = 1; index <= 3; index += 1) {
      const response = await callSharedService(bearerToken);
      attempts.push(response);
      console.log(
        `Attempt ${index}: HTTP ${response.status}${response.code ? ` ${response.code}` : ""}`,
      );
    }

    for (const [index, response] of attempts.slice(0, 2).entries()) {
      if (response.status === 429) {
        throw new Error(
          `Attempt ${index + 1} was rate limited before quota was exceeded.`,
        );
      }
    }

    const third = attempts[2];
    if (third.status !== 429 || third.code !== "TRIBE_API_QUOTA_EXCEEDED") {
      throw new Error(
        `Expected third call to return TRIBE_API_QUOTA_EXCEEDED, got HTTP ${third.status} ${third.code ?? ""}`.trim(),
      );
    }

    console.log("Quota smoke passed: third call was blocked with HTTP 429.");
  } finally {
    if (policyId) {
      await adminRequest(
        `/api/v1/quotas/policies/${encodeURIComponent(policyId)}`,
        {
          method: "DELETE",
        },
      );
      console.log(`Disabled quota policy ${policyId}.`);
    }
  }
}

async function createApprovedQuotaApproval() {
  const approval = await adminRequest("/api/v1/approvals/requests", {
    method: "POST",
    body: {
      actionType: "quota.enforce",
      targetId: ownerTribeId,
      targetEnvironment: "live",
      before: {
        mode: "observe",
        ownerTribeId,
        scope: "shared",
        targetServiceId,
      },
      after: {
        mode: "enforce",
        ownerTribeId,
        scope: "shared",
        targetServiceId,
        windowSeconds: 60,
        maxRequests: 2,
      },
      riskLevel: "medium",
      reason: "Automated tribe quota smoke test approval",
    },
  });
  const approvalRequestId = approval?.data?.id;
  if (typeof approvalRequestId !== "string" || !approvalRequestId) {
    throw new Error("Approval request response did not include data.id.");
  }

  await adminRequest(
    `/api/v1/approvals/requests/${encodeURIComponent(approvalRequestId)}/approve`,
    {
      method: "POST",
    },
  );
  console.log(`Approved quota enforcement request ${approvalRequestId}.`);
  return approvalRequestId;
}

async function requestSmokeToken() {
  if (!tribeSecret) {
    throw new Error(
      "Set APICENTER_QUOTA_SMOKE_TOKEN or APICENTER_QUOTA_SMOKE_SECRET before running the quota smoke.",
    );
  }

  const response = await fetch(`${baseUrl}/api/v1/auth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tribeId: ownerTribeId,
      secret: tribeSecret,
    }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      `Token request failed with HTTP ${response.status}: ${JSON.stringify(body)}`,
    );
  }

  const accessToken = body?.data?.accessToken;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("Token response did not include data.accessToken.");
  }
  return accessToken;
}

async function adminRequest(path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method,
    headers: {
      "content-type": "application/json",
      "x-platform-secret": adminSecret,
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      `Admin request ${init.method} ${path} failed with HTTP ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

async function callSharedService(bearerToken) {
  const response = await fetch(
    `${baseUrl}/api/v1/shared/${encodeURIComponent(targetServiceId)}${smokePath}`,
    {
      headers: {
        authorization: `Bearer ${bearerToken}`,
        "x-tribe-id": ownerTribeId,
      },
    },
  );
  const body = await readJson(response);
  return {
    status: response.status,
    code: body?.error?.code,
    body,
  };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function env(name, fallback) {
  return process.env[name] || fallback;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

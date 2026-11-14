const { z } = require("zod");
const cases = z
  .array(
    z
      .object({
        checkId: z.enum([
          "provider.email",
          "provider.sms",
          "provider.otp",
          "provider.geo",
          "provider.gauth",
          "provider.payments",
        ]),
        body: z.record(z.string(), z.unknown()),
      })
      .strict(),
  )
  .max(6);
const definitions = {
  "provider.email": {
    method: "POST",
    path: "/api/v1/shared/email/send",
    status: 201,
    valid: (data) =>
      data?.provider === "resend" && typeof data.messageId === "string",
  },
  "provider.sms": {
    method: "POST",
    path: "/api/v1/shared/sms/send",
    status: 201,
    valid: (data) =>
      typeof data?.messageId === "string" &&
      !data.messageId.startsWith("mock_"),
  },
  "provider.otp": {
    method: "POST",
    path: "/api/v1/shared/otp/generate",
    status: 201,
    valid: (data) =>
      typeof data?.otpId === "string" && !Object.hasOwn(data, "code"),
  },
  "provider.geo": {
    method: "POST",
    path: "/api/v1/shared/geo/geocode",
    status: 200,
    valid: (data) => data?.provider === "google-maps",
  },
  "provider.gauth": {
    method: "POST",
    path: "/api/v1/shared/gauth/oauth/token/refresh",
    status: 200,
    valid: (data) => typeof data?.accessToken === "string",
  },
  "provider.payments": {
    method: "GET",
    path: (body) =>
      "/api/v1/payments/plans/" +
      encodeURIComponent(z.string().min(1).parse(body.planId)),
    status: 200,
    valid: (data) => typeof data?.planId === "string",
  },
};
async function runProviderCases({
  providers,
  environment,
  runId,
  deployments,
  token,
  call,
  env = process.env,
}) {
  let selected;
  try {
    selected = cases.parse(JSON.parse(env.APICENTER_VERIFY_CASES || "[]"));
  } catch {
    return providers.map((checkId) => ({
      checkId,
      status: "blocked",
      required: true,
      errorCode: "INVALID_ACCEPTANCE_FIXTURE",
    }));
  }
  const allowed = new Set(
    (env.APICENTER_VERIFY_ALLOW_LIVE_CASES || "").split(","),
  );
  let recipients;
  try {
    recipients = z
      .array(z.string())
      .parse(JSON.parse(env.APICENTER_VERIFY_RECIPIENT_ALLOWLIST || "[]"));
  } catch {
    recipients = [];
  }
  const results = [];
  for (const checkId of providers) {
    const fixture = selected.find((item) => item.checkId === checkId);
    const spec = definitions[checkId];
    const provider = checkId.slice("provider.".length);
    const runtime = deployments.find(
      (item) =>
        item.serviceId === provider ||
        (provider === "payments" && item.serviceId === "payment"),
    );
    if (!fixture || !spec || !runtime?.production) {
      results.push({
        checkId,
        status: "blocked",
        required: true,
        errorCode: "PROVIDER_ACCEPTANCE_REQUIRED",
      });
      continue;
    }
    if (
      environment === "live" &&
      (!allowed.has(checkId) ||
        env.APICENTER_VERIFY_LIVE_PHRASE !== "APPLY LIVE CHANGE" ||
        !env.APICENTER_VERIFY_LIVE_REASON?.trim())
    ) {
      results.push({
        checkId,
        status: "blocked",
        required: true,
        errorCode: "LIVE_CONFIRMATION_REQUIRED",
      });
      continue;
    }
    if (
      environment === "test" &&
      spec.method === "POST" &&
      env.APICENTER_VERIFY_ALLOW_TEST_WRITES !== "true"
    ) {
      results.push({
        checkId,
        status: "blocked",
        required: true,
        errorCode: "TEST_PROVIDER_WRITE_NOT_SELECTED",
      });
      continue;
    }
    if (JSON.stringify(fixture.body).length > 4096) {
      results.push({
        checkId,
        status: "blocked",
        required: true,
        errorCode: "INVALID_ACCEPTANCE_FIXTURE",
      });
      continue;
    }
    if (["email", "sms", "otp"].includes(provider)) {
      const target =
        provider === "otp"
          ? fixture.body.recipient || fixture.body.target
          : fixture.body.to;
      const targets = Array.isArray(target) ? target : [target];
      if (
        targets.length !== 1 ||
        !targets.every(
          (value) => typeof value === "string" && recipients.includes(value),
        )
      ) {
        results.push({
          checkId,
          status: "blocked",
          required: true,
          errorCode: "ACCEPTANCE_RECIPIENT_NOT_ALLOWED",
        });
        continue;
      }
    }
    try {
      const response = await call(
        typeof spec.path === "function" ? spec.path(fixture.body) : spec.path,
        {
          method: spec.method,
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
            "Idempotency-Key": runId + "-" + checkId,
          },
          ...(spec.method === "POST"
            ? { body: JSON.stringify(fixture.body) }
            : {}),
        },
      );
      if (response.status !== spec.status) {
        results.push({
          checkId,
          status: response.status >= 500 ? "blocked" : "failed",
          required: true,
          errorCode:
            response.status >= 500
              ? "PROVIDER_OUTCOME_UNKNOWN"
              : "PROVIDER_ACCEPTANCE_FAILED",
        });
        continue;
      }
      const body = await response.json();
      results.push({
        checkId,
        status:
          body.success === true && spec.valid(body.data) ? "passed" : "failed",
        required: true,
      });
    } catch {
      results.push({
        checkId,
        status: "blocked",
        required: true,
        errorCode: "PROVIDER_OUTCOME_UNKNOWN",
      });
    }
  }
  return results;
}
module.exports = { runProviderCases };

const { z } = require("zod");
const { runProviderCases } = require("./provider-cases.cjs");
const consumerConfig = z
  .object({
    baseUrl: z.string().url(),
    serviceId: z.string().regex(/^[a-z0-9-]{1,64}$/),
    environment: z.enum(["test", "live"]),
    secret: z.string().min(1),
  })
  .strict();
async function runConsumerChecks(
  input,
  {
    request = fetch,
    env = process.env,
    runId = require("node:crypto").randomUUID(),
    deployments = [],
    requiredChecks,
    providerCasesAuthorized = false,
  } = {},
) {
  const config = consumerConfig.parse(input);
  const base = new URL(config.baseUrl);
  if (
    base.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "::1"].includes(base.hostname)
  )
    throw new Error("HTTPS_REQUIRED");
  const results = [];
  const call = async (path, options = {}) =>
    request(new URL(path, base), {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  const run = async (checkId, fn) => {
    try {
      results.push({
        checkId,
        status: (await fn()) ? "passed" : "failed",
        required: true,
      });
    } catch {
      results.push({
        checkId,
        status: "failed",
        required: true,
        errorCode: "REQUEST_FAILED",
      });
    }
  };
  await run("health", async () => {
    const res = await call("/api/v1/health/ready");
    return res.status === 200;
  });
  let token;
  await run("authentication", async () => {
    const res = await call("/api/v1/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceId: config.serviceId,
        environment: config.environment,
        secret: config.secret,
      }),
    });
    const value = await res.json();
    if (
      res.status !== 201 ||
      value.success !== true ||
      value.data?.serviceId !== config.serviceId ||
      value.data?.environment !== config.environment ||
      typeof value.data?.accessToken !== "string"
    )
      return false;
    token = value.data.accessToken;
    return true;
  });
  await run("authorization", async () => {
    const res = await call("/api/v1/shared");
    return res.status === 401 || res.status === 403;
  });
  let services = [];
  await run("discovery", async () => {
    if (!token) return false;
    const res = await call("/api/v1/shared", {
      headers: { Authorization: "Bearer " + token },
    });
    const body = await res.json();
    if (res.status !== 200 || !Array.isArray(body.data)) return false;
    services = body.data.map((item) => item.serviceId);
    return true;
  });
  const providers = requiredChecks
    ? requiredChecks.filter((checkId) => checkId.startsWith("provider."))
    : [...new Set(services.map((id) => (id === "payment" ? "payments" : id)))]
        .filter((id) =>
          ["email", "sms", "otp", "geo", "gauth", "payments"].includes(id),
        )
        .map((id) => "provider." + id);
  if (token && !providerCasesAuthorized)
    results.push(
      ...providers.map((checkId) => ({
        checkId,
        status: "blocked",
        required: true,
        errorCode: "VERIFICATION_CLAIM_REQUIRED",
      })),
    );
  else if (token)
    results.push(
      ...(await runProviderCases({
        providers,
        environment: config.environment,
        runId,
        deployments,
        token,
        call,
        env,
      })),
    );
  else
    results.push(
      ...providers.map((checkId) => ({
        checkId,
        status: "blocked",
        required: true,
        errorCode: "CONSUMER_CREDENTIALS_REQUIRED",
      })),
    );
  if (requiredChecks?.includes("event_delivery"))
    results.push({
      checkId: "event_delivery",
      status: "blocked",
      required: true,
      errorCode: "CONSUMER_ACKNOWLEDGEMENT_REQUIRED",
    });
  return results;
}
module.exports = { runConsumerChecks, consumerConfig };

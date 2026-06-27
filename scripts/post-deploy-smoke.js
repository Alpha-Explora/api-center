#!/usr/bin/env node

const args = process.argv.slice(2);

function getArg(name, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const options = {
  apiCenterBaseUrl: (
    getArg("--api-center-base-url") ||
    process.env.APICENTER_URL ||
    ""
  ).replace(/\/+$/g, ""),
  managementBaseUrl: (
    getArg("--management-base-url") ||
    process.env.MANAGEMENT_BASE_URL ||
    ""
  ).replace(/\/+$/g, ""),
  environment: getArg("--environment", process.env.PIPELINE_SMOKE_ENVIRONMENT || "test"),
  year: getArg("--year", process.env.PIPELINE_SMOKE_YEAR || ""),
  month: getArg("--month", process.env.PIPELINE_SMOKE_MONTH || ""),
  day: getArg("--day", process.env.PIPELINE_SMOKE_DAY || ""),
  platformAdminSecret:
    getArg("--platform-admin-secret") ||
    process.env.API_CENTER_PLATFORM_ADMIN_SECRET ||
    process.env.PLATFORM_ADMIN_SECRET ||
    "",
};

function requireValue(name, value) {
  if (!value) {
    throw new Error(`${name} is required.`);
  }
}

function buildPipelinePath(path) {
  const params = new URLSearchParams({ environment: options.environment });
  if (options.year) params.set("year", options.year);
  if (options.month) params.set("month", options.month);
  if (options.day) params.set("day", options.day);
  return `${path}?${params.toString()}`;
}

async function requestJson(baseUrl, path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${baseUrl}${path} failed with ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

function countRows(body) {
  return Array.isArray(body?.data) ? body.data.length : 0;
}

function sourceOf(body) {
  return body?.meta?.source ?? "unknown";
}

async function smokeApiCenter() {
  requireValue("APICENTER_URL", options.apiCenterBaseUrl);
  requireValue("API_CENTER_PLATFORM_ADMIN_SECRET", options.platformAdminSecret);
  const adminHeaders = { "X-Platform-Secret": options.platformAdminSecret };

  const readiness = await requestJson(options.apiCenterBaseUrl, "/api/v1/health/ready");
  const health = await requestJson(
    options.apiCenterBaseUrl,
    buildPipelinePath("/api/v1/data-pipeline/health"),
    { headers: adminHeaders },
  );
  const signals = await requestJson(
    options.apiCenterBaseUrl,
    buildPipelinePath("/api/v1/data-pipeline/decision-signals"),
    { headers: adminHeaders },
  );

  return {
    readinessStatus: readiness?.status ?? "ok",
    health: {
      success: Boolean(health?.success),
      count: countRows(health),
      source: sourceOf(health),
    },
    decisionSignals: {
      success: Boolean(signals?.success),
      count: countRows(signals),
      source: sourceOf(signals),
    },
  };
}

async function smokeManagement() {
  if (!options.managementBaseUrl) return undefined;

  const config = await requestJson(
    options.managementBaseUrl,
    "/api/local/deployment/config-check",
  );
  const health = await requestJson(
    options.managementBaseUrl,
    buildPipelinePath("/api/local/data-pipeline/health"),
  );
  const signals = await requestJson(
    options.managementBaseUrl,
    buildPipelinePath("/api/local/data-pipeline/decision-signals"),
  );

  return {
    isDeployed: Boolean(config?.data?.isDeployed),
    managementEnvironment: config?.data?.managementEnvironment,
    apiCenterBaseUrl: config?.data?.apiCenterBaseUrl,
    missingEnvCount: Array.isArray(config?.data?.missingEnv)
      ? config.data.missingEnv.length
      : 0,
    health: {
      success: Boolean(health?.success),
      count: countRows(health),
      source: sourceOf(health),
    },
    decisionSignals: {
      success: Boolean(signals?.success),
      count: countRows(signals),
      source: sourceOf(signals),
    },
  };
}

async function main() {
  const result = {
    environment: options.environment,
    partition: {
      year: options.year || undefined,
      month: options.month || undefined,
      day: options.day || undefined,
    },
    apiCenter: await smokeApiCenter(),
    management: await smokeManagement(),
  };

  console.log(JSON.stringify(result, null, 2));

  const failures = [];
  if (!result.apiCenter.health.success) failures.push("api-center health route");
  if (!result.apiCenter.decisionSignals.success) {
    failures.push("api-center decision signals route");
  }
  if (result.management) {
    if (!result.management.isDeployed) failures.push("management deployed config");
    if (result.management.missingEnvCount > 0) failures.push("management env");
    if (!result.management.health.success) failures.push("management health route");
    if (!result.management.decisionSignals.success) {
      failures.push("management decision signals route");
    }
  }

  if (failures.length > 0) {
    throw new Error(`Post-deploy smoke failed: ${failures.join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

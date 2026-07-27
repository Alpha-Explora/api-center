import { pathToFileURL } from "node:url";

export const defaultRoutes = [
  "/",
  "/alerts",
  "/api-catalog",
  "/audit",
  "/compliance",
  "/cost",
  "/data-pipeline",
  "/dependencies",
  "/developer-portal",
  "/docs/consumer-runbook",
  "/lifecycle",
  "/manifest-tools",
  "/marketplace",
  "/operational-trust",
  "/plans",
  "/promotions",
  "/quotas",
  "/readiness",
  "/registration-requests",
  "/reliability",
  "/settings",
  "/shared-services",
  "/shared-services/setup",
  "/shared-services/usage",
  "/smoke-tests",
  "/tribes",
  "/tribes/new",
];

export const defaultRouteChecks = [
  { route: "/" },
  {
    route: "/alerts",
    expectedText: [
      "View read-only operational alerts from registry and runtime analytics.",
    ],
  },
  {
    route: "/api-catalog",
    expectedText: [
      "Review registered tribe and shared-service APIs as governed platform products.",
    ],
  },
  {
    route: "/audit",
    expectedText: [
      "Inspect recent registry, proxy, Kafka, and readiness events captured by API Center.",
    ],
  },
  {
    route: "/compliance",
    expectedText: [
      "Prepare audit-ready packets and review consumer health signals.",
    ],
  },
  {
    route: "/cost",
    expectedText: [
      "Review shared-service provider usage that can drive operational cost.",
    ],
  },
  {
    route: "/data-pipeline",
    expectedText: [
      "Answer the north-star traceability question across publishing, gateway decisions, S3 export, governed BI, and Athena cost signals.",
    ],
  },
  {
    route: "/dependencies",
    expectedText: [
      "Registry relationships derived from service manifest consumes entries.",
    ],
  },
  {
    route: "/developer-portal",
    expectedText: [
      "Preview the read-only tribe portal packet without exposing runtime credentials.",
    ],
  },
  {
    route: "/docs/consumer-runbook",
    expectedText: [
      "Consumer setup guidance for the Developer Portal onboarding packet.",
    ],
  },
  {
    route: "/lifecycle",
    expectedText: [
      "Track every service from registry through runtime, quota, pipeline, promotion, and evidence readiness.",
    ],
  },
  {
    route: "/manifest-tools",
    expectedText: [
      "Export registry entries or paste service manifests for local import.",
    ],
  },
  {
    route: "/marketplace",
    expectedText: [
      "Browse API and shared-service products with onboarding and deprecation status.",
    ],
  },
  {
    route: "/operational-trust",
    expectedText: [
      "Review drift, runtime dependencies, promotion evidence, and consumer scorecards before live changes.",
    ],
  },
  {
    route: "/plans",
    expectedText: [
      "Package quota defaults, shared-service access expectations, retention, and support tiers into managed tribe plans.",
    ],
  },
  {
    route: "/promotions",
    expectedText: [
      "Check live-readiness gates before moving a tribe or service from test to live.",
    ],
  },
  {
    route: "/quotas",
    expectedText: [
      "Configure per-tribe API call policies, review observe-mode impact, and inspect quota decisions emitted by API Center.",
    ],
  },
  {
    route: "/readiness",
    expectedText: [
      "Check local API Center connectivity before changing registry data.",
    ],
  },
  {
    route: "/registration-requests",
    expectedText: [
      "Review manifest submissions before they become active APICenter registry entries.",
    ],
  },
  {
    route: "/reliability",
    expectedText: [
      "Review tribe reliability signals and incident evidence across gateway, quota, Kafka, and shared-service activity.",
    ],
  },
  {
    route: "/settings",
    expectedText: ["Runtime config and deployment readiness checks."],
  },
  {
    route: "/shared-services",
    expectedText: [
      "Catalog the shared-service wrappers, check their registry status, and open setup or usage views from one place.",
    ],
  },
  {
    route: "/shared-services/setup",
    expectedText: [
      "Register the platform shared-service manifests through API Center. Keep this flow local until admin auth is added.",
    ],
  },
  {
    route: "/shared-services/usage",
    expectedText: [
      "See which tribes are configured to consume each platform shared service, then compare that registry declaration against API Center runtime call counts when the analytics endpoint is deployed.",
    ],
  },
  {
    route: "/smoke-tests",
    expectedText: [
      "Request a temporary tribe token locally, then run allowlisted checks through API Center shared-service proxy routes.",
    ],
  },
  {
    route: "/tribes",
    expectedText: [
      "API Center service manifests, grouped by tribe and shared-service routing type.",
    ],
  },
  {
    route: "/tribes/new",
    expectedText: [
      "Register a service manifest with its backend API URL, exposed routes, required scopes, and allowed dependencies.",
    ],
  },
];

export const defaultApiRouteChecks = [
  {
    route: "/api/local/analytics/gateway-traffic?window=1h",
    allowedStatuses: [200, 500, 504],
    expectedJsonPaths: [
      "meta.sourceMetadata.0.sourceType",
      "meta.sourceMetadata.0.durability",
    ],
  },
  {
    route: "/api/local/analytics/shared-service-usage?window=1h",
    allowedStatuses: [200, 500, 504],
    expectedJsonPaths: [
      "meta.sourceMetadata.0.sourceType",
      "meta.sourceMetadata.0.durability",
    ],
  },
  {
    route: "/api/local/audit/events?limit=1",
    allowedStatuses: [200, 500, 504],
    expectedJsonPaths: [
      "meta.sourceMetadata.0.sourceType",
      "meta.sourceMetadata.0.durability",
    ],
  },
  {
    route: "/api/local/compliance/export?from=2026-01-01&to=2026-01-31&format=json",
    allowedStatuses: [200, 500, 504],
    expectedJsonPaths: [
      "meta.sourceMetadata.0.sourceType",
      "meta.sourceMetadata.1.sourceType",
    ],
  },
  {
    route: "/api/local/operations/evidence/smoke-service",
    allowedStatuses: [200, 500, 504],
    expectedJsonPaths: [
      "meta.sourceMetadata.0.sourceType",
      "meta.sourceMetadata.1.sourceType",
    ],
  },
  {
    route: "/api/local/data-pipeline/health?environment=test",
    allowedStatuses: [200, 500, 504],
    expectedJsonPaths: [
      "meta.sourceMetadata.0.sourceType",
      "meta.sourceMetadata.0.durability",
    ],
  },
  {
    route: "/api/local/data-pipeline/quality?environment=test",
    allowedStatuses: [200, 500, 504],
    expectedJsonPaths: [
      "meta.sourceMetadata.0.sourceType",
      "meta.sourceMetadata.0.durability",
    ],
  },
];

export const defaultSmokeChecks = [...defaultRouteChecks, ...defaultApiRouteChecks];

export function resolveBaseUrl(argv = process.argv, env = process.env) {
  const baseUrlFlagIndex = argv.indexOf("--base-url");
  if (baseUrlFlagIndex >= 0 && argv[baseUrlFlagIndex + 1]) {
    return argv[baseUrlFlagIndex + 1];
  }

  const inlineFlag = argv.find((arg) => arg.startsWith("--base-url="));
  if (inlineFlag) {
    return inlineFlag.slice("--base-url=".length);
  }

  return env.MANAGEMENT_PUBLIC_BASE_URL ?? "http://localhost:3000";
}

export async function smokeRoutes({
  baseUrl = resolveBaseUrl(),
  routes = defaultSmokeChecks,
  fetchImpl = fetch,
} = {}) {
  const results = [];

  for (const routeConfig of routes) {
    const route =
      typeof routeConfig === "string" ? routeConfig : routeConfig.route;
    const expectedText =
      typeof routeConfig === "string" ? [] : (routeConfig.expectedText ?? []);
    const expectedJsonPaths =
      typeof routeConfig === "string"
        ? []
        : (routeConfig.expectedJsonPaths ?? []);
    const allowedStatuses =
      typeof routeConfig === "string" ? [] : (routeConfig.allowedStatuses ?? []);
    const url = new URL(route, baseUrl);
    const response = await fetchImpl(url);
    const contentType = response.headers.get("content-type") ?? "";
    const shouldReadJson =
      expectedJsonPaths.length > 0 && contentType.includes("json");
    const payload = shouldReadJson ? await response.json() : undefined;
    const body = response.ok && expectedText.length ? await response.text() : "";
    const missingExpectedText = expectedText.filter(
      (marker) => !body.includes(marker),
    );
    const missingExpectedJsonPaths = expectedJsonPaths.filter(
      (jsonPath) => readJsonPath(payload, jsonPath) === undefined,
    );

    const statusOk = allowedStatuses.length
      ? allowedStatuses.includes(response.status)
      : response.ok;

    results.push({
      route,
      status: response.status,
      ok:
        statusOk &&
        missingExpectedText.length === 0 &&
        missingExpectedJsonPaths.length === 0,
      ...(missingExpectedText.length ? { missingExpectedText } : {}),
      ...(missingExpectedJsonPaths.length ? { missingExpectedJsonPaths } : {}),
    });
  }

  return results;
}

function readJsonPath(input, jsonPath) {
  return jsonPath.split(".").reduce((value, segment) => {
    if (value === undefined || value === null) return undefined;
    if (Array.isArray(value) && /^\d+$/.test(segment)) {
      return value[Number(segment)];
    }
    if (typeof value === "object" && Object.hasOwn(value, segment)) {
      return value[segment];
    }
    return undefined;
  }, input);
}

async function main() {
  const results = await smokeRoutes();
  let failed = false;

  for (const result of results) {
    if (!result.ok) {
      failed = true;
      const missingText = result.missingExpectedText?.length
        ? " missing expected text: " + result.missingExpectedText.join("; ")
        : "";
      const missingJson = result.missingExpectedJsonPaths?.length
        ? " missing expected json paths: " +
          result.missingExpectedJsonPaths.join("; ")
        : "";
      console.error(result.route + " returned " + result.status + missingText + missingJson);
    } else {
      console.log(result.route + " returned " + result.status);
    }
  }

  if (failed) {
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

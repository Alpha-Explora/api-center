const services = [
  { serviceId: "payments", method: "GET", gatewayPath: () => `/api/v1/payments/checkouts/apicenter-smoke-${Date.now()}`, expectedStatuses: [404], expectedErrorCodes: ["NOT_FOUND"] },
  { serviceId: "email", method: "GET", path: () => "/status/apicenter-smoke-missing-message", expectedStatuses: [404], expectedErrorCodes: ["NOT_FOUND"] },
  { serviceId: "sms", method: "GET", path: () => "/status/apicenter-smoke-missing-message", expectedStatuses: [404], expectedErrorCodes: ["NOT_FOUND"] },
  { serviceId: "otp", method: "GET", path: () => "/status/apicenter-smoke-missing-otp", expectedStatuses: [404], expectedErrorCodes: ["OTP_NOT_FOUND"] },
  { serviceId: "geo", method: "POST", path: () => "/geofence/check", body: { latitude: 0, longitude: 0, fences: [] }, expectedStatuses: [] },
  { serviceId: "gauth", method: "GET", path: () => "/health", expectedStatuses: [] },
];

function classifyGatewayResponse({ status, contentType = "", bodyText = "", expectedStatuses = [], expectedErrorCodes = [] }) {
  if (status === 502 || status === 503) return { ok: false, classification: "gateway-upstream-failure" };
  const isJson = /(?:application\/json|\+json)(?:\s*;|$)/i.test(contentType);
  if (!isJson) return { ok: false, classification: "non-json-response" };
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { ok: false, classification: "invalid-json-response" };
  }
  if (status >= 200 && status < 300) return { ok: true, classification: "json-success" };
  if (expectedStatuses.includes(status) && expectedErrorCodes.some((code) => containsErrorCode(body, code))) {
    return { ok: true, classification: "expected-runtime-error" };
  }
  return { ok: false, classification: "unexpected-status" };
}

function containsErrorCode(value, expectedCode) {
  if (!value || typeof value !== "object") return false;
  if (value.code === expectedCode || value.error === expectedCode) return true;
  return Object.values(value).some((child) => containsErrorCode(child, expectedCode));
}

async function runSharedServiceGatewaySmoke({ baseUrl, bearerToken, fetchImpl = fetch }) {
  const results = [];
  for (const service of services) {
    const gatewayPath = service.gatewayPath
      ? service.gatewayPath()
      : `/api/v1/shared/${service.serviceId}${service.path()}`;
    let response;
    try {
      response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}${gatewayPath}`, {
      method: service.method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${bearerToken}`,
        ...(service.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(service.body ? { body: JSON.stringify(service.body) } : {}),
      signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error(`Gateway shared-service smoke failed for ${service.serviceId} (transport-error)`);
    }
    const bodyText = await response.text();
    const result = classifyGatewayResponse({
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      bodyText,
      expectedStatuses: service.expectedStatuses,
      expectedErrorCodes: service.expectedErrorCodes,
    });
    results.push({ serviceId: service.serviceId, method: service.method, status: response.status, ...result });
    if (!result.ok) throw new Error(`Gateway shared-service smoke failed for ${service.serviceId} (${result.classification}, HTTP ${response.status})`);
  }
  return results;
}

module.exports = { classifyGatewayResponse, runSharedServiceGatewaySmoke, services };

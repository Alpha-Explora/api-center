import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

export type ParameterItem = {
  name: string;
  in: "path" | "query" | "header";
  type: string;
  required: boolean;
  deprecated?: boolean;
  description: string;
};

export type PropertyField = {
  name: string;
  type: string;
  required: boolean;
  description: string;
  children?: PropertyField[];
};

export type DetailedOperation = {
  serverUrl: string;
  path: string;
  method: string;
  operationId: string;
  tag: string;
  summary: string;
  description: string;
  requiresIdempotency: boolean;
  pathParameters: ParameterItem[];
  queryParameters: ParameterItem[];
  headerParameters: ParameterItem[];
  requestProperties: PropertyField[];
  responseProperties: PropertyField[];
  sampleRequest: Record<string, unknown> | null;
  sampleResponse: Record<string, unknown> | null;
  authentication: string;
  successResponses: { code: number; description: string; properties: PropertyField[] }[];
  errorResponses: { code: number; description: string }[];
};

export type ApiOperation = {
  path: string;
  method: string;
  operationId: string;
  summary: string;
  description: string;
  hasRequestBody: boolean;
  requiresIdempotency: boolean;
};

export type EventDefinition = {
  name: string;
  title: string;
  description: string;
  aggregateType: string;
};

type ContractMap = Record<string, unknown>;

function contractPath(fileName: string): string {
  const candidates = [
    path.resolve(process.cwd(), "contracts/public", fileName),
    path.resolve(process.cwd(), "../../contracts/public", fileName),
  ];
  const match = candidates.find((candidate) => existsSync(candidate));
  if (!match) throw new Error(`Contract artifact not found: ${fileName}`);
  return match;
}

function loadContract(fileName: string): ContractMap {
  return parse(readFileSync(contractPath(fileName), "utf8")) as ContractMap;
}

function asRecord(value: unknown): ContractMap {
  return value && typeof value === "object" ? (value as ContractMap) : {};
}

// Helper to resolve $ref references within OpenAPI document
function resolveRef(doc: ContractMap, ref: string): ContractMap {
  if (!ref || typeof ref !== "string" || !ref.startsWith("#/")) return {};
  const parts = ref.replace(/^#\//, "").split("/");
  let current: unknown = doc;
  for (const part of parts) {
    current = asRecord(current)[part.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return asRecord(current);
}

function resolveParameter(doc: ContractMap, value: unknown): ContractMap {
  const parameter = asRecord(value);
  return typeof parameter.$ref === "string"
    ? resolveRef(doc, parameter.$ref)
    : parameter;
}

// Helper to extract properties recursively from an OpenAPI schema
function extractProperties(doc: ContractMap, rawSchema: ContractMap): PropertyField[] {
  let schema = rawSchema;
  if (schema.$ref) {
    schema = resolveRef(doc, String(schema.$ref));
  }

  const props = asRecord(schema.properties);
  const requiredList = Array.isArray(schema.required) ? schema.required.map(String) : [];
  const result: PropertyField[] = [];

  for (const [propName, rawPropDef] of Object.entries(props)) {
    let propDef = asRecord(rawPropDef);
    if (propDef.$ref) {
      propDef = resolveRef(doc, String(propDef.$ref));
    }

    const isRequired = requiredList.includes(propName);
    const rawType = String(propDef.type ?? (typeof propDef.const === "boolean" ? "boolean" : propDef.properties ? "object" : propDef.items ? "array" : "unknown"));
    const description = String(propDef.description ?? "");

    let children: PropertyField[] | undefined;
    if (rawType === "object" && propDef.properties) {
      children = extractProperties(doc, propDef);
    } else if (rawType === "array" && propDef.items) {
      let itemDef = asRecord(propDef.items);
      if (itemDef.$ref) itemDef = resolveRef(doc, String(itemDef.$ref));
      if (itemDef.properties) {
        children = extractProperties(doc, itemDef);
      }
    }

    result.push({
      name: propName,
      type: rawType,
      required: isRequired,
      description,
      children,
    });
  }

  return result;
}

function formatOperationTitle(operationId: string, pathStr: string, method: string): string {
  const titles: Record<string, string> = {
    createCheckout: "Create a Checkout",
    getCheckout: "Get a Checkout",
    getCheckoutByReference: "Get Checkout by Reference",
    createPaymentIntent: "Create a Payment Intent",
    getPaymentIntent: "Get a Payment Intent",
    confirmPaymentIntent: "Confirm a Payment Intent",
    cancelPaymentIntent: "Cancel a Payment Intent",
    createCustomer: "Create a Customer",
    getCustomer: "Get a Customer",
    createRefund: "Create a Refund",
    getRefund: "Get a Refund",
    createSubscription: "Create a Subscription",
    getSubscription: "Get a Subscription",
    cancelSubscription: "Cancel a Subscription",
    listSubscriptionInvoices: "List Subscription Invoices",
    getInvoice: "Get an Invoice",
    getPaymentCapabilities: "Get Payment Capabilities",
    sendSms: "Send SMS Notification",
    sendBulkSms: "Send Bulk SMS",
    sendEmail: "Send Email Notification",
    generateOtp: "Generate OTP Code",
    verifyOtp: "Verify OTP Code",
    lookupGeo: "Lookup IP Geolocation",
    issueToken: "Issue Auth Token",
    getJwks: "Get Public JWKS",
    registerService: "Register Microservice",
    getLiveness: "Liveness Probe",
    getReadiness: "Readiness Probe",
  };

  if (titles[operationId]) return titles[operationId];

  return operationId
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

function getOperationCategory(operationId: string, pathStr: string): string {
  if (pathStr.includes("/payments/checkouts")) return "Checkouts";
  if (pathStr.includes("/payments/intents")) return "Payment Intents";
  if (pathStr.includes("/payments/customers")) return "Customers";
  if (pathStr.includes("/payments/subscriptions") || pathStr.includes("/payments/invoices")) return "Subscriptions & Billing";
  if (pathStr.includes("/payments/refunds")) return "Refunds";
  if (pathStr.includes("/payments/capabilities")) return "Capabilities & System";
  if (pathStr.includes("/shared/sms")) return "SMS Messaging";
  if (pathStr.includes("/shared/email")) return "Email Service";
  if (pathStr.includes("/shared/otp")) return "OTP Verification";
  if (pathStr.includes("/shared/geo")) return "Platform Utilities";
  if (pathStr.includes("/auth")) return "Identity & Auth";
  if (pathStr.includes("/registry") || pathStr.includes("/health")) return "Registry & Health";
  return "General";
}

export function getDetailedOperations(): DetailedOperation[] {
  const document = loadContract("apicenter.openapi.yaml");
  const paths = asRecord(document.paths);
  const operations: DetailedOperation[] = [];

  for (const [route, definition] of Object.entries(paths)) {
    const routeObj = asRecord(definition);
    for (const [method, rawOperation] of Object.entries(routeObj)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const op = asRecord(rawOperation);
      const operationId = String(op.operationId ?? `${method}-${route}`);
      const category = getOperationCategory(operationId, route);
      const summaryTitle = formatOperationTitle(operationId, route, method);

      const inherited = Array.isArray(routeObj.parameters) ? routeObj.parameters : [];
      const declared = Array.isArray(op.parameters) ? op.parameters : [];
      const parameterMap = new Map<string, ContractMap>();
      for (const parameter of [...inherited, ...declared]) {
        const resolved = resolveParameter(document, parameter);
        parameterMap.set(String(resolved.in) + ":" + String(resolved.name), resolved);
      }
      const rawParams = [...parameterMap.values()];
      const requiresIdempotency = rawParams.some((parameter) => resolveParameter(document, parameter).name === "Idempotency-Key");

      const pathParameters: ParameterItem[] = [];
      const queryParameters: ParameterItem[] = [];
      const headerParameters: ParameterItem[] = [];

      for (const param of rawParams) {
        const p = resolveParameter(document, param);

        const name = String(p.name ?? "");
        const inType = String(p.in ?? "query");
        const schema = asRecord(p.schema);
        const type = String(schema.type ?? "string");
        const required = Boolean(p.required);
        const deprecated = Boolean(p.deprecated);
        const description = String(p.description ?? "");

        if (name && (inType === "path" || inType === "header" || inType === "query")) {
          const item: ParameterItem = { name, in: inType, type, required, deprecated, description };
          if (inType === "path") pathParameters.push(item);
          else if (inType === "header") headerParameters.push(item);
          else queryParameters.push(item);
        }
      }

      // Extract Request Body Properties
      let requestProperties: PropertyField[] = [];
      let sampleRequest: Record<string, unknown> | null = null;
      const reqBody = resolveParameter(document, op.requestBody);
      const reqContent = asRecord(reqBody.content);
      const reqJson = asRecord(reqContent["application/json"]);
      if (reqJson.schema) {
        requestProperties = extractProperties(document, asRecord(reqJson.schema));
      }
      if (reqJson.example) {
        sampleRequest = reqJson.example as Record<string, unknown>;
      }

      const responses = asRecord(op.responses);
      const successResponses = Object.entries(responses)
        .filter(([code]) => /^2\d\d$/.test(code))
        .map(([code, rawResponse]) => {
          const response = resolveParameter(document, rawResponse);
          const json = asRecord(asRecord(response.content)["application/json"]);
          return { code: Number(code), description: String(response.description ?? ""), properties: extractProperties(document, asRecord(json.schema)) };
        });
      const primaryCode = successResponses[0]?.code;
      const primaryResponse = resolveParameter(document, responses[String(primaryCode)]);
      const responseJson = asRecord(asRecord(primaryResponse.content)["application/json"]);
      const sampleResponse = responseJson.example ? asRecord(responseJson.example) : null;
      const responseProperties = successResponses[0]?.properties ?? [];
      const errorResponses = Object.entries(responses)
        .filter(([code]) => /^\d{3}$/.test(code) && Number(code) >= 400)
        .map(([code, response]) => ({ code: Number(code), description: String(resolveParameter(document, response).description ?? "") }));
      const security = Array.isArray(op.security) ? op.security : Array.isArray(document.security) ? document.security : [];
      const schemes = asRecord(asRecord(document.components).securitySchemes);
      const authentication = security.length === 0 ? "No authentication required by this contract." : security.map((requirement) =>
        Object.keys(asRecord(requirement)).map((name) => {
          const scheme = asRecord(schemes[name]);
          return scheme.bearerFormat === "APICenterApiKey" ? "Authorization: Bearer <PAYMENT_API_KEY>. Use the consumer's payment API key." : String(scheme.description ?? name);
        }).join(" and "),
      ).join(" or ");

      const servers = op.servers ?? routeObj.servers ?? document.servers;
      const serverUrl = Array.isArray(servers) ? String(asRecord(servers[0]).url ?? "") : "";
      if (!serverUrl) throw new Error(`No contract server URL for ${operationId}`);

      operations.push({
        serverUrl: serverUrl.replace(/\/$/, ""),
        path: route,
        method: method.toUpperCase(),
        operationId,
        tag: category,
        summary: summaryTitle,
        description: String(op.description ?? `Perform ${summaryTitle} operation on APICenter platform.`),
        requiresIdempotency,
        pathParameters,
        queryParameters,
        headerParameters,
        requestProperties,
        responseProperties,
        sampleRequest,
        sampleResponse,
        authentication,
        successResponses,
        errorResponses,
      });
    }
  }

  return operations;
}

export function getApiOperations(): ApiOperation[] {
  const document = loadContract("apicenter.openapi.yaml");
  const paths = asRecord(document.paths);
  return Object.entries(paths).flatMap(([route, definition]) =>
    Object.entries(asRecord(definition))
      .filter(([method]) => ["get", "post", "put", "patch", "delete"].includes(method))
      .map(([method, rawOperation]) => {
        const operation = asRecord(rawOperation);
        const parameters = Array.isArray(operation.parameters) ? operation.parameters : [];
        const requiresIdempotency = parameters.some((parameter) => resolveParameter(document, parameter).name === "Idempotency-Key");
        return {
          path: route,
          method: method.toUpperCase(),
          operationId: String(operation.operationId ?? `${method}-${route}`),
          summary: String(operation.summary ?? operation.description ?? "Public API operation"),
          description: String(operation.description ?? "Provider-neutral APICenter operation."),
          hasRequestBody: Boolean(operation.requestBody),
          requiresIdempotency,
        };
      }),
  );
}

export function getEvents(): EventDefinition[] {
  const document = loadContract("apicenter.asyncapi.yaml");
  const messages = asRecord(asRecord(document.components).messages);
  return Object.values(messages).map((rawMessage) => {
    const message = asRecord(rawMessage);
    const payload = asRecord(message.payload);
    const properties = asRecord(payload.properties);
    return {
      name: String(message.name ?? "payment.event"),
      title: String(message.title ?? message.name ?? "Payment event"),
      description: String(message.description ?? "Normalized payment lifecycle event."),
      aggregateType: String(asRecord(properties.aggregateType).const ?? "payment resource"),
    };
  });
}

export function getContractVersion(): { openapi: string; asyncapi: string } {
  const openapi = loadContract("apicenter.openapi.yaml");
  const asyncapi = loadContract("apicenter.asyncapi.yaml");
  return { openapi: String(openapi.openapi), asyncapi: String(asyncapi.asyncapi) };
}

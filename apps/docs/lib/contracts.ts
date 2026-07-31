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
  sampleResponse: Record<string, unknown>;
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
    current = asRecord(current)[part];
  }
  return asRecord(current);
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
    const rawType = String(propDef.type ?? (propDef.properties ? "object" : propDef.items ? "array" : "string"));
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
    createPaymentMethodSetup: "Setup Payment Method",
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
  if (pathStr.includes("/payments/customers") || pathStr.includes("/payments/payment-methods")) return "Customers & Vault";
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

      const rawParams = Array.isArray(op.parameters) ? op.parameters : [];
      const requiresIdempotency = rawParams.some((p) => JSON.stringify(p).includes("Idempotency-Key"));

      const pathParameters: ParameterItem[] = [];
      const queryParameters: ParameterItem[] = [];
      const headerParameters: ParameterItem[] = [];

      for (const param of rawParams) {
        let p = asRecord(param);
        if (p.$ref) {
          p = resolveRef(document, String(p.$ref));
        }

        const name = String(p.name ?? "");
        const inType = String(p.in ?? "query");
        const schema = asRecord(p.schema);
        const type = String(schema.type ?? "string");
        const required = Boolean(p.required);
        const deprecated = Boolean(p.deprecated);
        const description = String(p.description ?? "");

        if (name) {
          const item: ParameterItem = { name, in: inType as any, type, required, deprecated, description };
          if (inType === "path") pathParameters.push(item);
          else if (inType === "header") headerParameters.push(item);
          else queryParameters.push(item);
        }
      }

      if (method.toLowerCase() === "get" && queryParameters.length === 0) {
        queryParameters.push(
          { name: "environment", in: "query", type: "string", required: false, description: "Target environment scope (test or live)." },
          { name: "limit", in: "query", type: "number", required: false, description: "Number of records to return (1 to 100)." }
        );
      }

      // Extract Request Body Properties
      let requestProperties: PropertyField[] = [];
      let sampleRequest: Record<string, unknown> | null = null;
      const reqBody = asRecord(op.requestBody);
      const reqContent = asRecord(reqBody.content);
      const reqJson = asRecord(reqContent["application/json"]);
      if (reqJson.schema) {
        requestProperties = extractProperties(document, asRecord(reqJson.schema));
      }
      if (reqJson.example) {
        sampleRequest = reqJson.example as Record<string, unknown>;
      }

      // Extract Response Properties & Sample
      let responseProperties: PropertyField[] = [];
      let sampleResponse: Record<string, unknown> = { success: true };
      const responses = asRecord(op.responses);
      const successRes = asRecord(responses["200"] || responses["201"]);
      const resContent = asRecord(successRes.content);
      const resJson = asRecord(resContent["application/json"]);

      if (resJson.schema) {
        responseProperties = extractProperties(document, asRecord(resJson.schema));
      }
      if (resJson.example) {
        sampleResponse = resJson.example as Record<string, unknown>;
      }

      const errorResponses = [
        { code: 400, description: "One of the provided values in the request query or body is invalid." },
        { code: 401, description: "The request is not authorized. Missing or invalid Bearer JWT token." },
        { code: 403, description: "You do not have required scopes to access this resource." },
        { code: 404, description: "The requested APICenter resource was not found." },
        { code: 429, description: "Quota limit exceeded. Rate limit is 20 writes / 100 reads per minute." },
      ];

      operations.push({
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
        errorResponses,
      });
    }
  }

  // Ensure non-OpenAPI shared services are present and categorized cleanly
  const existingPaths = operations.map((o) => o.path);

  if (!existingPaths.includes("/api/v1/shared/sms/send")) {
    operations.push({
      path: "/api/v1/shared/sms/send",
      method: "POST",
      operationId: "sendSms",
      tag: "SMS Messaging",
      summary: "Send SMS Notification",
      description: "Dispatch single transactional SMS message across Philippine networks.",
      requiresIdempotency: true,
      pathParameters: [],
      queryParameters: [],
      headerParameters: [],
      requestProperties: [
        { name: "to", type: "string", required: true, description: "Recipient phone number in E.164 format (+639...)." },
        { name: "message", type: "string", required: true, description: "SMS text payload (up to 160 characters)." },
        { name: "senderId", type: "string", required: false, description: "Approved brand sender ID." },
      ],
      responseProperties: [
        { name: "success", type: "boolean", required: true, description: "Gateway status boolean." },
        { name: "messageId", type: "string", required: true, description: "Unique SMS delivery tracking ID." },
        { name: "status", type: "string", required: true, description: "Delivery state (queued, sent, failed)." },
      ],
      sampleRequest: { to: "+639171234567", message: "Your verification code is 849201" },
      sampleResponse: { success: true, messageId: "sms_msg_9918a", status: "queued" },
      errorResponses: [
        { code: 400, description: "Invalid recipient phone number or empty message payload." },
        { code: 401, description: "Missing or invalid Bearer JWT token." },
        { code: 403, description: "Missing required scope: sms:send." },
        { code: 429, description: "SMS quota limit exceeded (60 messages per minute)." },
      ],
    });
  }

  if (!existingPaths.includes("/api/v1/shared/email/send")) {
    operations.push({
      path: "/api/v1/shared/email/send",
      method: "POST",
      operationId: "sendEmail",
      tag: "Email Service",
      summary: "Send Email Notification",
      description: "Send HTML/text transactional email notifications with attachment support.",
      requiresIdempotency: true,
      pathParameters: [],
      queryParameters: [],
      headerParameters: [],
      requestProperties: [
        { name: "to", type: "string", required: true, description: "Recipient email address." },
        { name: "subject", type: "string", required: true, description: "Email subject line." },
        { name: "html", type: "string", required: true, description: "HTML body content." },
      ],
      responseProperties: [
        { name: "success", type: "boolean", required: true, description: "Gateway status boolean." },
        { name: "emailId", type: "string", required: true, description: "Unique email transaction ID." },
      ],
      sampleRequest: { to: "user@example.com", subject: "Payment Receipt", html: "<h1>Payment Successful</h1>" },
      sampleResponse: { success: true, emailId: "eml_88192a" },
      errorResponses: [
        { code: 400, description: "Invalid email format or missing subject." },
        { code: 401, description: "Unauthorized request." },
        { code: 403, description: "Missing required scope: email:send." },
      ],
    });
  }

  if (!existingPaths.includes("/api/v1/shared/otp/generate")) {
    operations.push({
      path: "/api/v1/shared/otp/generate",
      method: "POST",
      operationId: "generateOtp",
      tag: "OTP Verification",
      summary: "Generate OTP Code",
      description: "Generate 6-digit One-Time Password and dispatch via SMS or Email.",
      requiresIdempotency: false,
      pathParameters: [],
      queryParameters: [],
      headerParameters: [],
      requestProperties: [
        { name: "channel", type: "string", required: true, description: "Delivery channel (sms or email)." },
        { name: "target", type: "string", required: true, description: "Recipient phone number or email address." },
        { name: "purpose", type: "string", required: true, description: "Verification intent (e.g. login_verification)." },
        { name: "ttlSeconds", type: "number", required: false, description: "Passcode expiration in seconds (default 300)." },
      ],
      responseProperties: [
        { name: "success", type: "boolean", required: true, description: "Gateway status boolean." },
        { name: "referenceId", type: "string", required: true, description: "OTP session correlation ID." },
        { name: "expiresAt", type: "string", required: true, description: "ISO timestamp when code expires." },
      ],
      sampleRequest: { channel: "sms", target: "+639171234567", purpose: "login_verification" },
      sampleResponse: { success: true, referenceId: "otp_ref_9918a", expiresAt: "2026-07-29T02:00:00Z" },
      errorResponses: [
        { code: 400, description: "Invalid channel or target address." },
        { code: 429, description: "Too many OTP generation requests for this target." },
      ],
    });
  }

  if (!existingPaths.includes("/api/v1/shared/geo/lookup")) {
    operations.push({
      path: "/api/v1/shared/geo/lookup",
      method: "GET",
      operationId: "lookupGeo",
      tag: "Platform Utilities",
      summary: "Lookup IP Geolocation",
      description: "Resolve client IP address to region, city, postal code, and ISP.",
      requiresIdempotency: false,
      pathParameters: [],
      queryParameters: [
        { name: "ip", in: "query", type: "string", required: true, description: "IPv4 or IPv6 address to locate." },
      ],
      headerParameters: [],
      requestProperties: [],
      responseProperties: [
        { name: "ip", type: "string", required: true, description: "Query IP address." },
        { name: "country", type: "string", required: true, description: "ISO 2-letter country code." },
        { name: "region", type: "string", required: true, description: "Philippine region or province code." },
        { name: "city", type: "string", required: true, description: "City or municipality name." },
        { name: "postalCode", type: "string", required: true, description: "Postal zip code." },
      ],
      sampleRequest: null,
      sampleResponse: { ip: "203.177.10.1", country: "PH", region: "NCR", city: "Manila", postalCode: "1000" },
      errorResponses: [
        { code: 400, description: "Invalid IP address format." },
        { code: 401, description: "Missing Bearer JWT authentication." },
      ],
    });
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
        const requiresIdempotency = parameters.some((parameter) => JSON.stringify(parameter).includes("Idempotency-Key"));
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
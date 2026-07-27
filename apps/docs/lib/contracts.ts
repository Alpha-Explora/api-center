import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

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